/**
 * dev-server — 自动检测并启动目标项目的 dev server。
 *
 * 策略：
 * 1. 读 package.json scripts，找 dev/start/serve
 * 2. 用检测到的包管理器启动
 * 3. 等待**实际**监听端口就绪（解析启动输出 + 探测候选端口）
 * 4. 等待**首页可访问**（端口监听 ≠ 首页可用：Next/Vite 首次编译期间返回 5xx）
 * 5. 提供 stop() 方法关闭
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { get as httpGet } from 'node:http';
import { color } from '@sentinel/reporters';

export interface DevServerHandle {
  /** dev server 子进程 */
  process: ChildProcess;
  /** 检测到的端口 */
  port: number;
  /** 停止 dev server */
  stop(): void;
  /** 首页就绪状态：<500 表示应用已正常响应；0 表示连不上；≥500 表示应用自身报错 */
  homepageStatus: number;
  /** 实际监听端口是否为探测确认（false = 没探到，靠推断） */
  portVerified: boolean;
}

interface PackageJson {
  scripts?: Record<string, string>;
  name?: string;
}

const COMMON_DEV_SCRIPTS = ['dev', 'start', 'serve', 'dev:start', 'start:dev'];

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
 * 自动启动 dev server。
 *
 * 返回 null 如果：
 * - 没有 package.json
 * - 没有可识别的 dev script
 * - 启动失败
 *
 * 如果 dev server 已在跑（端口已占用），返回一个 noop handle。
 */
export async function startDevServer(projectRoot: string): Promise<DevServerHandle | null> {
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

  // 推断端口
  const scriptContent = pkg.scripts[scriptName] ?? '';
  let inferredPort = inferPort(scriptContent);
  if (!inferredPort) {
    // 默认端口猜测
    if (scriptContent.includes('next')) inferredPort = 3000;
    else if (scriptContent.includes('vite')) inferredPort = 5173;
    else if (scriptContent.includes('nuxt')) inferredPort = 3000;
    else inferredPort = 3000;
  }

  // 只信任当前项目脚本推断出的端口，避免误连其他项目的 3000/5173。
  if (await checkPort(inferredPort)) {
    console.log(color.dim(`   Dev server already running on inferred port ${inferredPort}`));
    const noopProcess = spawn('true', [], { stdio: 'ignore' });
    const status = await checkHomepage(inferredPort);
    return {
      process: noopProcess,
      port: inferredPort,
      homepageStatus: status,
      portVerified: true,
      stop() { /* noop — 不杀用户已有的 server */ },
    };
  }

  // 启动前：挑一个空闲端口，并通过 PORT 环境变量交给框架。
  // 不改用户项目的启动命令（追加 --port 可能与脚本里已有的 --port 冲突）；
  // 框架本身在端口被占时会自动递增，真正的修法在"等待侧要发现实际端口"。
  const chosenPort = await findFreePort(inferredPort);

  // 候选端口 = 启动前确实空闲的那些。
  // 启动后第一个开始监听的候选端口，就是本次启动真正用的端口
  // （被别的项目占着的端口不会在启动后突然开始监听）。
  const candidates: number[] = [];
  for (let p = inferredPort; p < inferredPort + 20; p++) {
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

  // 从 stdout/stderr 里尝试捕获真实端口
  let detectedPort = chosenPort;
  const outputHandler = (data: Buffer): void => {
    const text = data.toString();
    const portInOutput = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4,5})/.exec(text);
    if (portInOutput) {
      detectedPort = parseInt(portInOutput[1]!, 10);
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
    await new Promise((r) => setTimeout(r, 500));
  }

  if (actualPort === null) {
    console.log(
      color.yellow(
        `⚠  实际监听端口探测失败（候选 ${candidates.slice(0, 5).join(', ')}… 在 30s 内均未开始监听）`,
      ),
    );
    child.kill('SIGTERM');
    return null;
  }

  console.log(color.green(`✓ Dev server ready on port ${actualPort}`));

  // 首页就绪：端口在监听 ≠ 首页可用。
  // Next/Vite 首次请求要编译，编译完成前返回 5xx —— 必须轮询等它编译完。
  const homeStart = Date.now();
  let homepageStatus = 0;
  while (Date.now() - homeStart < 45000) {
    homepageStatus = await checkHomepage(actualPort);
    if (homepageStatus > 0 && homepageStatus < 500) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (homepageStatus === 0) {
    console.log(color.yellow(`⚠  首页连不上（端口 ${actualPort} 已监听但 HTTP 无响应）`));
  } else if (homepageStatus >= 500) {
    console.log(
      color.yellow(
        `⚠  首页在 45s 内仍返回 HTTP ${homepageStatus} —— 应用自身在报错，将作为 bug 记录`,
      ),
    );
  }

  return {
    process: child,
    port: actualPort,
    homepageStatus,
    portVerified,
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
