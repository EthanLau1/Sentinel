import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { color } from '@sentinel/reporters';

interface UiOptions {
  host: string;
  port: number;
  noOpen: boolean;
  project?: string;
}

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  lastRunTime: string;
  stats: { p0: number; p1: number; p2: number; p3: number };
  status: 'fresh' | 'possibly_stale' | 'stale' | 'ready' | 'uninitialized';
  provider: string;
}

interface StoredProject {
  id?: string;
  name?: string;
  root?: string;
  path?: string;
}

interface AddProjectPayload {
  path?: string;
  name?: string;
}

function parseUiOptions(): UiOptions {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    if (idx === -1) return undefined;
    return argv[idx + 1];
  };
  const has = (flag: string): boolean => argv.includes(flag);

  const portRaw = get('--port');
  const port = Number(portRaw ?? '4317');
  const host = get('--host') ?? '127.0.0.1';
  const projectEq = argv.find((a) => a.startsWith('--project='))?.slice('--project='.length);
  const projectFlag = get('--project');

  const out: UiOptions = {
    host,
    port: Number.isFinite(port) ? port : 4317,
    noOpen: has('--no-open'),
  };
  const project = projectEq ?? projectFlag;
  if (project) out.project = project;
  return out;
}

function repoRoot(): string {
  return resolve(fileURLToPath(new URL('../../../', import.meta.url)));
}

function pickUiRoot(root: string): string {
  const candidates = [
    join(root, 'sentinel-ui', 'dist'),
    join(root, 'sentinel-ui'),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'index.html'))) return c;
  }
  throw new Error('Sentinel UI files not found. Run: npm --workspace sentinel-ui run build');
}

