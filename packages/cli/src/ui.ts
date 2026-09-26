import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { color } from '@sentinel/reporters';
import {
  activeLlmProvider,
  llmConfigToYaml,
  loadLlmConfigFile,
  publicLlmSettings,
  type LlmConfig,
} from './config.js';

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

function pathId(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 12);
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
    const id = p.id ?? `${toProjectId(name)}-${pathId(projectPath)}`;
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

  const counts = new Map<string, number>();
  for (const p of out) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  for (const p of out) {
    if ((counts.get(p.id) ?? 0) > 1) p.id = `${toProjectId(p.name)}-${pathId(p.path)}`;
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
  const previous = existing.find((p) => resolve(p.path ?? p.root ?? '') === resolvedPath);
  const id = previous?.id ?? `${toProjectId(name)}-${pathId(resolvedPath)}`;
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

interface UiRunEvent {
  step: number;
  message: string;
  type?: 'done';
  ok?: boolean;
  exitCode?: number;
  status?: UiRunRecord['status'];
}

interface UiRunRecord {
  id: string;
  projectPath: string;
  mode: 'run' | 'scan';
  status: 'running' | 'completed' | 'findings' | 'failed' | 'cancelled' | 'interrupted';
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  events: UiRunEvent[];
}

interface ActiveUiRun {
  record: UiRunRecord;
  child: ReturnType<typeof spawn>;
  cancelRequested: boolean;
}

const activeRuns = new Map<string, ActiveUiRun>();
const pendingRuns = new Set<string>();

function runHistoryPath(projectPath: string): string {
  return join(projectPath, '.sentinel', 'runs', 'webui.json');
}

async function readRunHistory(projectPath: string): Promise<UiRunRecord[]> {
  const raw = await readJson(runHistoryPath(projectPath));
  return Array.isArray(raw) ? raw as UiRunRecord[] : [];
}

async function persistRun(record: UiRunRecord): Promise<void> {
  const path = runHistoryPath(record.projectPath);
  const records = await readRunHistory(record.projectPath);
  const metadata = { ...record, events: [] };
  const updated = [metadata, ...records.filter((r) => r.id !== record.id)].slice(0, 20);
  await mkdir(resolve(path, '..'), { recursive: true });
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(updated), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

function terminateRun(active: ActiveUiRun): void {
  active.cancelRequested = true;
  const pid = active.child.pid;
  if (!pid) return;
  const signal = (kind: NodeJS.Signals) => {
    try {
      if (process.platform === 'win32') active.child.kill(kind);
      else process.kill(-pid, kind);
    } catch { /* already exited */ }
  };
  signal('SIGTERM');
  const timer = setTimeout(() => {
    if (activeRuns.get(active.record.projectPath) === active) signal('SIGKILL');
  }, 5000);
  timer.unref();
}

async function runProjectStream(projectPath: string, mode: 'run' | 'scan', res: ServerResponse): Promise<void> {
  if (activeRuns.has(projectPath) || pendingRuns.has(projectPath)) {
    writeJson(res, 409, { error: 'run_already_active' });
    return;
  }
  pendingRuns.add(projectPath);
  const record: UiRunRecord = {
    id: randomUUID(), projectPath, mode, status: 'running',
    startedAt: new Date().toISOString(), events: [],
  };
  try {
    await persistRun(record);
  } catch (err) {
    pendingRuns.delete(projectPath);
    writeJson(res, 500, { error: 'run_history_unavailable', detail: String(err) });
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event: UiRunEvent) => {
    record.events.push(event);
    if (record.events.length > 200) record.events.shift();
    if (!res.destroyed) res.write('data: ' + JSON.stringify(event) + '\n\n');
  };
  send({ step: 0, message: 'Starting ' + mode + ' for ' + projectPath });

  const repo = repoRoot();
  const isTs = import.meta.url.endsWith('.ts');
  const entry = join(repo, 'packages', 'cli', isTs ? 'src/index.ts' : 'dist/index.js');
  const child = spawn(process.execPath, [entry, mode === 'run' ? 'run' : 'map', '--project=' + projectPath], {
    cwd: repo,
    env: process.env,
    detached: process.platform !== 'win32',
  });
  const active: ActiveUiRun = { record, child, cancelRequested: false };
  activeRuns.set(projectPath, active);
  pendingRuns.delete(projectPath);
  let step = 1;
  const writeLines = (text: string, prefix = '') => {
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) send({ step: step++, message: prefix + line.trim() });
    }
  };
  child.stdout?.on('data', (buf: Buffer) => writeLines(buf.toString('utf8')));
  child.stderr?.on('data', (buf: Buffer) => writeLines(buf.toString('utf8'), '[stderr] '));
  child.on('error', (err) => send({ step: step++, message: '[spawn] ' + err.message }));
  await new Promise<void>((done) => child.once('close', async (code) => {
    const exitCode = code ?? -1;
    record.status = active.cancelRequested ? 'cancelled'
      : exitCode === 0 ? 'completed'
      : mode === 'run' && exitCode === 1 ? 'findings' : 'failed';
    record.exitCode = exitCode;
    record.endedAt = new Date().toISOString();
    // The CLI may exit before a child dev server does; terminate the remaining group.
    if (active.cancelRequested && process.platform !== 'win32' && child.pid) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already exited */ }
    }
    send({ step: step++, message: mode + ' finished (exit=' + exitCode + ')', type: 'done',
      ok: record.status === 'completed' || record.status === 'findings', exitCode, status: record.status });
    try {
      await persistRun(record);
    } catch (err) {
      console.error('Could not save run history:', err);
    }
    activeRuns.delete(projectPath);
    if (!res.destroyed) res.end();
    done();
  }));
}

