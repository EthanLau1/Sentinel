import { Plus, Folder, Clock, ShieldAlert, Home, Play, Bug, Settings } from 'lucide-react';
import { useApp } from '../../context/AppState';
import { apiClient } from '../../api/client';

export function ProjectList() {
  const { state, selectProject, setProjects, navigate } = useApp();

  const handleAddProject = async (): Promise<void> => {
    const path = window.prompt('Project path (absolute path):');
    if (!path || !path.trim()) return;

    const suggestedName = path.trim().split('/').filter(Boolean).at(-1) ?? 'project';
    const nameInput = window.prompt('Project name (optional):', suggestedName);
    const name = nameInput?.trim() ? nameInput.trim() : undefined;

    try {
      const created = await apiClient.addProject(path.trim(), name);
      const projects = await apiClient.getProjects();
      setProjects(projects);
      selectProject(created.id);
    } catch (err) {
      window.alert(`Failed to add project: ${String(err)}`);
    }
  };

  const navItems = [
    { id: 'home' as const, icon: Home, label: 'Home' },
    { id: 'run' as const, icon: Play, label: 'Run' },
    { id: 'debug' as const, icon: Bug, label: 'Debug' },
    { id: 'settings' as const, icon: Settings, label: 'Settings' },
  ];

  return (
    <div
      className="flex flex-col h-full"
      style={{
        borderRight: '1px solid var(--border-color)',
        backgroundColor: 'var(--bg-surface)',
      }}
    >
      {/* Section Header */}
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <h2
          className="text-xs font-semibold"
          style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}
        >
          Projects
        </h2>
      </div>

      {/* Project List */}
      <div className="flex-1 overflow-y-auto py-2">
        {state.projects.length === 0 && (
          <div className="px-4 py-6 text-center">
            <Folder size={24} className="mx-auto mb-2" style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No projects yet</p>
          </div>
        )}

        {state.projects.map(project => {
          const isSelected = project.id === state.selectedProjectId;
          const hasP0 = project.stats.p0 > 0;

          return (
            <div
              key={project.id}
              onClick={() => selectProject(project.id)}
              className={`px-3 py-3 mx-2 mb-1 cursor-pointer rounded-md transition-colors ${isSelected ? 'accent-bar-left' : ''}`}
              style={{
                backgroundColor: isSelected ? 'var(--bg-surface-elevated)' : 'transparent',
                paddingLeft: isSelected ? '1rem' : '0.75rem',
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <Folder size={14} style={{ color: isSelected ? 'var(--accent-blue)' : 'var(--text-muted)' }} />
                <span
                  className="font-medium truncate"
                  style={{
                    fontSize: '0.8125rem',
                    color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                >
                  {project.name}
                </span>
              </div>

              <div className="flex items-center gap-3" style={{ paddingLeft: '1.375rem' }}>
                <div className="flex items-center gap-1" style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                  <ShieldAlert size={11} style={{ color: hasP0 ? 'var(--accent-red)' : 'var(--text-muted)' }} />
                  <span>P0 {project.stats.p0}</span>
                  <span style={{ color: 'var(--border-focus)' }}>/</span>
                  <span>P1 {project.stats.p1}</span>
                  <span style={{ color: 'var(--border-focus)' }}>/</span>
                  <span>P2 {project.stats.p2}</span>
                </div>
              </div>

              <div
                className="flex items-center justify-between"
                style={{ paddingLeft: '1.375rem', marginTop: '0.25rem', fontSize: '0.625rem', color: 'var(--text-muted)' }}
              >
                <span className="flex items-center gap-1">
                  <Clock size={9} /> {project.lastRunTime}
                </span>
                <span>{project.provider}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Navigation */}
      <div className="px-3 py-3 flex flex-col gap-1" style={{ borderTop: '1px solid var(--border-color)' }}>
        {navItems.map(item => {
          const isActive = state.currentView === item.id || (item.id === 'home' && state.currentView === 'overview');
          return (
            <button
              key={item.id}
              className={`nav-btn ${isActive ? 'active' : ''}`}
              onClick={() => navigate(item.id === 'home' ? 'home' : item.id)}
            >
              <item.icon size={16} />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Add Project */}
      <div className="px-3 pb-3">
        <button
          className="btn btn-secondary w-full justify-center"
          onClick={handleAddProject}
          title="Add a project path"
          style={{ fontSize: '0.75rem' }}
        >
          <Plus size={14} /> Add Project
        </button>
      </div>
    </div>
  );
}
