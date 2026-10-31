import { useApp } from '../../context/AppState';
import { apiClient } from '../../api/client';
import { Plus } from 'lucide-react';

export function ProjectList() {
  const { state, selectProject, setProjects, navigate } = useApp();

  const handleAddProject = async (): Promise<void> => {
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
      const nameInput = window.prompt('项目显示名称（可选）：', suggestedName);
      const name = nameInput?.trim() ? nameInput.trim() : undefined;

      const created = await apiClient.addProject(path, name);
      const projects = await apiClient.getProjects();
      setProjects(projects);
      selectProject(created.id);
      navigate('overview');
    } catch (err) {
      window.alert(`添加项目失败: ${String(err)}`);
    }
  };

  const navItems = [
    { id: 'quickstart' as const, step: '01', title: '快速启航' },
    { id: 'overview' as const, step: '02', title: '诊断概览' },
    { id: 'run' as const, step: '03', title: '执行巡检' },
    { id: 'debug' as const, step: '04', title: '缺陷工单' },
    { id: 'settings' as const, step: '05', title: '规则配置' },
  ];

  const currentView = state.currentView === 'home' ? 'quickstart' : state.currentView;

  return (
    <div className="flex flex-col h-full justify-between pr-0 md:pr-2">
      <div>
        <div className="text-tiny font-semibold text-neutral-400 tracking-wider mb-2.5 uppercase">
          工作区导航
        </div>

        {/* Clean, high-density nav items with balanced line height */}
        <div className="flex flex-col gap-1">
          {navItems.map((item) => {
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => navigate(item.id)}
                className={`w-full px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition inline-flex items-center justify-between cursor-pointer min-h-[36px] ${
                  isActive
                    ? 'bg-black text-white shadow-sm font-semibold'
                    : 'text-neutral-600 hover:text-black hover:bg-neutral-100'
                }`}
              >
                <span>{item.title}</span>
                <span className={`font-mono text-tiny ${isActive ? 'text-neutral-400' : 'text-neutral-400'}`}>
                  {item.step}
                </span>
              </button>
            );
          })}
        </div>

        {/* Project Selector */}
        <div className="mt-6 pt-4 border-t border-neutral-100 flex flex-col gap-2">
          <div className="text-tiny font-semibold text-neutral-400 tracking-wider uppercase">
            当前绑定项目
          </div>

          <div className="flex flex-col gap-1.5 mt-0.5">
            {state.projects.length > 0 ? (
              <select
                value={state.selectedProjectId ?? ''}
                onChange={(e) => {
                  if (e.target.value) selectProject(e.target.value);
                }}
                className="w-full border border-neutral-200 bg-white rounded-lg px-2.5 py-1.5 text-xs text-neutral-800 focus:outline-none focus:border-black transition font-medium min-h-[34px]"
              >
                {state.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-xs text-neutral-400 bg-neutral-50 p-2 rounded-lg border border-neutral-100">
                暂未绑定项目
              </div>
            )}

            <button
              onClick={handleAddProject}
              className="w-full inline-flex items-center justify-center gap-1.5 border border-dashed border-neutral-300 rounded-lg py-1.5 text-xs text-neutral-600 hover:border-black hover:text-black transition cursor-pointer font-medium min-h-[34px]"
            >
              <Plus size={12} />
              <span>添加项目</span>
            </button>
          </div>
        </div>
      </div>

      <div className="text-tiny text-neutral-400 pt-3 border-t border-neutral-100 mt-4">
        本地环境 · 源码隔离
      </div>
    </div>
  );
}
