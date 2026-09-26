import type { RunSummary } from '../types';

export function RunSummaryPanel({ summary }: { summary: RunSummary | null }): React.JSX.Element | null {
  if (!summary) return null;
  const metrics = [
    ['Planned', summary.plannedFlows],
    ['Passed', summary.passedFlows],
    ['Failed', summary.failedFlows],
    ['Not tested', summary.untestedFlows],
    ['Bugs', summary.bugCount],
    ['Pages found', summary.discoveredPages ?? '—'],
    ['API routes found', summary.discoveredApi ?? '—'],
  ] as const;

  return (
    <section className="border-y py-4" style={{ borderColor: 'var(--border-color)' }} aria-label="Latest run result">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium">Latest run result</h3>
        <span className="text-sm text-secondary">{summary.status}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <div className="text-xs text-muted">{label}</div>
            <div className="font-semibold">{value}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 mt-3 text-xs text-secondary">
        <span>Cost: {summary.costUsd == null ? 'unknown' : '$' + summary.costUsd.toFixed(4)}</span>
        <span>Duration: {(summary.durationMs / 1000).toFixed(1)}s</span>
        {Array.isArray(summary.coverageRisks) && summary.coverageRisks.length > 0 && (
          <details className="w-full">
            <summary className="cursor-pointer">Coverage risks ({summary.coverageRisks.length})</summary>
            <ul className="mt-2 space-y-1">
              {summary.coverageRisks.map(risk => (
                <li key={risk.id}>{risk.description}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
