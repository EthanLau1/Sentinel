import { X, Eye, AlertTriangle, GitPullRequest, ChevronRight } from 'lucide-react';
import type { Bug, FixOption } from '../../types';

interface BugDetailProps {
  bug: Bug;
  onClose: () => void;
  onApplyFix?: (bugId: string, fixId: string) => void;
  onSkip?: (bugId: string) => void;
}

function tierLabel(tier: FixOption['tier']): string {
  if (tier === 0) return 'Tier 0 — Fully Auto';
  if (tier === 1) return 'Tier 1 — Auto';
  if (tier === 2) return 'Tier 2 — Needs Approval';
  return 'Tier 3 — Advice Only';
}

function tierBadgeClass(tier: FixOption['tier']): string {
  if (tier <= 1) return 'badge-green';
  if (tier === 2) return 'badge-yellow';
  return 'badge-blue';
}

export function BugDetail({ bug, onClose, onApplyFix, onSkip }: BugDetailProps) {
  if (!bug) return null;

  const recommendedFix = bug.fixOptions.find(f => f.id === bug.recommendedFixId) ?? bug.fixOptions[0];

  return (
    <div
      className="flex flex-col h-full bg-base"
      style={{ borderLeft: '1px solid var(--border-color)', width: '420px', flexShrink: 0 }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-4 border-b border-color"
        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface-elevated)' }}
      >
        <div className="flex items-center gap-2">
          <span className={`badge ${bug.severity === 'P0' ? 'badge-red' : bug.severity === 'P1' ? 'badge-yellow' : 'badge-blue'}`}>
            {bug.severity}
          </span>
          <span className="font-mono text-xs text-muted">{bug.id}</span>
        </div>
        <button onClick={onClose} className="btn btn-ghost p-1">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
        {/* Title & feature */}
        <div>
          <h3 className="text-base font-semibold mb-1">{bug.title}</h3>
          <p className="text-xs text-muted font-mono mb-1">{bug.affectedFeature}</p>
          {bug.symptom && <p className="text-sm text-secondary">{bug.symptom}</p>}
        </div>

        {/* Root Cause */}
        <div className="card">
          <h4
            className="text-sm font-semibold mb-3 flex items-center gap-2 border-b border-color pb-2"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <AlertTriangle size={16} className="text-accent-yellow" /> Root Cause
          </h4>
          <div className="flex items-center gap-2 mb-2">
            <span className={`badge ${bug.rootCauseStatus === 'confirmed' ? 'badge-green' : 'badge-yellow'}`}>
              {bug.rootCauseStatus}
            </span>
            <span className="text-xs text-muted">Confidence: {(bug.confidence * 100).toFixed(0)}%</span>
          </div>
          {bug.rootCause ? (
            <p className="text-sm">{bug.rootCause}</p>
          ) : (
            <p className="text-sm text-muted italic">Hypothesis — needs more evidence.</p>
          )}
        </div>

        {/* Evidence */}
        <div className="card">
          <h4
            className="text-sm font-semibold mb-3 flex items-center gap-2 border-b border-color pb-2"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <Eye size={16} className="text-accent-blue" /> Evidence ({bug.evidence.length})
          </h4>
          <div
            className="bg-base border border-color p-2 rounded text-xs font-mono text-muted overflow-x-auto"
            style={{ borderColor: 'var(--border-color)' }}
          >
            {bug.evidence.map((ev, i) => {
              const e = ev as Record<string, unknown>;
              return (
                <div key={i} className="mb-1">
                  [{i + 1}] <span className="text-secondary">{String(e['kind'] ?? e['type'] ?? 'evidence')}</span>
                  {e['message'] ? ` — ${String(e['message']).slice(0, 80)}` : ''}
                  {e['path'] ? ` — ${String(e['path'])}` : ''}
                </div>
              );
            })}
          </div>
        </div>

        {/* Repro Steps */}
        {bug.reproSteps && bug.reproSteps.length > 0 && (
          <div className="card">
            <h4
              className="text-sm font-semibold mb-3 flex items-center gap-2 border-b border-color pb-2"
              style={{ borderColor: 'var(--border-color)' }}
            >
              <ChevronRight size={16} className="text-accent-blue" /> Repro Steps
            </h4>
            <ol className="text-sm text-secondary list-decimal list-inside flex flex-col gap-1">
              {bug.reproSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        )}

        {/* Recommended Fix */}
        {recommendedFix && (
          <div className="card">
            <h4
              className="text-sm font-semibold mb-3 flex items-center gap-2 border-b border-color pb-2"
              style={{ borderColor: 'var(--border-color)' }}
            >
              <GitPullRequest size={16} className="text-accent-green" /> Recommended Fix
            </h4>
            <p className="text-sm mb-2 font-medium">{recommendedFix.title}</p>
            {recommendedFix.description !== recommendedFix.title && (
              <p className="text-xs text-secondary mb-2">{recommendedFix.description}</p>
            )}
            <div className="flex flex-wrap gap-2 mb-3 text-xs">
              <span className={`badge ${tierBadgeClass(recommendedFix.tier)}`}>{tierLabel(recommendedFix.tier)}</span>
              <span className="badge badge-blue">effort: {recommendedFix.effort}</span>
              <span className="badge badge-blue">risk: {recommendedFix.risk}</span>
              <span className="text-muted">score: {(recommendedFix.score * 100).toFixed(0)}</span>
            </div>
            {recommendedFix.whyRecommended && (
              <p className="text-xs text-muted mb-3 italic">{recommendedFix.whyRecommended}</p>
            )}

            <div className="flex gap-2">
              <button
                className="btn btn-primary flex-1"
                onClick={() => onApplyFix?.(bug.id, recommendedFix.id)}
              >
                Copy Patch Cmd
              </button>
              <button
                className="btn btn-secondary flex-1"
                onClick={() => { onSkip?.(bug.id); onClose(); }}
              >
                Skip
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