export async function runUi(): Promise<number> {
  const opts = parseUiOptions();
  if (!['127.0.0.1', 'localhost', '::1'].includes(opts.host)) {
    throw new Error('Sentinel UI only supports loopback hosts');
  }
  const bindHost = opts.host === '::1' ? '[::1]' : opts.host;
  const allowedHosts = new Set(['127.0.0.1', 'localhost', '[::1]'].map(host => host + ':' + opts.port));
  const root = repoRoot();
  const uiRoot = pickUiRoot(root);
  const projects = await loadProjects(opts.project);
  const byId = new Map(projects.map((p) => [p.id, p]));

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? 'GET';
    const requestHost = req.headers.host ?? '';
    if (!allowedHosts.has(requestHost)) {
      writeJson(res, 403, { error: 'invalid_host' });
      return;
    }
    if (method === 'POST') {
      const origin = req.headers.origin;
      const fetchSite = req.headers['sec-fetch-site'];
      if ((origin && origin !== 'http://' + requestHost) ||
          (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none')) {
        writeJson(res, 403, { error: 'invalid_origin' });
        return;
      }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
        writeJson(res, 415, { error: 'json_required' });
        return;
      }
    }
    const url = new URL(req.url ?? '/', 'http://' + requestHost);
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

    const runSummaryMatch = /^\/api\/projects\/([^/]+)\/run\/latest$/.exec(pathname);
    if (method === 'GET' && runSummaryMatch) {
      const p = byId.get(decodeURIComponent(runSummaryMatch[1]!));
      if (!p) {
        writeJson(res, 404, { error: 'project_not_found' });
        return;
      }
      writeJson(res, 200, await readJson(join(p.path, 'reports', 'sentinel-run-status.json')));
      return;
    }

    const patchMatch = /^\/api\/projects\/([^/]+)\/patch\/([^/]+)$/.exec(pathname);
    if (method === 'GET' && patchMatch) {
      const p = byId.get(decodeURIComponent(patchMatch[1]!));
      const fixId = decodeURIComponent(patchMatch[2]!);
      if (!p) {
        writeJson(res, 404, { error: 'project_not_found' });
        return;
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(fixId)) {
        writeJson(res, 400, { error: 'invalid_fix_id' });
        return;
      }
      const paths = [`.sentinel/auto-patches/${fixId}.diff`, `reports/patches/${fixId}.patch`];
      const path = paths.find((candidate) => existsSync(join(p.path, candidate)));
      if (!path) {
        writeJson(res, 404, { error: 'patch_not_generated' });
        return;
      }
      writeJson(res, 200, { path, status: 'generated', appliedVerified: false });
      return;
    }

    const statusMatch = /^\/api\/projects\/([^/]+)\/run\/status$/.exec(pathname);
    if (method === 'GET' && statusMatch) {
      const p = byId.get(decodeURIComponent(statusMatch[1]!));
      if (!p) {
        writeJson(res, 404, { error: 'project_not_found' });
        return;
      }
      const active = activeRuns.get(p.path)?.record ?? null;
      const history = await readRunHistory(p.path);
      for (const record of history) {
        if (record.status === 'running' && record.id !== active?.id && !pendingRuns.has(p.path)) {
          record.status = 'interrupted';
          record.endedAt = new Date().toISOString();
          await persistRun(record);
        }
      }
      writeJson(res, 200, { active, history: active ? [active, ...history.filter((r) => r.id !== active.id)] : history });
      return;
    }

    const cancelMatch = /^\/api\/projects\/([^/]+)\/run\/cancel$/.exec(pathname);
    if (method === 'POST' && cancelMatch) {
      const p = byId.get(decodeURIComponent(cancelMatch[1]!));
      if (!p) {
        writeJson(res, 404, { error: 'project_not_found' });
        return;
      }
      const active = activeRuns.get(p.path);
      if (!active) {
        writeJson(res, 409, { error: 'run_not_active' });
        return;
      }
      terminateRun(active);
      writeJson(res, 200, { ok: true, id: active.record.id });
      return;
    }

    const runId = parseProjectRunId(pathname);
    if (method === 'POST' && runId) {
      const p = byId.get(runId);
      if (!p) {
        writeJson(res, 404, { error: 'project_not_found' });
        return;
      }
      await runProjectStream(p.path, 'run', res);
      return;
    }

    const scanId = parseProjectScanId(pathname);
    if (method === 'POST' && scanId) {
      const p = byId.get(scanId);
      if (!p) {
        writeJson(res, 404, { error: 'project_not_found' });
        return;
      }
      await runProjectStream(p.path, 'scan', res);
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
        const parsed = JSON.parse(body) as { baseUrl?: string; model?: string; apiKey?: string; scope?: string; projectId?: string };
        const selected = parsed.scope === 'project' ? byId.get(parsed.projectId ?? '') : null;
        const configPath = selected
          ? join(selected.path, '.sentinel', 'llm.yml')
          : join(homedir(), '.sentinel', 'llm.yml');
        const existing = await loadLlmConfigFile(configPath)
          ?? (selected ? await loadLlmConfigFile(join(homedir(), '.sentinel', 'llm.yml')) : null);
        const provider = existing ? activeLlmProvider(existing) : null;
        baseUrl = parsed.baseUrl || provider?.baseUrl || baseUrl;
        model = parsed.model || provider?.model || model;
        apiKey = [parsed.apiKey, provider?.apiKey, apiKey].find(Boolean) ?? '';
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

    // Folder selection is stateful: never expose it through a cross-site GET.
    if (method === 'POST' && pathname === '/api/pick-folder') {
      try {
        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execFileAsync = promisify(execFile);
        const { stdout } = await execFileAsync('osascript', [
          '-e',
          'POSIX path of (choose folder with prompt "Select your web project folder:")',
        ]);
        const folderPath = stdout.trim();
        writeJson(res, 200, { ok: true, path: folderPath });
      } catch (err) {
        // User cancelled or AppleScript not available
        const msg = (err as Error).message ?? '';
        if (msg.includes('cancel') || msg.includes('-128')) {
          writeJson(res, 200, { ok: false, cancelled: true });
        } else {
          writeJson(res, 200, { ok: false, error: msg });
        }
      }
      return;
    }

    // GET /api/settings — read current LLM config
    if (method === 'GET' && pathname === '/api/settings') {
      const scope = url.searchParams.get('scope') ?? 'global';
      const selected = scope === 'project' ? byId.get(url.searchParams.get('projectId') ?? '') : null;
      if (scope !== 'global' && !selected) {
        writeJson(res, 404, { error: 'project_not_found' });
        return;
      }
      const configPath = scope === 'project'
        ? join(selected!.path, '.sentinel', 'llm.yml')
        : join(homedir(), '.sentinel', 'llm.yml');
      const config = await loadLlmConfigFile(configPath);
      if (!config) {
        writeJson(res, 200, { configured: false, scope });
        return;
      }
      try {
        writeJson(res, 200, { ...publicLlmSettings(config), scope });
      } catch {
        writeJson(res, 200, { configured: false, scope });
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
          scope?: 'global' | 'project';
        };

        // projectId without scope remains project-scoped for existing clients.
        const scope = payload.scope ?? (payload.projectId ? 'project' : 'global');
        if (scope !== 'global' && scope !== 'project') throw new Error('invalid_scope');
        const selected = scope === 'project' ? byId.get(payload.projectId ?? '') : null;
        if (scope === 'project' && !selected) throw new Error('project_not_found');
        const configPath = scope === 'project'
          ? join(selected!.path, '.sentinel', 'llm.yml')
          : join(homedir(), '.sentinel', 'llm.yml');

        const type = payload.type === 'ollama-native' ? 'ollama-native' : 'openai-compatible';
        const providerName = payload.providerName?.trim() || (type === 'ollama-native' ? 'local' : 'cloud');
        const baseUrl = payload.baseUrl?.trim() || '';
        const model = payload.model?.trim() || '';
        let apiKey = String(payload.apiKey ?? '').trim();

        const existing = await loadLlmConfigFile(configPath);
        const looksMasked = apiKey.includes('••••') || apiKey === '<configured>';

        // Preserve only the key already saved in this scope.
        if (!apiKey || looksMasked) {
          apiKey = existing ? activeLlmProvider(existing).apiKey ?? '' : '';
        }

        const nextConfig: LlmConfig = {
          default: providerName,
          providers: {
            [providerName]: {
              type,
              ...(baseUrl ? { baseUrl } : {}),
              ...(apiKey ? { apiKey } : {}),
              model,
            },
          },
        };
        const yml = llmConfigToYaml(nextConfig);

        await mkdir(resolve(configPath, '..'), { recursive: true });
        await writeFile(configPath, yml, { encoding: 'utf8', mode: 0o600 });

        writeJson(res, 200, { ok: true, saved: true, scope, path: configPath });
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

  const url = `http://${bindHost}:${opts.port}/`;
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
      for (const active of activeRuns.values()) terminateRun(active);
      server.close(() => resolveExit());
    };
    process.on('SIGINT', close);
    process.on('SIGTERM', close);
  });

  return 0;
}
