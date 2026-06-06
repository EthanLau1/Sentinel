import { useState, useEffect } from 'react';
import { useApp } from '../context/AppState';
import { apiClient } from '../api/client';
import type { ReportJson } from '../types';
import { Play, Search, ShieldAlert, Clock, Code, DollarSign, Activity, FileJson, Folder, TrendingUp } from 'lucide-react';

export function ProjectOverview(): React.JSX.Element {
  const { state, navigate } = useApp();
  const project = state.projects.find(p => p.id === state.selectedProjectId);
  const [report, setReport] = useState<ReportJson | null>(null);

  useEffect(() => {
    if (project && (project.status === 'fresh' || project.status === 'possibly_stale' || project.status === 'stale')) {
      apiClient.getReport(project.id).then(setReport).catch(() => setReport(null));
    } else {
      setReport(null);
    }
  }, [project?.id, project?.status]);

  const openReport = (ext: 'md' | 'json'): void => {
    if (!project) return;
    const url =
      ext === 'json'
        ? `/api/projects/${encodeURIComponent(project.id)}/report/latest`
        : `/api/projects/${encodeURIComponent(project.id)}/report/latest.md`;
    window.open(url, '_blank');
  };

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center animate-fade-in">
          <ShieldAlert size={48} className="mx-auto mb-4" style={{ color: 'var(--text-muted)', opacity: 0.3 }} />
          <p className="mb-2" style={{ color: 'var(--text-secondary)' }}>Select a project from the sidebar</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Projects are loaded from <code style={{ padding: '1px 4px', background: 'var(--bg-surface-elevated)', borderRadius: '3px' }}>~/.sentinel/projects.json</code> or the current directory.
          </p>
        </div>
      </div>
    );
  }

  const isUninitialized = project.status === 'uninitialized';
  const isReady = project.status === 'ready';
  const hasReport = project.status === 'fresh' || project.status === 'possibly_stale' || project.status === 'stale';

  const costUsd = report?.summary?.cost_usd;
  const durationSec = report?.summary?.duration_seconds;
  const durationLabel = durationSec != null
    ? durationSec >= 60
      ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
      : `${durationSec}s`
    : '—';

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      {/* Project Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <h2 style={{ fontSize: '1.5rem', letterSpacing: '-0.02em' }}>{project.name}</h2>
          <span className={`badge ${project.status === 'fresh' ? 'badge-green' : project.status === 'possibly_stale' ? 'badge-yellow' : 'badge-blue'}`}>
            {project.status}
          </span>
        </div>
        <p className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{project.path}</p>
      </div>

      {hasReport && (
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-4 pb-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <h3 className="font-medium flex items-center gap-2" style={{ fontSize: '0.9375rem' }}>
              <Clock size={16} style={{ color: 'var(--accent-blue)' }} />
              Last Debug Session
              <span className="text-xs" style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({project.lastRunTime})</span>
            </h3>
            <div className="flex gap-2">
              <button className="btn btn-ghost" title="Open Markdown Report" onClick={() => openReport('md')}>
                <Code size={14} />
              </button>
              <button className="btn btn-ghost" title="Open JSON Report" onClick={() => openReport('json')}>
                <FileJson size={14} />
              </button>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="p-3 rounded-md" style={{ background: 'var(--bg-base)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-1 mb-1" style={{ fontSize: '0.625rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <ShieldAlert size={10} /> Bugs
              </div>
              <div className="font-semibold" style={{ fontSize: '1.125rem' }}>
                <span style={{ color: project.stats.p0 > 0 ? 'var(--accent-red)' : 'var(--text-primary)' }}>P0 {project.stats.p0}</span>
                <span style={{ color: 'var(--text-muted)', margin: '0 0.25rem' }}>/</span>
                <span>P1 {project.stats.p1}</span>
              </div>
              {(project.stats.p2 > 0 || project.stats.p3 > 0) && (
                <div className="text-xs" style={{ color: 'var(--text-muted)', marginTop: '2px' }}>P2 {project.stats.p2} / P3 {project.stats.p3}</div>
              )}
            </div>

            <div className="p-3 rounded-md" style={{ background: 'var(--bg-base)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-1 mb-1" style={{ fontSize: '0.625rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <DollarSign size={10} /> Cost
              </div>
              <div className="font-semibold" style={{ fontSize: '1.125rem' }}>
                {costUsd != null ? `$${costUsd.toFixed(4)}` : '—'}
              </div>
            </div>

            <div className="p-3 rounded-md" style={{ background: 'var(--bg-base)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-1 mb-1" style={{ fontSize: '0.625rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <Activity size={10} /> Duration
              </div>
              <div className="font-semibold" style={{ fontSize: '1.125rem' }}>
                {durationLabel}
              </div>
            </div>

            <div className="p-3 rounded-md" style={{ background: 'var(--bg-base)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-1 mb-1" style={{ fontSize: '0.625rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <TrendingUp size={10} /> Provider
              </div>
              <div className="font-semibold truncate" style={{ fontSize: '0.875rem' }} title={project.provider}>
                {project.provider}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button onClick={() => navigate('debug')} className="btn btn-primary">
              <ShieldAlert size={14} /> Review Bugs
            </button>
            <button onClick={() => navigate('run')} className="btn btn-secondary">
              <Play size={14} /> Run Again
            </button>
            <button onClick={() => navigate('settings')} className="btn btn-secondary">
              <Search size={14} /> Check Setup
            </button>
          </div>
        </div>
      )}

      {isReady && (
        <div className="card mb-6 text-center py-12">
          <div
            className="inline-flex items-center justify-center mb-4"
            style={{
              width: '56px',
              height: '56px',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--accent-blue-bg)',
              color: 'var(--accent-blue)',
            }}
          >
            <Play size={28} />
          </div>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Ready to Run</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginBottom: '1.5rem', maxWidth: '320px', marginLeft: 'auto', marginRight: 'auto' }}>
            This project has been initialized. No debug session has been run yet.
          </p>
          <div className="flex justify-center gap-3">
            <button onClick={() => navigate('run')} className="btn btn-primary">
              <Play size={14} /> Run Debug
            </button>
            <button onClick={() => navigate('run')} className="btn btn-secondary">
              Scan Project
            </button>
            <button onClick={() => navigate('settings')} className="btn btn-secondary">
              Check Setup
            </button>
          </div>
        </div>
      )}

      {isUninitialized && (
        <div className="card mb-6 text-center py-12" style={{ border: '2px dashed var(--border-color)' }}>
          <Folder size={44} className="mx-auto mb-4" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
          <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Initialize Project</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginBottom: '0.5rem', maxWidth: '360px', marginLeft: 'auto', marginRight: 'auto' }}>
            This project needs to be initialized before you can run Sentinel.
          </p>
          <p className="font-mono" style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            bun packages/cli/src/index.ts init --project={project.path}
          </p>
          <button className="btn btn-primary" onClick={() => navigate('run')}>
            Initialize Now
          </button>
        </div>
      )}
    </div>
  );
}
