import { useApp } from '../context/AppState';
import { Settings, Radar, Bug, FileText, Zap, ArrowRight, Shield, AlertTriangle, Info } from 'lucide-react';

export function Home() {
  const { navigate, state } = useApp();
  const projectSelected = Boolean(state.selectedProjectId);

  const steps = [
    {
      number: 1,
      title: 'Setup',
      description: 'Configure LLM provider, API key, and per-project override. Supports OpenAI-compatible, Ollama, LM Studio.',
      icon: Settings,
      action: () => navigate('settings'),
      color: 'var(--accent-blue)',
      colorBg: 'var(--accent-blue-bg)',
      disabled: false,
    },
    {
      number: 2,
      title: 'Scan / Run',
      description: 'Auto-detect project structure, generate user flows, execute flows, and collect runtime evidence.',
      icon: Radar,
      action: () => navigate('run'),
      color: 'var(--accent-cyan)',
      colorBg: 'var(--accent-cyan-bg)',
      disabled: !projectSelected,
    },
    {
      number: 3,
      title: 'Review Findings',
      description: 'Inspect bug list with root cause analysis, confidence scores, evidence, and auto-generated patch diffs.',
      icon: Bug,
      action: () => navigate('debug'),
      color: 'var(--accent-yellow)',
      colorBg: 'var(--accent-yellow-bg)',
      disabled: !projectSelected,
    },
    {
      number: 4,
      title: 'Reports',
      description: 'Open Markdown/JSON reports. Apply patches from .sentinel/auto-patches/ or review suggestions.',
      icon: FileText,
      action: () => navigate('overview'),
      color: 'var(--accent-green)',
      colorBg: 'var(--accent-green-bg)',
      disabled: !projectSelected,
    },
  ];

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      {/* Hero Section */}
      <div className="mb-6" style={{ paddingTop: '1.5rem' }}>
        <div className="flex items-center gap-3 mb-4">
          <div
            className="flex items-center justify-center"
            style={{
              width: '44px',
              height: '44px',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--gradient-brand)',
              boxShadow: '0 4px 16px rgba(99, 102, 241, 0.3)',
            }}
          >
            <Shield size={22} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: '1.75rem', letterSpacing: '-0.03em', marginBottom: '0.125rem' }}>
              Sentinel
            </h1>
            <p className="text-secondary" style={{ fontSize: '0.8125rem' }}>
              Universal Debug Agent for web projects — v0.2.0
            </p>
          </div>
        </div>

        <p className="text-secondary" style={{ fontSize: '0.875rem', lineHeight: '1.7', maxWidth: '560px' }}>
          Select a project, configure provider, scan runtime evidence, then run debug.
          Sentinel auto-generates user flows from your routes, runs them against your dev server, identifies bugs with root-cause analysis, and produces code patches.
        </p>
      </div>

      {/* Prerequisite Notice */}
      <div
        className="card mb-5 flex items-start gap-3"
        style={{
          padding: '0.875rem 1rem',
          borderColor: 'var(--accent-yellow)',
          borderLeftWidth: '3px',
        }}
      >
        <AlertTriangle size={16} style={{ color: 'var(--accent-yellow)', flexShrink: 0, marginTop: '2px' }} />
        <div>
          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-yellow)', marginBottom: '0.25rem' }}>
            使用前提
          </p>
          <p style={{ fontSize: '0.725rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
            目标项目的 dev server 必须正在运行（<code style={{ padding: '1px 3px', background: 'var(--bg-surface-elevated)', borderRadius: '3px', fontSize: '0.625rem' }}>npm run dev</code>），
            否则 Runner 无法访问页面和 API 端点，只能做静态分析。
          </p>
        </div>
      </div>

      {/* Quick Status Bar */}
      {state.projects.length > 0 && (
        <div
          className="card mb-5 flex items-center justify-between"
          style={{ padding: '0.75rem 1rem' }}
        >
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Zap size={14} style={{ color: 'var(--accent-yellow)' }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {state.projects.length} project{state.projects.length !== 1 ? 's' : ''} loaded
              </span>
            </div>
            {projectSelected && (
              <>
                <div style={{ width: '1px', height: '16px', background: 'var(--border-color)' }} />
                <span style={{ fontSize: '0.75rem', color: 'var(--accent-blue)' }}>
                  {state.projects.find(p => p.id === state.selectedProjectId)?.name ?? '—'}
                </span>
              </>
            )}
          </div>
          {!projectSelected && (
            <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
              Select a project to get started →
            </span>
          )}
        </div>
      )}

      {/* Workflow Steps */}
      <div className="flex flex-col gap-3">
        {steps.map((step, index) => (
          <button
            key={step.number}
            className="card card-interactive card-glow text-left"
            onClick={step.action}
            disabled={step.disabled}
            style={{
              opacity: step.disabled ? 0.5 : 1,
              cursor: step.disabled ? 'not-allowed' : 'pointer',
              padding: '1rem 1.25rem',
              animationDelay: `${index * 80}ms`,
            }}
          >
            <div className="flex items-center gap-4">
              {/* Step Icon */}
              <div
                className="flex items-center justify-center flex-shrink-0"
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: step.colorBg,
                  color: step.color,
                }}
              >
                <step.icon size={20} />
              </div>

              {/* Content */}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    style={{
                      fontSize: '0.625rem',
                      fontWeight: 700,
                      color: step.color,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    Step {step.number}
                  </span>
                </div>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: '0.125rem' }}>
                  {step.title}
                </h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                  {step.description}
                </p>
              </div>

              {/* Arrow */}
              {!step.disabled && (
                <ArrowRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Info Footer */}
      <div
        className="card mt-5 flex items-start gap-3"
        style={{ padding: '0.75rem 1rem', borderColor: 'var(--border-subtle)' }}
      >
        <Info size={14} style={{ color: 'var(--accent-blue)', flexShrink: 0, marginTop: '2px' }} />
        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>
          <strong style={{ color: 'var(--text-secondary)' }}>Patch 机制:</strong> Tier 1/2 修复自动生成 unified diff 到项目内，不直接改源码。
          通过 <code style={{ padding: '1px 3px', background: 'var(--bg-surface-elevated)', borderRadius: '3px' }}>git apply .sentinel/auto-patches/xxx.diff</code> 手动应用。
          <br />
          <strong style={{ color: 'var(--text-secondary)' }}>CLI 模式:</strong> 使用{' '}
          <code style={{ padding: '1px 3px', background: 'var(--bg-surface-elevated)', borderRadius: '3px' }}>sentinel run --project /path</code>{' '}
          进行无头调试。
        </div>
      </div>
    </div>
  );
}
