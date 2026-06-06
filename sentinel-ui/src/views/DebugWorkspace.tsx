import { useState, useEffect } from 'react';
import { useApp } from '../context/AppState';
import { apiClient } from '../api/client';
import { BugDetail } from '../components/Debug/BugDetail';
import type { Bug } from '../types';
import { ShieldAlert } from 'lucide-react';

export function DebugWorkspace(): React.JSX.Element {
  const { state } = useApp();
  const project = state.projects.find(p => p.id === state.selectedProjectId);
  
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [selectedBugId, setSelectedBugId] = useState<string | null>(null);
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (project) {
      apiClient.getBugs(project.id).then(setBugs).catch(() => setBugs([]));
    }
  }, [project?.id]);

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-muted">
        <div className="text-center">
          <ShieldAlert size={48} className="mx-auto mb-4 opacity-20" />
          <p>Select a project from the sidebar to view debug results.</p>
        </div>
      </div>
    );
  }

  const handleCopyPatchCommand = (bugId: string, fixId: string): void => {
    const cmd = `git apply .sentinel/auto-patches/${bugId}_${fixId}.diff`;
    navigator.clipboard.writeText(cmd).catch(() => {
      window.prompt('Copy this command:', cmd);
    });
  };

  const handleSkip = (bugId: string): void => {
    setSkippedIds(prev => new Set([...prev, bugId]));
  };

  const selectedBug = bugs.find(b => b.id === selectedBugId);

  return (
    <div className="flex flex-col h-full -m-6">
      {/* Header */}
      <div className="px-6 py-4 border-b border-color" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface)' }}>
        <h2 className="text-xl font-semibold">Debug Results</h2>
        <p className="text-sm text-secondary mt-1">{bugs.length} bug{bugs.length !== 1 ? 's' : ''} found in <strong>{project.name}</strong></p>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          {bugs.length === 0 ? (
            <div className="text-center text-secondary py-12">
              <ShieldAlert size={36} className="mx-auto mb-3 opacity-20" />
              <p className="mb-1">No bugs found.</p>
              <p className="text-xs text-muted">Run a debug session to detect issues.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {bugs.map(bug => (
                <div 
                  key={bug.id} 
                  className="card flex items-center justify-between cursor-pointer transition-colors"
                  onClick={() => setSelectedBugId(bug.id)}
                  style={{ borderColor: selectedBugId === bug.id ? 'var(--accent-blue)' : 'var(--border-color)' }}
                >
                  <div className="flex items-center gap-4">
                    <span className={`badge ${bug.severity === 'P0' ? 'badge-red' : bug.severity === 'P1' ? 'badge-yellow' : 'badge-blue'}`}>
                      {bug.severity}
                    </span>
                    <div>
                      <div className="font-medium text-sm">{bug.title}</div>
                      <div className="text-xs text-muted font-mono">{bug.affectedFeature}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-xs text-secondary">{bug.rootCauseStatus}</div>
                      <div className="text-xs text-muted">{bug.evidence.length} evidence</div>
                    </div>
                    {skippedIds.has(bug.id) ? (
                      <span className="badge badge-blue text-xs">Skipped</span>
                    ) : (
                      <button
                        className="btn btn-secondary btn-sm text-xs py-1 px-2"
                        onClick={(e) => { e.stopPropagation(); setSelectedBugId(bug.id); }}
                      >
                        View
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Side Panel for Bug Detail */}
        {selectedBug && (
          <BugDetail
            bug={selectedBug}
            onClose={() => setSelectedBugId(null)}
            onApplyFix={handleCopyPatchCommand}
            onSkip={handleSkip}
          />
        )}
      </div>
    </div>
  );
}
