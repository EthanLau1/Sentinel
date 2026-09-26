import type { Project, Bug, ReportJson, UiRunStatus, UiRunRecord, RunSummary } from '../types';

export const apiClient = {
  getProjects: async (): Promise<Project[]> => {
    const res = await fetch('/api/projects');
    if (!res.ok) throw new Error('Failed to fetch projects');
    return res.json() as Promise<Project[]>;
  },

  getProject: async (id: string): Promise<Project> => {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('Failed to fetch project');
    return res.json() as Promise<Project>;
  },

  addProject: async (path: string, name?: string): Promise<Project> => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, ...(name ? { name } : {}) }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({ error: 'failed_to_add_project' }));
      throw new Error(String((payload as { error?: string }).error ?? 'failed_to_add_project'));
    }
    return res.json() as Promise<Project>;
  },

  getReport: async (projectId: string): Promise<ReportJson | null> => {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/report/latest`);
    if (!res.ok) return null;
    const data = await res.json() as ReportJson & { bugs?: Bug[] };
    // If the response has no bugs array it's an empty placeholder
    if (!data.bugs || data.bugs.length === 0) return null;
    return data;
  },

  getBugs: async (projectId: string): Promise<Bug[]> => {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/report/latest`);
    if (!res.ok) throw new Error('Failed to fetch bugs');
    const data = await res.json() as { bugs?: Bug[] };
    return data.bugs ?? [];
  },

  runDebug: async (
    projectId: string,
    onProgress: (step: number, log: string) => void,
    signal?: AbortSignal,
  ): Promise<{ success: boolean; exitCode?: number; status?: UiRunRecord['status'] }> => {
    return streamProjectEvent(`/api/projects/${encodeURIComponent(projectId)}/run`, onProgress, signal);
  },

  scanProject: async (
    projectId: string,
    onProgress: (step: number, log: string) => void,
    signal?: AbortSignal,
  ): Promise<{ success: boolean; exitCode?: number; status?: UiRunRecord['status'] }> => {
    return streamProjectEvent(`/api/projects/${encodeURIComponent(projectId)}/scan`, onProgress, signal);
  },

  getRunSummary: async (projectId: string): Promise<RunSummary | null> => {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/run/latest`);
    if (!res.ok) throw new Error('Failed to load run summary');
    return res.json() as Promise<RunSummary | null>;
  },

  getRunStatus: async (projectId: string): Promise<UiRunStatus> => {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/run/status`);
    if (!res.ok) throw new Error('Failed to load run status');
    return res.json() as Promise<UiRunStatus>;
  },

  cancelRun: async (projectId: string): Promise<void> => {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/run/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!res.ok) throw new Error('Failed to cancel run');
  },
};

async function streamProjectEvent(
  endpoint: string,
  onProgress: (step: number, log: string) => void,
  signal?: AbortSignal,
): Promise<{ success: boolean; exitCode?: number; status?: UiRunRecord['status'] }> {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: '{}',
        signal,
      });

      if (!res.ok) throw new Error(`Failed to start run (HTTP ${res.status})`);
      if (!res.body) throw new Error('No readable stream returned');

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let success = false;
      let exitCode: number | undefined;
      let status: UiRunRecord['status'] | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (!line) continue;

          if (line.startsWith('data: ')) {
            try {
              const payload = JSON.parse(line.substring(6)) as { step?: number; message?: string; type?: string; ok?: boolean; exitCode?: number; status?: UiRunRecord['status'] };
              if (payload.step !== undefined && payload.message) {
                onProgress(payload.step, payload.message);
              }
              if (payload.type === 'done') {
                success = payload.ok === true;
                exitCode = payload.exitCode;
                status = payload.status;
              }
            } catch {
              onProgress(0, line);
            }
          }
        }
      }
      return { success, ...(exitCode !== undefined ? { exitCode } : {}), ...(status ? { status } : {}) };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        onProgress(0, 'Run stopped by user.');
        return { success: false };
      }
      console.error(error);
      onProgress(0, 'Run failed: ' + String(error));
      return { success: false };
    }
}
