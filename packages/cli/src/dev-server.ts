/**
 * dev-server — 自动检测并启动目标项目的 dev server。
 *
 * 策略：
 * 1. 读 package.json scripts，找 dev/start/serve
 * 2. 用检测到的包管理器启动
 * 3. 等待端口就绪（轮询）
 * 4. 提供 stop() 方法关闭
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { color } from '@sentinel/reporters';

export interface DevServerHandle {
  /** dev server 子进程 */
  process: ChildProcess;
  /** 检测到的端口 */
  port: number;
  /** 停止 dev server */
  stop(): void;
}

interface PackageJson {
  scripts?: Record<string, string>;
  name?: string;
}

const COMMON_DEV_SCRIPTS = ['dev', 'start', 'serve', 'dev:start', 'start:dev'];
const COMMON_PORTS = [3000, 3001, 5173, 5174, 4000, 8000, 8080, 4173];

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
 * 等待端口就绪
 */
async function waitForPort(port: number, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkPort(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * 尝试找到一个正在监听的端口（可能 dev server 已经在跑了）
 */
async function findRunningPort(): Promise<number | null> {
  for (const port of COMMON_PORTS) {
    if (await checkPort(port)) return port;
  }
  return null;
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
  // 先检查是否已有 server 在跑
  const existingPort = await findRunningPort();
  if (existingPort) {
    console.log(color.dim(`   Dev server already running on port ${existingPort}`));
    // 返回一个 noop handle
    const noopProcess = spawn('true', [], { stdio: 'ignore' });
    return {
      process: noopProcess,
      port: existingPort,
      stop() { /* noop — 不杀用户已有的 server */ },
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

  // 推断端口
  const scriptContent = pkg.scripts[scriptName] ?? '';
  let port = inferPort(scriptContent);
  if (!port) {
    // 默认端口猜测
    if (scriptContent.includes('next')) port = 3000;
    else if (scriptContent.includes('vite')) port = 5173;
    else if (scriptContent.includes('nuxt')) port = 3000;
    else port = 3000;
  }

  // 启动
  const pm = detectPM(projectRoot);
  const cmd = pm === 'bun' ? 'bun' : pm;
  const args = pm === 'bun' ? ['run', scriptName] : ['run', scriptName];

  console.log(color.cyan(`🚀 Starting dev server: ${cmd} run ${scriptName} (port ${port})`));

  const child = spawn(cmd, args, {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), BROWSER: 'none' },
    detached: false,
  });

  // 从 stdout/stderr 里尝试捕获真实端口
  let detectedPort = port;
  const outputHandler = (data: Buffer): void => {
    const text = data.toString();
    const portInOutput = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4,5})/.exec(text);
    if (portInOutput) {
      detectedPort = parseInt(portInOutput[1]!, 10);
    }
  };
  child.stdout?.on('data', outputHandler);
  child.stderr?.on('data', outputHandler);

  // 等待端口就绪
  const ready = await waitForPort(detectedPort, 20000);
  if (!ready) {
    // 再试检测到的端口
    if (detectedPort !== port) {
      const retry = await waitForPort(detectedPort, 5000);
      if (!retry) {
        console.log(color.yellow(`⚠  Dev server may not be ready (port ${detectedPort} not responding)`));
      }
    } else {
      console.log(color.yellow(`⚠  Dev server may not be ready (port ${port} not responding after 20s)`));
    }
  } else {
    console.log(color.green(`✓ Dev server ready on port ${detectedPort}`));
  }

  return {
    process: child,
    port: detectedPort,
    stop() {
      if (!child.killed) {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 3000);
      }
    },
  };
}
