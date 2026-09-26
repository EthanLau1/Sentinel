import { afterAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
let ui: ChildProcess | undefined;

afterAll(async () => {
  if (ui && ui.exitCode === null) {
    ui.kill('SIGTERM');
    await new Promise<void>(done => ui!.once('exit', () => done()));
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
    for (let i = 0; i < 100; i++) {
      try {
        devPid = Number(await readFile(join(first, 'server.pid'), 'utf8'));
        if (devPid) break;
      } catch { /* wait for child */ }
      await new Promise(done => setTimeout(done, 50));
    }
    expect(devPid).toBeGreaterThan(0);
    const activeStatus = await (await fetch(base + '/api/projects/' + id + '/run/status')).json() as { active: { mode: string; events: unknown[] } };
    expect(activeStatus.active.mode).toBe('run');
    expect(activeStatus.active.events.length).toBeGreaterThan(0);
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