function contentType(pathname: string): string {
  const ext = extname(pathname).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.ico') return 'image/x-icon';
  return 'application/octet-stream';
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function relativeTime(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return 'unknown';
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function loadProjects(defaultProjectPath?: string): Promise<ProjectRow[]> {
  const list: StoredProject[] = [];
  const globalPath = join(homedir(), '.sentinel', 'projects.json');
  const globalRaw = await readJson(globalPath);
  if (globalRaw && typeof globalRaw === 'object' && Array.isArray((globalRaw as { projects?: unknown }).projects)) {
    const rows = (globalRaw as { projects: unknown[] }).projects;
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      list.push(r as StoredProject);
    }
  }

  if (list.length === 0) {
    list.push({
      id: 'current',
      name: basename(defaultProjectPath ? resolve(defaultProjectPath) : process.cwd()),
      path: resolve(defaultProjectPath ?? process.cwd()),
    });
  }

  const out: ProjectRow[] = [];
  for (const p of list) {
    const projectPath = resolve(p.path ?? p.root ?? process.cwd());
    const name = p.name ?? basename(projectPath);
    const id = p.id ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const reportPath = join(projectPath, 'reports', 'sentinel-latest.json');
    const reportRaw = await readJson(reportPath);

    let status: ProjectRow['status'] = 'uninitialized';
    let lastRunTime = 'never';
    let stats = { p0: 0, p1: 0, p2: 0, p3: 0 };

    if (existsSync(join(projectPath, '.sentinel'))) status = 'ready';
    if (reportRaw && typeof reportRaw === 'object') {
      status = 'fresh';
      const generated = (reportRaw as { generated_at?: string }).generated_at;
      if (typeof generated === 'string') lastRunTime = relativeTime(generated);
      const bySeverity = ((reportRaw as { summary?: { by_severity?: Record<string, number> } }).summary?.by_severity) ?? {};
      stats = {
        p0: bySeverity['P0'] ?? 0,
        p1: bySeverity['P1'] ?? 0,
        p2: bySeverity['P2'] ?? 0,
        p3: bySeverity['P3'] ?? 0,
      };
      const sec = Date.now() - Date.parse(generated ?? '');
      if (!Number.isNaN(sec) && sec > 48 * 3600 * 1000) status = 'possibly_stale';
    }

    out.push({
      id,
      name,
      path: projectPath,
      lastRunTime,
      stats,
      status,
      provider: 'Global Default',
    });
  }

  return out;
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

function toProjectId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

async function saveGlobalProjects(projects: StoredProject[]): Promise<void> {
  const dir = join(homedir(), '.sentinel');
  const path = join(dir, 'projects.json');
  await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify({ projects }, null, 2), 'utf8');
}

async function addProjectToGlobalList(payload: AddProjectPayload): Promise<ProjectRow> {
  const rawPath = payload.path?.trim();
  if (!rawPath) throw new Error('missing_project_path');

  const resolvedPath = resolve(rawPath);
  if (!existsSync(resolvedPath)) throw new Error('project_path_not_found');

  const globalPath = join(homedir(), '.sentinel', 'projects.json');
  const globalRaw = await readJson(globalPath);
  const existing: StoredProject[] =
    globalRaw && typeof globalRaw === 'object' && Array.isArray((globalRaw as { projects?: unknown }).projects)
      ? (globalRaw as { projects: StoredProject[] }).projects
      : [];

  const name = payload.name?.trim() || basename(resolvedPath);
  const id = toProjectId(name);
  const merged = existing.filter((p) => resolve(p.path ?? p.root ?? '') !== resolvedPath);
  merged.push({ id, name, path: resolvedPath });
  await saveGlobalProjects(merged);

  const rows = await loadProjects();
  const row = rows.find((r) => r.path === resolvedPath);
  if (!row) throw new Error('failed_to_add_project');
  return row;
}

function parseProjectId(pathname: string): string | null {
  const m = /^\/api\/projects\/([^/]+)$/.exec(pathname);
  return m ? decodeURIComponent(m[1]!) : null;
}

function parseProjectRunId(pathname: string): string | null {
  const m = /^\/api\/projects\/([^/]+)\/run$/.exec(pathname);
  return m ? decodeURIComponent(m[1]!) : null;
}

function parseProjectScanId(pathname: string): string | null {
  const m = /^\/api\/projects\/([^/]+)\/scan$/.exec(pathname);
  return m ? decodeURIComponent(m[1]!) : null;
}

function parseProjectLatestId(pathname: string): string | null {
  const m = /^\/api\/projects\/([^/]+)\/report\/latest$/.exec(pathname);
  return m ? decodeURIComponent(m[1]!) : null;
}

function parseProjectLatestMdId(pathname: string): string | null {
  const m = /^\/api\/projects\/([^/]+)\/report\/latest\.md$/.exec(pathname);
  return m ? decodeURIComponent(m[1]!) : null;
}

function streamStaticFile(uiRoot: string, pathname: string, res: ServerResponse): void {
  const target = pathname === '/' ? '/index.html' : pathname;
  const safe = target.replace(/\.\./g, '');
  let file = join(uiRoot, safe);
  if (!existsSync(file)) {
    if (!pathname.startsWith('/api/') && !extname(pathname)) {
      file = join(uiRoot, 'index.html');
      if (!existsSync(file)) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
    } else {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
  }
  res.writeHead(200, { 'Content-Type': contentType(file) });
  createReadStream(file).pipe(res);
}

function openBrowser(url: string): void {
  if (process.platform === 'darwin') {
    const p = spawn('open', [url], { stdio: 'ignore', detached: true });
    p.unref();
    return;
  }
  if (process.platform === 'win32') {
    const p = spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true });
    p.unref();
    return;
  }
  const p = spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
  p.unref();
}

async function runProjectStream(projectPath: string, res: ServerResponse): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  send({ step: 0, message: `Starting sentinel run for ${projectPath}` });

  const repo = repoRoot();
  const isTs = import.meta.url.endsWith('.ts');
  const entry = join(repo, 'packages', 'cli', isTs ? 'src/index.ts' : 'dist/index.js');
  const hasLlmConfig = existsSync(join(projectPath, '.sentinel', 'llm.yml'));
  if (!hasLlmConfig) {
    send({ step: 1, message: 'No .sentinel/llm.yml found. Auto-initializing project...' });
  }
  const args = [entry, 'run', `--project=${projectPath}`];
  if (!hasLlmConfig && !existsSync(join(projectPath, '.sentinel'))) {
    // auto-init will handle this inside the run command now
  }
  const child = spawn(process.execPath, args, {
    cwd: repo,
    env: process.env,
  });

  let step = 1;
  child.stdout.on('data', (buf: Buffer) => {
    const text = buf.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      send({ step, message: line.trim() });
      step += 1;
    }
  });
  child.stderr.on('data', (buf: Buffer) => {
    const text = buf.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      send({ step, message: `[stderr] ${line.trim()}` });
      step += 1;
    }
  });

  await new Promise<void>((resolveDone) => {
    child.on('close', (code) => {
      send({ step, message: `Run finished (exit=${code ?? -1})` });
      res.end();
      resolveDone();
    });
  });
}

