/**
 * dev-server — 自动检测并启动目标项目的 dev server。
 *
 * 策略：
 * 1. 读 package.json scripts，找 dev/start/serve
 * 2. 用检测到的包管理器启动
 * 3. 等待**实际**监听端口就绪（解析启动输出 + 探测候选端口）
 * 4. 等待**首页可访问**（端口监听 ≠ 首页可用：Next/Vite 首次编译期间返回 5xx）
 * 5. 提供 stop() 方法关闭
 *
 * 复用已有服务时的**三重校验**（2026-10-27 修复）：
 *   ① 端口在监听？        —— 只是必要条件
 *   ② HTTP 真的能访问？   —— 端口在监听但 HTTP 不通 = 僵尸进程，不能用
 *   ③ 服务确实是本项目？  —— 尽量确认；确认不了只警告，不阻断
 * 以前只做 ①，审核里真实命中过一个隔夜残留的 next dev：
 * 端口 3000 在监听、进程指向别的目录、HTTP 完全不通 ——
 * Sentinel 照样打印 "Dev server already running" 复用了它，
 * 随后只报一句 "Browser preflight failed: goto: Timeout 15000ms"。
 */

import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { get as httpGet } from 'node:http';
import { color } from '@sentinel/reporters';

export interface DevServerOptions {
  /** 显式端口（--port）—— 跳过端口推断 */
  port?: number;
  /** 显式地址（--url）—— 直接用它，不自启 dev server */
  url?: string;
}

export interface DevServerHandle {
  /** dev server 子进程 */
  process: ChildProcess;
  /** 检测到的端口 */
  port: number;
  /** 本次实际使用的基址（--url 时就是用户给的那个） */
  baseUrl: string;
  /** 停止 dev server */
  stop(): void;
  /** 首页就绪状态：<500 表示应用已正常响应；0 表示连不上；≥500 表示应用自身报错 */
  homepageStatus: number;
  /** 实际监听端口是否为探测确认（false = 没探到，靠推断） */
  portVerified: boolean;
  /** 复用了已存在的服务（true）还是自己拉起来的（false） */
  reused: boolean;
  /** 是否确认了端口上的服务就是本项目（false = 无法确认，只警告不阻断） */
  identityConfirmed: boolean;
}

interface PackageJson {
  scripts?: Record<string, string>;
  name?: string;
}

const COMMON_DEV_SCRIPTS = ['dev', 'start', 'serve', 'dev:start', 'start:dev'];

/** 子进程日志保留行数 —— 启动失败时用户要看到框架的真实报错 */
const CHILD_LOG_LINES = 40;

/**
 * 等首页就绪的上限（ms）。
 *
 * 实测：Next.js 冷启动（.next 缓存为空 + 仓库在 iCloud 同步目录）首次编译要 40s+。
 * 原来的 45s 上限会让"刚 clone 下来第一次跑"的用户直接撞上 exit 2。
 */
const HOME_WAIT_MS = 120_000;

/**
 * 检测包管理器
 */
