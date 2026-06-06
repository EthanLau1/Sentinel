import type { ReactNode } from 'react';
import { ProjectList } from '../Sidebar/ProjectList';
import { Settings, Shield, Cpu } from 'lucide-react';
import { useApp } from '../../context/AppState';

interface ConsoleLayoutProps {
  children: ReactNode;
}

export function ConsoleLayout({ children }: ConsoleLayoutProps) {
  const { state, navigate } = useApp();
  const activeProject = state.projects.find(p => p.id === state.selectedProjectId);
  const providerLabel = activeProject?.provider ?? 'Global Default';

  return (
    <div className="flex flex-col h-full w-full" style={{ backgroundColor: 'var(--bg-base)' }}>
      {/* Top Header */}
      <header
        className="flex items-center justify-between px-4"
        style={{
          height: 'var(--header-height)',
          borderBottom: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-surface)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center rounded-md"
            style={{
              background: 'var(--gradient-brand)',
              width: '28px',
              height: '28px',
              boxShadow: '0 2px 8px rgba(99, 102, 241, 0.3)',
            }}
          >
            <Shield size={16} color="white" />
          </div>
          <h1 className="font-semibold" style={{ fontSize: '0.95rem', letterSpacing: '-0.02em' }}>
            Sentinel Console
          </h1>
          <span
            className="text-xs font-mono"
            style={{
              color: 'var(--text-muted)',
              padding: '2px 6px',
              background: 'var(--bg-surface-elevated)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-color)',
            }}
          >
            v0.1
          </span>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
            <Cpu size={14} style={{ color: 'var(--accent-blue)' }} />
            <span className="status-dot status-dot-green" />
            <span style={{ fontSize: '0.75rem' }}>{providerLabel}</span>
          </div>
          <button onClick={() => navigate('settings')} className="btn btn-ghost" style={{ padding: '0.25rem 0.5rem' }}>
            <Settings size={16} />
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside style={{ width: 'var(--sidebar-width)', flexShrink: 0 }}>
          <ProjectList />
        </aside>

        {/* Main Content */}
        <main
          className="flex-1 overflow-y-auto p-6 relative"
          style={{ backgroundColor: 'var(--bg-base)' }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
