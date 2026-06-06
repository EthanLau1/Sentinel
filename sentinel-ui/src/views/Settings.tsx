import { useState, useEffect } from 'react';
import { useApp } from '../context/AppState';
import { CheckCircle, XCircle, Loader, Terminal, Wifi } from 'lucide-react';

interface TestResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export function Settings(): React.JSX.Element {
  const { state } = useApp();
  const project = state.projects.find(p => p.id === state.selectedProjectId);

  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const projectPath = project?.path ?? '(select a project)';

  const runConnectivityTest = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/provider/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json() as TestResult;
      setTestResult(data);
    } catch (err) {
      setTestResult({ ok: false, error: String(err) });
    }
    setTesting(false);
  };

  useEffect(() => {
    setTestResult(null);
  }, [project?.id]);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold mb-1">Setup</h2>
        <p className="text-secondary text-sm">Verify LLM connectivity and view configuration paths.</p>
      </div>

      {/* Connectivity Test */}
      <div className="card mb-6">
        <h3 className="font-semibold mb-4 pb-2 border-b border-color" style={{ borderColor: 'var(--border-color)' }}>
          <Wifi size={16} className="inline mr-2" style={{ color: 'var(--accent-blue)' }} />
          LLM Connectivity
        </h3>

        <p className="text-sm text-secondary mb-4">
          Test whether the configured LLM provider is reachable.
        </p>

        <div className="flex items-center gap-3 mb-4">
          <button
            className="btn btn-primary"
            onClick={runConnectivityTest}
            disabled={testing}
          >
            {testing ? <Loader size={14} className="animate-spin" /> : <Wifi size={14} />}
            {testing ? 'Testing…' : 'Test Connection'}
          </button>

          {testResult && (
            <span className={`flex items-center gap-1 text-sm ${testResult.ok ? 'text-accent-green' : 'text-accent-red'}`}>
              {testResult.ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
              {testResult.ok ? 'Connected' : `Failed: ${testResult.error ?? `HTTP ${testResult.status}`}`}
            </span>
          )}
        </div>
      </div>

      {/* Configuration Guide */}
      <div className="card mb-6">
        <h3 className="font-semibold mb-4 pb-2 border-b border-color" style={{ borderColor: 'var(--border-color)' }}>
          <Terminal size={16} className="inline mr-2" style={{ color: 'var(--accent-blue)' }} />
          Configuration
        </h3>

        <p className="text-sm text-secondary mb-3">
          Sentinel reads LLM settings from <code className="bg-surface-elevated px-1 rounded text-xs">.sentinel/llm.yml</code> in your project directory. Edit this file to change providers:
        </p>

        <div
          className="p-3 rounded font-mono text-xs mb-4 overflow-x-auto"
          style={{ backgroundColor: '#0d0d0d', color: '#e2e8f0' }}
        >
          <div style={{ color: '#64748b' }}># {projectPath}/.sentinel/llm.yml</div>
          <div>&nbsp;</div>
          <div><span style={{ color: '#7dd3fc' }}>default</span>: my-provider</div>
          <div>&nbsp;</div>
          <div><span style={{ color: '#7dd3fc' }}>providers</span>:</div>
          <div>  <span style={{ color: '#7dd3fc' }}>my-provider</span>:</div>
          <div>    <span style={{ color: '#7dd3fc' }}>type</span>: openai-compatible</div>
          <div>    <span style={{ color: '#7dd3fc' }}>baseUrl</span>: https://api.example.com/v1</div>
          <div>    <span style={{ color: '#7dd3fc' }}>apiKey</span>: your-key</div>
          <div>    <span style={{ color: '#7dd3fc' }}>model</span>: model-name</div>
        </div>

        <p className="text-xs text-muted">
          After editing, click "Test Connection" above to verify. Run <code className="bg-surface-elevated px-1 rounded">sentinel doctor</code> for a full environment check.
        </p>
      </div>

      {/* Useful Commands */}
      <div className="card">
        <h3 className="font-semibold mb-4 pb-2 border-b border-color" style={{ borderColor: 'var(--border-color)' }}>
          Useful Commands
        </h3>
        <div className="flex flex-col gap-2 font-mono text-xs">
          <div className="flex justify-between items-center p-2 rounded" style={{ backgroundColor: 'var(--bg-base)' }}>
            <span>sentinel doctor --project={projectPath}</span>
            <span className="text-muted">Check setup</span>
          </div>
          <div className="flex justify-between items-center p-2 rounded" style={{ backgroundColor: 'var(--bg-base)' }}>
            <span>sentinel hello --project={projectPath}</span>
            <span className="text-muted">Test LLM</span>
          </div>
          <div className="flex justify-between items-center p-2 rounded" style={{ backgroundColor: 'var(--bg-base)' }}>
            <span>sentinel init --project={projectPath}</span>
            <span className="text-muted">Initialize</span>
          </div>
        </div>
      </div>
    </div>
  );
}