async function runProjectScanStream(projectPath: string, res: ServerResponse): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  send({ step: 0, message: `Starting project scan for ${projectPath}` });

  const repo = repoRoot();
  const isTs = import.meta.url.endsWith('.ts');
  const entry = join(repo, 'packages', 'cli', isTs ? 'src/index.ts' : 'dist/index.js');
  const args = [entry, 'map', `--project=${projectPath}`];
  const child = spawn(process.execPath, args, {
    cwd: repo,
    env: process.env,
  });

  let step = 1;
  child.stdout.on('data', (buf: Buffer) => {
    const text = buf.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      send({ step, message: line.trim() });
      step += 1;
    }
  });
  child.stderr.on('data', (buf: Buffer) => {
    const text = buf.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      send({ step, message: `[stderr] ${line.trim()}` });
      step += 1;
    }
  });

  await new Promise<void>((resolveDone) => {
    child.on('close', (code) => {
      send({ step, message: `Scan finished (exit=${code ?? -1})` });
      res.end();
      resolveDone();
    });
  });
}

export async function runUi(): Promise<number> {
  const opts = parseUiOptions();
  const root = repoRoot();
  const uiRoot = pickUiRoot(root);
  const projects = await loadProjects(opts.project);
  const byId = new Map(projects.map((p) => [p.id, p]));

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', `http://${opts.host}:${opts.port}`);
    const pathname = url.pathname;

    if (method === 'GET' && pathname === '/api/projects') {
      // Re-load projects on each request so the list stays fresh after a run
      const fresh = await loadProjects(opts.project);
      // Sync byId map
      byId.clear();
      for (const p of fresh) byId.set(p.id, p);
      projects.length = 0;
      for (const p of fresh) projects.push(p);
      writeJson(res, 200, projects);
      return;
    }

    if (method === 'POST' && pathname === '/api/projects') {
      try {
        const body = await readRequestBody(req);
        const payload = JSON.parse(body || '{}') as AddProjectPayload;
        const created = await addProjectToGlobalList(payload);

        const fresh = await loadProjects(opts.project);
        byId.clear();
        for (const p of fresh) byId.set(p.id, p);
        projects.length = 0;
        for (const p of fresh) projects.push(p);

        writeJson(res, 200, created);
      } catch (err) {
        writeJson(res, 400, { error: (err as Error).message });
      }
      return;
    }

    if (method === 'GET' && pathname === '/api/bootstrap') {
      writeJson(res, 200, {
        projectRoot: projects[0]?.path ?? process.cwd(),
        projects,
      });
      return;
    }

    const pid = parseProjectId(pathname);
    if (method === 'GET' && pid) {
      const p = byId.get(pid);
      if (!p) {
        writeJson(res, 404, { error: 'project_not_found' });
        return;
      }
      writeJson(res, 200, p);
      return;
    }

    const latestMdId = parseProjectLatestMdId(pathname);
    if (method === 'GET' && latestMdId) {
      const p = byId.get(latestMdId);
      if (!p) {
        writeJson(res, 404, { error: 'project_not_found' });
        return;
      }
      const reportPath = join(p.path, 'reports', 'sentinel-latest.md');
      if (!existsSync(reportPath)) {
        res.writeHead(404);
        res.end('No markdown report found. Run a debug session first.');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      createReadStream(reportPath).pipe(res);
      return;
    }

    const latestId = parseProjectLatestId(pathname);
    if (method === 'GET' && latestId) {
      const p = byId.get(latestId);
      if (!p) {
        writeJson(res, 404, { error: 'project_not_found' });
        return;
      }
      const reportPath = join(p.path, 'reports', 'sentinel-latest.json');
      if (!existsSync(reportPath)) {
        writeJson(res, 200, { bugs: [] });
        return;
      }
      const raw = readFileSync(reportPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(raw);
      return;
    }

    const runId = parseProjectRunId(pathname);
    if (method === 'POST' && runId) {
      const p = byId.get(runId);
      if (!p) {
        writeJson(res, 404, { error: 'project_not_found' });
        return;
      }
      await runProjectStream(p.path, res);
      return;
    }

    const scanId = parseProjectScanId(pathname);
    if (method === 'POST' && scanId) {
      const p = byId.get(scanId);
      if (!p) {
        writeJson(res, 404, { error: 'project_not_found' });
        return;
      }
      await runProjectScanStream(p.path, res);
      return;
    }

    if (method === 'POST' && pathname === '/api/provider/test') {
      // Real connectivity test: attempt a minimal chat completion against the configured provider
      let body = '';
      for await (const chunk of req) body += chunk;
      let baseUrl = 'http://localhost:11434/v1';
      let model = 'qwen3:7b';
      let apiKey = 'ollama';
      try {
        const parsed = JSON.parse(body) as { baseUrl?: string; model?: string; apiKey?: string };
        if (parsed.baseUrl) baseUrl = parsed.baseUrl;
        if (parsed.model) model = parsed.model;
        if (parsed.apiKey) apiKey = parsed.apiKey;
      } catch { /* use defaults */ }

      try {
        const testRes = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (testRes.ok) {
          writeJson(res, 200, { ok: true, mode: 'live', status: testRes.status });
        } else {
          const errText = await testRes.text().catch(() => '');
          writeJson(res, 200, { ok: false, mode: 'live', status: testRes.status, error: errText.slice(0, 200) });
        }
      } catch (err) {
        writeJson(res, 200, { ok: false, mode: 'live', error: (err as Error).message });
      }
      return;
    }

    // POST /api/settings — persist LLM provider settings
    if (method === 'POST' && pathname === '/api/settings') {
      try {
        const body = await readRequestBody(req);
        const payload = JSON.parse(body || '{}') as {
          providerName?: string;
          type?: string;
          baseUrl?: string;
          apiKey?: string;
          model?: string;
          projectId?: string;
        };

        const providerName = payload.providerName?.trim() || 'default-provider';
        const type = payload.type || 'openai-compatible';
        const baseUrl = payload.baseUrl?.trim() || '';
        const model = payload.model?.trim() || '';
        const apiKey = payload.apiKey?.trim() || '';

        // Build llm.yml content
        let yml = `default: ${providerName}\n\nproviders:\n`;
        yml += `  ${providerName}:\n`;
        yml += `    type: ${type}\n`;
        if (baseUrl) yml += `    baseUrl: ${baseUrl}\n`;
        if (apiKey) yml += `    apiKey: ${apiKey}\n`;
        if (model) yml += `    model: ${model}\n`;

        // Write to global ~/.sentinel/llm.yml
        const globalDir = join(homedir(), '.sentinel');
        await mkdir(globalDir, { recursive: true });
        await writeFile(join(globalDir, 'llm.yml'), yml, 'utf8');

        // Write to selected project if provided
        if (payload.projectId) {
          const p = byId.get(payload.projectId);
          if (p) {
            const projectSentinelDir = join(p.path, '.sentinel');
            await mkdir(projectSentinelDir, { recursive: true });
            await writeFile(join(projectSentinelDir, 'llm.yml'), yml, 'utf8');
          }
        }

        writeJson(res, 200, { ok: true, saved: true, global: join(globalDir, 'llm.yml') });
      } catch (err) {
        writeJson(res, 400, { ok: false, error: (err as Error).message });
      }
      return;
    }

    streamStaticFile(uiRoot, pathname, res);
  });

  await new Promise<void>((resolveStarted, rejectStarted) => {
    server.once('error', rejectStarted);
    server.listen(opts.port, opts.host, () => resolveStarted());
  });

  const url = `http://${opts.host}:${opts.port}/`;
  console.log(color.cyan('🛰  Sentinel Console'));
  console.log(color.dim(`   root: ${root}`));
  console.log(color.dim(`   ui:   ${uiRoot}`));
  console.log(color.green(`   open: ${url}`));
  if (!opts.noOpen) {
    try {
      openBrowser(url);
    } catch (err) {
      console.log(color.yellow(`   browser open failed: ${(err as Error).message}`));
    }
  }
  console.log(color.dim('   press Ctrl+C to stop'));

  await new Promise<void>((resolveExit) => {
    const close = () => {
      server.close(() => resolveExit());
    };
    process.on('SIGINT', close);
    process.on('SIGTERM', close);
  });

  return 0;
}
