/**
 * dev server 身份判定 —— 端口上跑的是不是"这个项目"。
 *
 * 这组用例守的是 2026-10-27 修复轮第三轮的第 2 条盲区：
 *   `packages/cli/test/` 下**原本完全没有** dev server 的测试，
 *   于是"端口被别人的服务占着"这条路径没人守。
 *
 * 为什么必须真起 HTTP 服务、真查 lsof：
 *   身份判据是「监听端口的进程，其工作目录是不是本项目」——
 *   纯字符串比较的单测测不到它，只有真进程 + 真 lsof 才能验。
 *
 * 顺带守住的另一个真 bug（§7.2）：
 *   macOS 上 lsof 报的是**真实路径**（/tmp → /private/tmp），
 *   而 projectRoot 可能是软链路径 —— 不解 symlink 就会把本项目误判成外来服务。
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDevServer } from '../src/dev-server.js';

/** 端口空闲就取一个（测试自己起服务用） */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** 杀掉真正在监听该端口的进程（npm run dev 会留孙进程，stop() 只杀得掉 npm 那层） */
function killPort(port: number): void {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    const pid = out.split('\n').find((l) => l.startsWith('p'))?.slice(1).trim();
    if (pid) {
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch {
        /* 已经退出了 */
      }
    }
  } catch {
    /* lsof 没输出 = 没人监听 */
  }
}

const SERVER_CJS = `
const http = require('node:http');
const port = Number(process.env.PORT || 0);
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('PROJECT-SERVER');
}).listen(port, '127.0.0.1', () => console.log('listening on ' + port));
`;

/** 建一个"本项目"目录：package.json 的 dev 脚本里写死端口（推断端口靠的就是它） */
async function makeProject(port: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sentinel-devserver-'));
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'sentinel-devserver-fixture',
      scripts: { dev: `node server.cjs --port ${port}` },
    }),
  );
  await writeFile(join(dir, 'server.cjs'), SERVER_CJS);
  return dir;
}

const dirs: string[] = [];
const startedPorts: number[] = [];
let foreignServer: Server | null = null;

afterAll(async () => {
  for (const p of startedPorts) killPort(p);
  if (foreignServer) await new Promise<void>((r) => foreignServer!.close(() => r()));
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe('dev server 身份判定', () => {
  it('端口被别处目录起的服务占着 → 不复用它', async () => {
    // 外来服务跑在**本测试进程**里（cwd = 仓库根目录），与项目临时目录无关
    foreignServer = createServer((req, res) => res.end('FOREIGN-SERVER'));
    await new Promise<void>((r) => foreignServer!.listen(0, '127.0.0.1', () => r()));
    const foreignPort = (foreignServer.address() as { port: number }).port;

    const dir = await makeProject(foreignPort);
    dirs.push(dir);

    const handle = await startDevServer(dir);
    expect(handle).not.toBeNull();
    expect(handle!.reused).toBe(false);
    startedPorts.push(handle!.port);
  });

  it('端口被外来服务占着 → 另起的服务是本项目自己的，不是外来那个', async () => {
    const foreignPort = (foreignServer!.address() as { port: number }).port;
    const dir = await makeProject(foreignPort);
    dirs.push(dir);

    const handle = await startDevServer(dir);
    expect(handle).not.toBeNull();
    startedPorts.push(handle!.port);

    const body = await fetch(handle!.baseUrl).then((r) => r.text());
    expect(body).toContain('PROJECT-SERVER');
    expect(body).not.toContain('FOREIGN-SERVER');
  });

  it('端口被外来服务占着 → 另起的端口与外来端口不同', async () => {
    const foreignPort = (foreignServer!.address() as { port: number }).port;
    const dir = await makeProject(foreignPort);
    dirs.push(dir);

    const handle = await startDevServer(dir);
    expect(handle).not.toBeNull();
    startedPorts.push(handle!.port);
    expect(handle!.port).not.toBe(foreignPort);
  });

  it('端口被外来服务占着 → 提示写明"不是本项目"并给出 --url 逃生口', async () => {
    const foreignPort = (foreignServer!.address() as { port: number }).port;
    const dir = await makeProject(foreignPort);
    dirs.push(dir);

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    let handle;
    try {
      handle = await startDevServer(dir);
    } finally {
      spy.mockRestore();
    }
    expect(handle).not.toBeNull();
    startedPorts.push(handle!.port);

    const out = logs.join('\n');
    expect(out).toContain('不是本项目');
    expect(out).toContain('--url');
  });

  it('服务从本项目目录起 → 复用它', async () => {
    const port = await freePort();
    const dir = await makeProject(port);
    dirs.push(dir);

    const first = await startDevServer(dir);
    expect(first).not.toBeNull();
    startedPorts.push(first!.port);

    const second = await startDevServer(dir);
    expect(second).not.toBeNull();
    expect(second!.reused).toBe(true);
    expect(second!.identityConfirmed).toBe(true);
  });

  it('服务从本项目目录起 → 复用时端口保持不变', async () => {
    const port = await freePort();
    const dir = await makeProject(port);
    dirs.push(dir);

    const first = await startDevServer(dir);
    expect(first).not.toBeNull();
    startedPorts.push(first!.port);

    const second = await startDevServer(dir);
    expect(second).not.toBeNull();
    expect(second!.port).toBe(first!.port);
    expect(second!.baseUrl).toBe(first!.baseUrl);
  });
});
