import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ProjectList } from '../Sidebar/ProjectList';
import { useApp } from '../../context/AppState';
import { Play, Plus } from 'lucide-react';
import { apiClient } from '../../api/client';

interface ConsoleLayoutProps {
  children: ReactNode;
}

export function ConsoleLayout({ children }: ConsoleLayoutProps) {
  const { state, navigate, selectProject, setProjects } = useApp();
  const currentProject = state.projects.find((p) => p.id === state.selectedProjectId);
  const [activeModel, setActiveModel] = useState<string>('LM Studio');

  useEffect(() => {
    fetch('/api/settings?scope=global')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || !data.configured) return;
        const name =
          data.providerName ||
          (data.baseUrl?.includes('1234')
            ? 'LM Studio'
            : data.baseUrl?.includes('11434')
            ? 'Ollama'
            : data.baseUrl?.includes('8000')
            ? 'vLLM'
            : '云端 API');
        setActiveModel(name);
      })
      .catch(() => {});
  }, [state.currentView]);

  const handleQuickAddProject = async (): Promise<void> => {
    try {
      const res = await fetch('/api/pick-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = (await res.json()) as { ok: boolean; path?: string; cancelled?: boolean; error?: string };

      if (data.cancelled || !data.ok || !data.path) return;

      const path = data.path;
      const suggestedName = path.split('/').filter(Boolean).at(-1) ?? 'project';
      const created = await apiClient.addProject(path, suggestedName);
      const projects = await apiClient.getProjects();
      setProjects(projects);
      selectProject(created.id);
      navigate('overview');
    } catch (err) {
      window.alert(`添加项目失败: ${String(err)}`);
    }
  };

  return (
    <div
      className="w-full min-h-screen py-3 sm:py-5 px-2 sm:px-4 flex flex-col justify-between"
      style={{ backgroundColor: 'var(--bg-page)' }}
    >
      {/* Top Bar - Fully Responsive Wrap */}
      <div className="max-w-6xl w-full mx-auto flex flex-wrap items-center justify-between gap-3 mb-3 px-1">
        <div className="flex items-center gap-2.5">
          <div
            onClick={() => navigate('quickstart')}
            className="w-8 h-8 bg-black rounded-lg text-white font-bold flex items-center justify-center text-sm tracking-wider shadow-sm cursor-pointer hover:bg-neutral-800 transition"
            title="回到快速启航"
          >
            S
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-neutral-900 tracking-tight">Sentinel</span>
            <span className="text-tiny font-mono text-neutral-400 border border-neutral-200 px-1 py-0.5 rounded bg-white">
              v0.2.1
            </span>
          </div>
        </div>

        {/* Global Quick Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Active Model Pill */}
          <button
            onClick={() => navigate('quickstart')}
            className="border border-neutral-200 bg-white rounded-lg px-2.5 py-1 text-xs text-neutral-700 font-medium hover:border-black transition flex items-center gap-1.5 cursor-pointer shadow-sm min-h-[30px]"
            title="点击切换模型"
          >
            <span className="status-dot status-dot-green"></span>
            <span className="text-neutral-400 text-tiny">模型:</span>
            <span className="text-neutral-800 font-semibold">{activeModel}</span>
          </button>

          {/* Quick Project Switcher */}
          {state.projects.length > 0 && (
            <div className="flex items-center gap-1 border border-neutral-200 bg-white rounded-lg px-2 py-1 text-xs shadow-sm min-h-[30px]">
              <span className="text-neutral-400 text-tiny">项目:</span>
              <select
                value={state.selectedProjectId ?? ''}
                onChange={(e) => {
                  if (e.target.value) selectProject(e.target.value);
                }}
                className="bg-transparent border-0 text-xs font-semibold text-neutral-800 focus:outline-none cursor-pointer max-w-[130px] truncate"
              >
                {state.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                onClick={handleQuickAddProject}
                className="hover:text-black text-neutral-400 p-0.5 transition cursor-pointer"
                title="导入新项目"
              >
                <Plus size={12} />
              </button>
            </div>
          )}

          {/* Re-run button */}
          {currentProject && (
            <button
              onClick={() => navigate('run')}
              className="bg-black hover:bg-neutral-800 text-white rounded-lg px-3 py-1 text-xs font-medium transition flex items-center gap-1 cursor-pointer shadow-sm min-h-[30px]"
            >
              <Play size={10} fill="white" />
              <span>重新巡检</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Card - Fluid & Adaptive (No fixed min-height) */}
      <div className="max-w-6xl w-full mx-auto bg-white border border-neutral-200 rounded-2xl shadow-card p-4 sm:p-6 lg:p-7 flex-1 flex flex-col min-h-0">
        <div className="flex flex-col md:flex-row gap-5 md:gap-7 flex-1 min-h-0">
          {/* Left: Sidebar (Responsive) */}
          <aside className="w-full md:w-[180px] lg:w-[200px] flex-shrink-0">
            <ProjectList />
          </aside>

          {/* Right: Main Content (Responsive) */}
          <main className="flex-1 min-w-0 flex flex-col justify-between md:pl-6 md:border-l md:border-neutral-100">
            {children}
          </main>
        </div>
      </div>

      {/* Clean Footer */}
      <div className="max-w-6xl w-full mx-auto flex items-center justify-between mt-2.5 px-2 text-tiny text-neutral-400 font-mono">
        <div>Sentinel · 本地沙箱</div>
        <div>127.0.0.1:4317</div>
      </div>
    </div>
  );
}
