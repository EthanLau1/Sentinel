import { afterAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
let ui: ChildProcess | undefined;
/** 本测试建出来的临时目录 —— 用完必须删 */
const tempDirs: string[] = [];

afterAll(async () => {
  if (ui && ui.exitCode === null) {
    ui.kill('SIGTERM');
    await new Promise<void>(done => ui!.once('exit', () => done()));
  }
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const port = address.port;
  await new Promise<void>(done => server.close(() => done()));
  return port;
}

describe('Sentinel WebUI HTTP', () => {
  it('separates project identity, settings and local run history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sentinel-web-test-'));
    tempDirs.push(root);
    const home = join(root, 'home');
    const first = join(root, 'one', 'same-name');
    const second = join(root, 'two', 'same-name');
    await mkdir(join(home, '.sentinel'), { recursive: true });
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    await writeFile(join(home, '.sentinel', 'projects.json'), JSON.stringify({ projects: [
      { id: 'same-name', name: basename(first), path: first },
      { id: 'same-name', name: basename(second), path: second },
    ] }));
    await mkdir(join(first, 'reports'), { recursive: true });
    await writeFile(join(first, 'reports', 'sentinel-run-status.json'), JSON.stringify({
      status: 'incomplete', plannedFlows: 3, passedFlows: 1, failedFlows: 1,
      untestedFlows: 1, bugCount: 2, costUsd: null, durationMs: 1000,
      coverageRisks: [{ id: 'coverage_1' }],
    }));
    const port = await availablePort();
    const base = 'http://127.0.0.1:' + port;
    ui = spawn('bun', [join(repo, 'packages/cli/src/index.ts'), 'ui', '--no-open', '--port', String(port)], {
      cwd: repo, env: { ...process.env, HOME: home }, stdio: 'ignore',
    });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        const response = await fetch(base + '/api/projects');
        if (response.ok) { ready = true; break; }
      } catch { /* wait for server */ }
      await new Promise(done => setTimeout(done, 50));
    }
    expect(ready).toBe(true);
    const post = (path: string) => fetch(base + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const badHostStatus = await new Promise<number>((done, fail) => {
      const req = request({ hostname: '127.0.0.1', port, path: '/api/projects', headers: { Host: 'evil.example:' + port } }, res => {
        res.resume();
        done(res.statusCode ?? 0);
      });
      req.on('error', fail);
      req.end();
    });
    expect(badHostStatus).toBe(403);
    expect((await fetch(base + '/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}',
    })).status).toBe(403);
    expect((await fetch(base + '/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }, body: '{}',
    })).status).toBe(403);
    expect((await fetch(base + '/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}',
    })).status).toBe(415);
    expect((await fetch(base + '/api/pick-folder')).status).toBe(404);
    const projects = await (await fetch(base + '/api/projects')).json() as Array<{ id: string; path: string }>;
    expect(projects).toHaveLength(2);
    expect(projects[0]!.id).not.toBe(projects[1]!.id);
    const id = projects[0]!.id;
    const third = join(root, 'three', 'same-name');
    await mkdir(third, { recursive: true });
    const added = await fetch(base + '/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: third, name: 'same-name' }),
    });
    expect(added.ok).toBe(true);
    const addedProject = await added.json() as { id: string };
    expect(projects.map(project => project.id)).not.toContain(addedProject.id);
    const postSettings = (body: unknown) => fetch(base + '/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const config = { type: 'openai-compatible', baseUrl: 'https://example.invalid/v1', model: 'test' };
    expect((await postSettings({ ...config, apiKey: 'YOUR_GLOBAL_TEST_KEY' })).ok).toBe(true);
    expect((await postSettings({ ...config, scope: 'project', projectId: id, apiKey: 'YOUR_PROJECT_TEST_KEY' })).ok).toBe(true);
    expect((await postSettings({ ...config, scope: 'project', projectId: id, apiKey: '' })).ok).toBe(true);
    const globalFile = await readFile(join(home, '.sentinel', 'llm.yml'), 'utf8');
    const projectFile = await readFile(join(first, '.sentinel', 'llm.yml'), 'utf8');
    expect(globalFile).toContain('YOUR_GLOBAL_TEST_KEY');
    expect(globalFile).not.toContain('YOUR_PROJECT_TEST_KEY');
    expect(projectFile).toContain('YOUR_PROJECT_TEST_KEY');
    expect(projectFile).not.toContain('YOUR_GLOBAL_TEST_KEY');
    // 定价必须在保存设置后**留下来** ——
    // 以前 Web Settings 存一次配置就把 pricing 抹掉 → 美元预算护栏静默失效。
    // 注意：只测 llmConfigToYaml 是测不到的 —— 必须走真实的保存路径。
    await writeFile(join(first, '.sentinel', 'llm.yml'), [
      'default: cloud',
      'providers:',
      '  cloud:',
      '    type: openai-compatible',
      '    baseUrl: https://example.invalid/v1',
      '    apiKey: YOUR_PROJECT_TEST_KEY',
      '    model: test',
      '    pricing:',
      '      pricePerMTokIn: 2.5',
      '      pricePerMTokOut: 10',
      '',
    ].join('\n'), 'utf8');
    expect((await postSettings({ ...config, scope: 'project', projectId: id, apiKey: 'YOUR_PROJECT_TEST_KEY' })).ok).toBe(true);
    const savedWithPricing = await readFile(join(first, '.sentinel', 'llm.yml'), 'utf8');
    expect(savedWithPricing).toContain('pricing:');
    expect(savedWithPricing).toContain('pricePerMTokIn: 2.5');
    expect(savedWithPricing).toContain('pricePerMTokOut: 10');

    // provider 名不匹配的盲区 ——
    // 上面那条用例的 default 是 'cloud'，而 'cloud' 恰好是旧代码的回落值，
    // 所以旧 bug（provider 被改名 → pricing 找不到）在它那里照样绿。
    // 真实配置用的是 README 示例那种自定义名（'minimax'），
    // 必须用**非回落值**的 provider 名，才能真正覆盖这条路径。
    await writeFile(join(first, '.sentinel', 'llm.yml'), [
      'default: minimax',
      'providers:',
      '  minimax:',
      '    type: openai-compatible',
      '    baseUrl: https://example.invalid/v1',
      '    apiKey: YOUR_PROJECT_TEST_KEY',
      '    model: test',
      '    pricing:',
      '      pricePerMTokIn: 2.5',
      '      pricePerMTokOut: 10',
      '',
    ].join('\n'), 'utf8');
    // 前端**不带** providerName（老前端行为）—— 服务端必须自己回落成 existing.default
    expect((await postSettings({ ...config, scope: 'project', projectId: id, apiKey: 'YOUR_PROJECT_TEST_KEY' })).ok).toBe(true);
    const savedCustomProvider = await readFile(join(first, '.sentinel', 'llm.yml'), 'utf8');
    expect(savedCustomProvider).toContain('default: minimax');
    expect(savedCustomProvider).toContain('pricePerMTokIn: 2.5');
    expect(savedCustomProvider).toContain('pricePerMTokOut: 10');
    // 前端带 providerName（新版 Settings 页行为）—— 结果必须一致
    expect((await postSettings({ ...config, providerName: 'minimax', scope: 'project', projectId: id, apiKey: 'YOUR_PROJECT_TEST_KEY' })).ok).toBe(true);
    const savedWithProviderName = await readFile(join(first, '.sentinel', 'llm.yml'), 'utf8');
    expect(savedWithProviderName).toContain('default: minimax');
    expect(savedWithProviderName).toContain('pricePerMTokIn: 2.5');
    expect(savedWithProviderName).toContain('pricePerMTokOut: 10');

    expect((await postSettings({ ...config, scope: 'project', projectId: projects[1]!.id, apiKey: '' })).ok).toBe(true);
    const secondFile = await readFile(join(second, '.sentinel', 'llm.yml'), 'utf8');
    expect(secondFile).not.toContain('apiKey:');
    const projectSettings = await (await fetch(base + '/api/settings?scope=project&projectId=' + id)).json() as { apiKeyConfigured: boolean; apiKey: string };
    expect(projectSettings.apiKeyConfigured).toBe(true);
    expect(projectSettings.apiKey).not.toContain('YOUR_PROJECT_TEST_KEY');
    const summary = await (await fetch(base + '/api/projects/' + id + '/run/latest')).json() as { untestedFlows: number };
    expect(summary.untestedFlows).toBe(1);
    await mkdir(join(first, '.sentinel', 'auto-patches'), { recursive: true });
    await writeFile(join(first, '.sentinel', 'auto-patches', 'fix-1.diff'), 'patch fixture');
    const patch = await (await fetch(base + '/api/projects/' + id + '/patch/fix-1')).json() as { status: string; appliedVerified: boolean; path: string };
    expect(patch).toEqual({ path: '.sentinel/auto-patches/fix-1.diff', status: 'generated', appliedVerified: false });
    expect((await fetch(base + '/api/projects/' + id + '/patch/missing')).status).toBe(404);
    const stream = await post('/api/projects/' + id + '/scan');
    expect(stream.status).toBe(200);
    expect(await stream.text()).toContain('"type":"done"');
    const status = await (await fetch(base + '/api/projects/' + id + '/run/status')).json() as { active: unknown; history: Array<{ mode: string; status: string }> };
    expect(status.active).toBeNull();
    expect(status.history[0]!.mode).toBe('scan');
    expect(status.history[0]!.status).not.toBe('running');
    const historyFile = await readFile(join(first, '.sentinel', 'runs', 'webui.json'), 'utf8');
    expect(historyFile).not.toContain('YOUR_PROJECT_TEST_KEY');
    expect(historyFile).not.toContain('YOUR_GLOBAL_TEST_KEY');

    // The run command starts a child dev script, which must die with its CLI group.
    const devPort = await availablePort();
    await writeFile(join(first, 'package.json'), JSON.stringify({ scripts: { dev: 'node server.cjs --port ' + devPort } }));
    await writeFile(join(first, 'server.cjs'), "require('node:fs').writeFileSync('server.pid', String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);");
    const runStream = await post('/api/projects/' + id + '/run');
    expect(runStream.status).toBe(200);
    let devPid = 0;
    // 等待预算放宽到 15s：这里等的是"CLI 子进程 + npm 子进程"两级启动，
    // 全量并行跑时（回测夹具会占满 CPU）5s 不够 —— 那不是产品缺陷，是测试自己太紧。
    // 断言没变：必须真的看到子进程写下 pid。
    for (let i = 0; i < 300; i++) {
      try {
        devPid = Number(await readFile(join(first, 'server.pid'), 'utf8'));
        if (devPid) break;
      } catch { /* wait for child */ }
      await new Promise(done => setTimeout(done, 50));
    }
    expect(devPid).toBeGreaterThan(0);
    // 事件流是异步写入的：拿到 dev pid 不代表 run 的事件已经落进状态文件，
    // 这里轮询等待，避免"读得太快"造成的假失败。
    let activeStatus: { active: { mode: string; events: unknown[] } } | undefined;
    for (let i = 0; i < 100; i++) {
      const s = await (await fetch(base + '/api/projects/' + id + '/run/status')).json() as { active: { mode: string; events: unknown[] } };
      activeStatus = s;
      if (s.active?.mode === 'run' && s.active.events.length > 0) break;
      await new Promise(done => setTimeout(done, 50));
    }
    expect(activeStatus?.active.mode).toBe('run');
    expect(activeStatus?.active.events.length).toBeGreaterThan(0);
    expect((await post('/api/projects/' + id + '/run')).status).toBe(409);
    const cancelled = await post('/api/projects/' + id + '/run/cancel');
    expect(cancelled.status).toBe(200);
    expect(await runStream.text()).toContain('"ok":false');
    let childAlive = true;
    for (let i = 0; i < 60; i++) {
      try { process.kill(devPid, 0); } catch { childAlive = false; break; }
      await new Promise(done => setTimeout(done, 50));
    }
    expect(childAlive).toBe(false);
    const cancelledStatus = await (await fetch(base + '/api/projects/' + id + '/run/status')).json() as { history: Array<{ status: string }> };
    expect(cancelledStatus.history[0]!.status).toBe('cancelled');

    ui.kill('SIGTERM');
    await new Promise<void>(done => ui!.once('exit', () => done()));
    const historyPath = join(first, '.sentinel', 'runs', 'webui.json');
    const saved = JSON.parse(await readFile(historyPath, 'utf8')) as unknown[];
    await writeFile(historyPath, JSON.stringify([{
      id: 'interrupted-test', projectPath: first, mode: 'run', status: 'running',
      startedAt: new Date().toISOString(), events: [],
    }, ...saved]));
    ui = spawn('bun', [join(repo, 'packages/cli/src/index.ts'), 'ui', '--no-open', '--port', String(port)], {
      cwd: repo, env: { ...process.env, HOME: home }, stdio: 'ignore',
    });
    let recovered: { active: unknown; history: Array<{ status: string }> } | undefined;
    for (let i = 0; i < 100; i++) {
      try {
        const response = await fetch(base + '/api/projects/' + id + '/run/status');
        if (response.ok) { recovered = await response.json() as typeof recovered; break; }
      } catch { /* wait for restart */ }
      await new Promise(done => setTimeout(done, 50));
    }
    expect(recovered?.active).toBeNull();
    expect(recovered?.history[0]!.status).toBe('interrupted');
  }, 30_000);
});