function detectPM(projectRoot: string): string {
  if (existsSync(join(projectRoot, 'bun.lockb')) || existsSync(join(projectRoot, 'bun.lock'))) return 'bun';
  if (existsSync(join(projectRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(projectRoot, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/**
 * 从 package.json scripts 里找到最合适的 dev 命令名
 */
function findDevScript(scripts: Record<string, string>): string | null {
  for (const name of COMMON_DEV_SCRIPTS) {
    if (scripts[name]) return name;
  }
  return null;
}

/**
 * 从脚本内容推断端口
 */
function inferPort(scriptContent: string): number | null {
  // 常见模式: --port 3000, -p 3000, PORT=3000, :3000
  const portMatch = /(?:--port|(?:^|[\s=])PORT=|-p)\s*(\d{4,5})/i.exec(scriptContent);
  if (portMatch) return parseInt(portMatch[1]!, 10);
  const colonMatch = /:(\d{4,5})/.exec(scriptContent);
  if (colonMatch) return parseInt(colonMatch[1]!, 10);
  return null;
}

/**
 * 检查端口是否在监听
 */
function checkPort(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      resolve(false);
    });
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * 端口是否空闲 —— 真正尝试 bind，成功即空闲。
 * 比"连不上"更准：被本机其他进程占用的端口连不上，但必须被识别为不可用。
 */
function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

/** 从 startPort 起找一个空闲端口，最多往后试 20 个 */
async function findFreePort(startPort: number, span = 20): Promise<number> {
  for (let p = startPort; p < startPort + span; p++) {
    if (await isPortFree(p)) return p;
  }
  return startPort;
}

/**
 * 请求首页，返回 HTTP 状态码。
 * 0 = 连不上；≥500 = 应用自身在报错（首次编译未完成时 Next/Vite 就是 500）。
 */
function checkHomepage(port: number, timeoutMs = 3000): Promise<number> {
  return new Promise((resolve) => {
    const req = httpGet(
      { host: '127.0.0.1', port, path: '/', timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', () => resolve(0));
    req.on('timeout', () => {
      req.destroy();
      resolve(0);
    });
  });
}

/**
 * 取首页正文（用于项目身份确认）。
 * 只取前 200KB —— 身份确认只需要"首页有没有出现项目名"。
 */
function fetchHomepageBody(port: number, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve) => {
    let size = 0;
    let text = '';
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve(text);
    };
    const req = httpGet(
      { host: '127.0.0.1', port, path: '/', timeout: timeoutMs },
      (res) => {
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= 200_000) text += chunk.toString('utf8');
        });
        res.on('end', done);
        res.on('error', done);
      },
    );
    req.on('error', done);
    req.on('timeout', () => {
      req.destroy();
      done();
    });
  });
}

/**
 * 端口上的进程工作目录 —— **确定性**的身份判据。
 *
 * 端口是谁在监听、那个进程是从哪个目录起的 —— 这一条能直接回答
 * "这个服务是不是我的项目"。lsof 不可用时（精简容器等）返回 null，退回启发式。
 */
async function verifyPortProcessCwd(port: number): Promise<string | null> {
  try {
    const listOut = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pid = listOut.split('\n').find((l) => l.startsWith('p'))?.slice(1).trim();
    if (!pid) return null;
    const cwdOut = execFileSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const cwd = cwdOut.split('\n').find((l) => l.startsWith('n'))?.slice(1).trim();
    return cwd ?? null;
  } catch {
    return null;
  }
}

/**
 * 路径归一 —— 比较前必须解 symlink。
 *
 * lsof 报的是**真实路径**（macOS 上 /tmp → /private/tmp、/var → /private/var），
 * 而用户传进来的 projectRoot 可能是软链路径（/tmp/xxx、~/link-to-project）。
 * 不解 symlink 就直接比字符串 → 明明是同一个项目，却判成"不是本项目"，
 * 于是本来该复用的 server 被误判为外来服务，白白另起一个。
 */
function realOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/**
 * 项目身份确认 —— 端口上的服务是不是"这个项目"。
 *
 * 两条判据，从强到弱：
 *   ① **端口进程的工作目录**（确定性）：端口上的进程是不是从本项目目录起的
 *   ② 首页里有没有项目标识（启发式）：很多项目首页不会写 package.json 的 name
 *
 * 确认不了 → **不复用**（在空闲端口自起本项目的 server）。
 * 以前是"警告 + 照用"—— 那是最危险的组合：用户以为测的是自己的项目，
 * 实际拿到的是别人家的 404，然后当成自己的 bug 报告出来。
 */
