import type { Project, Bug, ReportJson } from '../types';

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
  ): Promise<{ success: boolean }> => {
    return streamProjectEvent(`/api/projects/${encodeURIComponent(projectId)}/run`, onProgress, signal);
  },

  scanProject: async (
    projectId: string,
    onProgress: (step: number, log: string) => void,
    signal?: AbortSignal,
  ): Promise<{ success: boolean }> => {
    return streamProjectEvent(`/api/projects/${encodeURIComponent(projectId)}/scan`, onProgress, signal);
  },
};

async function streamProjectEvent(
  endpoint: string,
  onProgress: (step: number, log: string) => void,
  signal?: AbortSignal,
): Promise<{ success: boolean }> {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Accept: 'text/event-stream' },
        signal,
      });

      if (!res.ok) throw new Error(`Failed to start run (HTTP ${res.status})`);
      if (!res.body) throw new Error('No readable stream returned');

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

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
              const payload = JSON.parse(line.substring(6)) as { step?: number; message?: string };
              if (payload.step !== undefined && payload.message) {
                onProgress(payload.step, payload.message);
              }
            } catch {
              onProgress(0, line);
            }
          }
        }
      }
      return { success: true };
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
