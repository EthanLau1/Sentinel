import { useState, useRef } from 'react';
import { useApp } from '../context/AppState';
import { apiClient } from '../api/client';
import { Play, Square, Loader, CheckCircle, Terminal, FolderPlus } from 'lucide-react';

export function RunCenter() {
  const { state, setProjects, selectProject } = useApp();
  const project = state.projects.find(p => p.id === state.selectedProjectId);

  const [isRunning, setIsRunning] = useState(false);
  const [runMode, setRunMode] = useState<'scan' | 'debug' | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [logs, setLogs] = useState<{ time: string; msg: string }[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const handleAddProject = async (): Promise<void> => {
    try {
      // Call backend to open macOS system folder picker
      const res = await fetch('/api/pick-folder');
      const data = await res.json() as { ok: boolean; path?: string; cancelled?: boolean; error?: string };

      if (data.cancelled || !data.ok) return;
      if (!data.path) return;

      const path = data.path;
      const suggestedName = path.split('/').filter(Boolean).at(-1) ?? 'project';
      const nameInput = window.prompt('Give it a short name (optional):', suggestedName);
      const name = nameInput?.trim() ? nameInput.trim() : undefined;

      const created = await apiClient.addProject(path, name);
      const projects = await apiClient.getProjects();
      setProjects(projects);
      selectProject(created.id);
    } catch (err) {
      window.alert(`Failed to add project: ${String(err)}`);
    }
  };

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-muted">
        <div className="text-center">
          <FolderPlus size={48} className="mx-auto mb-4 opacity-40" style={{ color: 'var(--accent-blue)' }} />
          <p className="mb-2" style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Add a project to debug
          </p>
          <p className="mb-6" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Select your web project folder, then click Run Debug.
          </p>
          <button onClick={handleAddProject} className="btn btn-primary">
            <FolderPlus size={16} /> Add Project
          </button>
        </div>
      </div>
    );
  }

  const runFlow = async (mode: 'scan' | 'debug') => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsRunning(true);
    setRunMode(mode);
    setCurrentStep(0);
    setLogs([{
      time: new Date().toLocaleTimeString(),
      msg: mode === 'scan' ? 'Starting project scan…' : 'Starting debug session…',
    }]);

    const runner = mode === 'scan' ? apiClient.scanProject : apiClient.runDebug;
    await runner(
      project.id,
      (step, msg) => {
        setCurrentStep(step);
        setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg }]);
      },
      ctrl.signal,
    );

    setIsRunning(false);
    setCurrentStep(prev => (prev < 6 ? 6 : prev));
    setLogs(prev => [...prev, {
      time: new Date().toLocaleTimeString(),
      msg: mode === 'scan' ? 'Scan complete.' : 'Run complete.',
    }]);
  };

  const stopRun = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg: `${runMode === 'scan' ? 'Scan' : 'Run'} stopped by user.` }]);
  };

  const steps = [
    'Checking setup',
    'Mapping project',
    'Collecting evidence',
    'Analyzing bugs',
    'Planning fixes',
    'Writing report',
  ];

  return (
    <div className="max-w-4xl mx-auto flex flex-col h-full">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold mb-1">Run Center</h2>
          <p className="text-secondary text-sm">Execute diagnostic and mapping commands for <strong>{project.name}</strong>.</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-secondary"
            onClick={() => runFlow('scan')}
            disabled={isRunning}
          >
            Scan Project
          </button>
          <button
            onClick={() => runFlow('debug')}
            disabled={isRunning}
            className={`btn ${isRunning ? 'btn-secondary' : 'btn-primary'}`}
          >
            {isRunning ? <Loader className="animate-spin" size={16} /> : <Play size={16} />}
            {isRunning ? (runMode === 'scan' ? 'Scanning…' : 'Running…') : 'Run Debug'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 flex-1 min-h-0">
        {/* Progress Sidebar */}
        <div className="card md:col-span-1 flex flex-col gap-4">
          <h3 className="font-medium border-b border-color pb-2" style={{ borderColor: 'var(--border-color)' }}>
            Progress
          </h3>

          <div className="flex flex-col gap-3">
            {steps.map((stepName, idx) => {
              const stepNumber = idx + 1;
              const isPast = currentStep > stepNumber;
              const isCurrent = currentStep === stepNumber;

              return (
                <div key={idx} className="flex items-center gap-3">
                  {isPast ? (
                    <CheckCircle size={18} className="text-accent-green" />
                  ) : isCurrent ? (
                    <Loader size={18} className="text-accent-blue animate-spin" />
                  ) : (
                    <div
                      className="w-[18px] h-[18px] rounded-full border-2"
                      style={{ borderColor: 'var(--border-color)' }}
                    />
                  )}
                  <span
                    className={`text-sm ${
                      isCurrent ? 'font-medium text-primary' : isPast ? 'text-secondary' : 'text-muted'
                    }`}
                  >
                    Step {stepNumber}/6: {stepName}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-auto pt-4 border-t border-color" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted">Provider:</span>
              <span>{project.provider}</span>
            </div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted">Status:</span>
              <span className={`badge ${project.status === 'fresh' ? 'badge-green' : project.status === 'possibly_stale' ? 'badge-yellow' : 'badge-blue'}`}>
                {project.status}
              </span>
            </div>
          </div>
        </div>

        {/* Real-time Logs */}
        <div
          className="card md:col-span-2 flex flex-col h-full"
          style={{ padding: 0, overflow: 'hidden' }}
        >
          <div
            className="p-3 border-b border-color flex items-center justify-between"
            style={{ backgroundColor: 'var(--bg-surface-elevated)', borderColor: 'var(--border-color)' }}
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <Terminal size={16} /> Console Output
            </div>
            {isRunning && (
              <button onClick={stopRun} className="btn btn-ghost text-xs py-1 px-2">
                <Square size={12} fill="currentColor" /> Stop
              </button>
            )}
          </div>
          <div
            className="flex-1 p-4 overflow-y-auto font-mono text-xs"
            style={{ backgroundColor: '#0d0d0d' }}
          >
            {logs.length === 0 ? (
              <div className="text-muted italic">No logs yet. Click 'Run Debug' to start.</div>
            ) : (
              logs.map((l, i) => (
                <div key={i} className="mb-1" style={{ color: '#e2e8f0' }}>
                  <span style={{ color: '#64748b' }} className="mr-2">[{l.time}]</span>
                  {l.msg}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