async function verifyProjectIdentity(
  port: number,
  projectRoot: string,
): Promise<{ confirmed: boolean; reason: string }> {
  // ① 确定性判据
  const cwd = await verifyPortProcessCwd(port);
  if (cwd) {
    const resolved = realOrSelf(cwd);
    const root = realOrSelf(projectRoot);
    if (resolved === root || resolved.startsWith(root + sep)) {
      return { confirmed: true, reason: `端口 ${port} 的进程工作目录就是本项目（${resolved}）` };
    }
    return { confirmed: false, reason: `端口 ${port} 的进程工作目录是 ${resolved}，不是本项目` };
  }

  // ② 退回启发式
  const body = await fetchHomepageBody(port);
  if (!body.trim()) return { confirmed: false, reason: '首页无内容' };

  const candidates: string[] = [];
  try {
    const raw = await readFile(join(projectRoot, 'package.json'), 'utf8');
    const name = (JSON.parse(raw) as PackageJson).name;
    // @scope/pkg → pkg（作用域前缀不会出现在首页里）
    const bare = name?.replace(/^@[^/]+\//, '');
    if (bare && bare.length >= 3) candidates.push(bare);
  } catch {
    /* 没有 package.json 就只用目录名 */
  }
  const dirName = basename(projectRoot);
  if (dirName.length >= 3) candidates.push(dirName);

  const haystack = body.toLowerCase();
  for (const c of candidates) {
    if (haystack.includes(c.toLowerCase())) {
      return { confirmed: true, reason: `首页包含项目标识 "${c}"` };
    }
  }
  return {
    confirmed: false,
    reason: candidates.length > 0
      ? `首页未出现项目标识（${candidates.join(' / ')}）`
      : '无从判断（项目没有可用的标识）',
  };
}

/** 从 URL 里取端口（取不到给 80） */
function portFromUrl(url: string): number {
  try {
    return new URL(url).port ? Number(new URL(url).port) : 80;
  } catch {
    return 80;
  }
}

/** 请求任意 URL，返回状态码 */
function checkUrlStatus(url: string, timeoutMs = 5000): Promise<number> {
  return new Promise((resolve) => {
    const req = httpGet(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', () => resolve(0));
    req.on('timeout', () => {
      req.destroy();
      resolve(0);
    });
  });
}

/**
 * 从子进程输出里提取"服务实际监听的端口"。
 *
 * 为什么要多试几种写法：各框架的启动输出格式不一样 ——
 *   Next.js   "ready - started server on 0.0.0.0:3000"
 *   Vite      "➜ Local: http://localhost:5173/"
 *   Node http "listening on 4321"
 *   NestJS    "Server running at http://localhost:8080"
 * 以前只认 "localhost:数字" 这一种，
 * 结果 "listening on 4321" 这种最朴素的输出被漏掉 ——
 * 用户明明看到服务起来了，Sentinel 却报 "No reachable project dev server"。
 */
function extractPort(text: string): number | null {
  const patterns = [
    /(?:localhost|127\.0\.0\.1|0\.0\.0\.0)[: ](\d{4,5})/,
    /\bport\s*[:=]?\s*(\d{4,5})\b/i,
    /\blisten(?:ing)?\s+on\s+(?:port\s+)?(\d{4,5})\b/i,
    /:(\d{4,5})\b/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return parseInt(m[1]!, 10);
  }
  return null;
}

/** 打印子进程最后几行输出 —— 启动失败时这是用户唯一能拿到的线索 */
function printChildLog(lines: string[]): void {
  if (lines.length === 0) return;
  console.log(color.dim('   ── dev server 输出（最后 15 行）──'));
  for (const l of lines.slice(-15)) console.log(color.dim(`   │ ${l}`));
}

/**
 * 自动启动 dev server。
 *
 * 返回 null 如果：
 * - 没有 package.json
 * - 没有可识别的 dev script
 * - 启动失败
 *
 * 如果 dev server 已在跑（端口已占用且 HTTP 可用），返回一个 noop handle。
 */
export async function startDevServer(
  projectRoot: string,
  options: DevServerOptions = {},
): Promise<DevServerHandle | null> {
  // ── 逃生口 1：--url ──
  // 用户显式指定了目标地址 → 直接用它，不猜端口、不自启任何进程。
  if (options.url) {
    const url = options.url.replace(/\/+$/, '');
    const status = await checkUrlStatus(`${url}/`);
    console.log(color.dim(`   Using provided URL: ${url} (HTTP ${status})`));
    if (status === 0) {
      console.log(color.yellow('⚠  该地址没有响应 —— 请确认服务已启动、地址写对'));
    }
    const noopProcess = spawn('true', [], { stdio: 'ignore' });
    return {
      process: noopProcess,
      port: portFromUrl(url),
      baseUrl: url,
      homepageStatus: status,
      portVerified: true,
      reused: true,
      // 用户自己指定的，身份由用户保证 —— 不猜
      identityConfirmed: true,
      stop() { /* noop —— 不是我们启动的进程，不杀 */ },
    };
  }

  // 读 package.json
  const pkgPath = join(projectRoot, 'package.json');
  if (!existsSync(pkgPath)) {
    console.log(color.dim('   No package.json found, skipping dev server auto-start'));
    return null;
  }

  let pkg: PackageJson;
  try {
    const raw = await readFile(pkgPath, 'utf8');
    pkg = JSON.parse(raw) as PackageJson;
  } catch {
    return null;
  }

  if (!pkg.scripts) {
    console.log(color.dim('   No scripts in package.json, skipping dev server auto-start'));
    return null;
  }

  const scriptName = findDevScript(pkg.scripts);
  if (!scriptName) {
    console.log(color.dim('   No dev/start/serve script found, skipping dev server auto-start'));
    return null;
  }

  // 推断端口（--port 优先）
  const scriptContent = pkg.scripts[scriptName] ?? '';
  let targetPort = options.port ?? inferPort(scriptContent) ?? null;
  if (!targetPort) {
    // 默认端口猜测
    if (scriptContent.includes('next')) targetPort = 3000;
    else if (scriptContent.includes('vite')) targetPort = 5173;
    else if (scriptContent.includes('nuxt')) targetPort = 3000;
    else targetPort = 3000;
  }

  // ── 复用判定：三重校验 ──
  if (await checkPort(targetPort)) {
    const status = await checkHomepage(targetPort);
    const identity = await verifyProjectIdentity(targetPort, projectRoot);

    if (status === 0) {
      // 端口在监听但 HTTP 完全不通 —— 僵尸进程，不能用。
      // 以前照样复用它，用户只看到一句超时，看不到真正原因。
      console.log(color.yellow(`⚠  端口 ${targetPort} 在监听，但 HTTP 无响应 —— 不会复用它`));
      console.log(color.dim('   可能是一个残留的僵尸进程；Sentinel 会自己另起一个 dev server。'));
    } else if (identity.confirmed) {
      // 身份确认：就是这个项目的 server → 复用
      console.log(color.dim(`   Dev server already running on port ${targetPort}（${identity.reason}）`));
      if (status >= 500) {
        console.log(
          color.yellow(`⚠  首页返回 HTTP ${status} —— 应用自身在报错，将作为 bug 记录`),
        );
      }
      const noopProcess = spawn('true', [], { stdio: 'ignore' });
      return {
        process: noopProcess,
        port: targetPort,
        baseUrl: `http://127.0.0.1:${targetPort}`,
        homepageStatus: status,
        portVerified: true,
        reused: true,
        identityConfirmed: true,
        stop() { /* noop — 不杀用户已有的 server */ },
      };
    } else {
      // 身份**不可确认** → 不复用。
      // 以前这里是"警告 + 照用"：明明知道可能不是本项目，
      // 还是拿别人的服务当自己的测，然后把它的 404 写成你的 bug。
      // 现在改为在空闲端口自起本项目的 server —— 测的肯定是自己。
      console.log(color.yellow(`⚠  端口 ${targetPort} 上有服务在跑，但不是本项目（${identity.reason}）`));
      console.log(color.dim('   不会复用它 —— Sentinel 会在空闲端口另起本项目的 dev server。'));
      console.log(color.dim('   若那个服务才是你要测的，用 --url http://127.0.0.1:' + targetPort + ' 明确指定。'));
    }
  }

  // 启动前：挑一个空闲端口，并通过 PORT 环境变量交给框架。
  // 不改用户项目的启动命令（追加 --port 可能与脚本里已有的 --port 冲突）；
  // 框架本身在端口被占时会自动递增，真正的修法在"等待侧要发现实际端口"。
  const chosenPort = await findFreePort(targetPort);

  // 候选端口 = 启动前确实空闲的那些。
  // 启动后第一个开始监听的候选端口，就是本次启动真正用的端口
  // （被别的项目占着的端口不会在启动后突然开始监听）。
  const candidates: number[] = [];
  for (let p = targetPort; p < targetPort + 20; p++) {
    if (p === chosenPort || (await isPortFree(p))) candidates.push(p);
  }
  if (!candidates.includes(chosenPort)) candidates.unshift(chosenPort);

  // 启动
  const pm = detectPM(projectRoot);
  const cmd = pm === 'bun' ? 'bun' : pm;
  const args = pm === 'bun' ? ['run', scriptName] : ['run', scriptName];

  console.log(color.cyan(`🚀 Starting dev server: ${cmd} run ${scriptName} (port ${chosenPort})`));

  const child = spawn(cmd, args, {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(chosenPort), BROWSER: 'none' },
    detached: false,
  });

  // 从 stdout/stderr 里尝试捕获真实端口；同时**留档**输出。
  // 以前这些文本只用来抓端口号，抓完就丢 —— 启动失败时用户什么都看不到。
  const childLog: string[] = [];
  let detectedPort = chosenPort;
  const outputHandler = (data: Buffer): void => {
    const text = data.toString();
    const portInOutput = extractPort(text);
    if (portInOutput) {
      detectedPort = portInOutput;
    }
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      childLog.push(line);
      if (childLog.length > CHILD_LOG_LINES) childLog.shift();
    }
  };
  child.stdout?.on('data', outputHandler);
  child.stderr?.on('data', outputHandler);

  // 等待实际监听端口出现。
  // detectedPort 会在等待过程中被启动输出改写，所以每轮都要重读，
  // 同时探测候选端口 —— 不能只等最初推断出来的那一个。
  const waitStart = Date.now();
  let actualPort: number | null = null;
  let portVerified = false;
  while (Date.now() - waitStart < 30000) {
    // 进程已经死了，再等端口也没意义 —— 直接走失败分支，把日志打给用户
    if (child.exitCode !== null) break;
    if (candidates.includes(detectedPort) && (await checkPort(detectedPort))) {
      actualPort = detectedPort;
      portVerified = true;
      break;
    }
    for (const c of candidates) {
      if (await checkPort(c)) {
        actualPort = c;
        portVerified = true;
        break;
      }
    }
    if (actualPort !== null) break;
    // 候选端口都没起来，但子进程自己报告了一个端口（脚本里写死的 4321 之类）——
    // 那个端口就是我们的服务，必须认；否则明明起来了却说"连不上"。
    if (!candidates.includes(detectedPort) && (await checkPort(detectedPort))) {
      actualPort = detectedPort;
      portVerified = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (actualPort === null) {
    if (child.exitCode !== null) {
      console.log(
        color.red(`✗  dev server 进程已退出（exit code ${child.exitCode}）`),
      );
    } else {
      console.log(
        color.yellow(
          `⚠  实际监听端口探测失败（候选 ${candidates.slice(0, 5).join(', ')}… 在 30s 内均未开始监听）`,
        ),
      );
    }
    printChildLog(childLog);
    child.kill('SIGTERM');
    return null;
  }

  console.log(color.green(`✓ Dev server ready on port ${actualPort}`));

  // 首页就绪：端口在监听 ≠ 首页可用。
  // Next/Vite 首次请求要编译，编译完成前返回 5xx —— 必须轮询等它编译完。
  //
  // 上限为什么是 120s（不是 45s）：实测 Next.js **冷启动**（.next 缓存为空，
  // 且仓库在 iCloud 同步目录里）首次编译要 40s 以上 —— 45s 上限会让
  // "一个刚 clone 下来、第一次跑的用户"直接撞上 "首页连不上" 然后 exit 2。
  // 上限只影响失败路径的等待时长（真正常时会立刻跳出循环）。
  const homeStart = Date.now();
  let homepageStatus = 0;
  let lastNotice = 0;
  while (Date.now() - homeStart < HOME_WAIT_MS) {
    homepageStatus = await checkHomepage(actualPort);
    if (homepageStatus > 0 && homepageStatus < 500) break;
    // 每 30s 说一句在等什么 —— 否则用户只看到一段沉默，以为卡死了
    if (Date.now() - lastNotice > 30_000) {
      lastNotice = Date.now();
      console.log(
        color.dim(
          `   仍在等待首页就绪（${Math.round((Date.now() - homeStart) / 1000)}s）—— 首次编译可能较慢`,
        ),
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (homepageStatus === 0) {
    console.log(color.yellow(`⚠  首页连不上（端口 ${actualPort} 已监听但 HTTP 无响应）`));
    printChildLog(childLog);
  } else if (homepageStatus >= 500) {
    console.log(
      color.yellow(
        `⚠  首页在 ${Math.round(HOME_WAIT_MS / 1000)}s 内仍返回 HTTP ${homepageStatus} —— 应用自身在报错，将作为 bug 记录`,
      ),
    );
  }

  return {
    process: child,
    port: actualPort,
    baseUrl: `http://127.0.0.1:${actualPort}`,
    homepageStatus,
    portVerified,
    reused: false,
    identityConfirmed: true,
    stop() {
      if (!child.killed) {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL');
        }, 3000);
      }
    },
  };
}
