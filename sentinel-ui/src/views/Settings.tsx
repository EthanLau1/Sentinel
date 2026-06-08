import { useState, useEffect } from 'react';
import { useApp } from '../context/AppState';
import { CheckCircle, XCircle, Loader, Save, Wifi } from 'lucide-react';

interface TestResult {
  ok: boolean;
  status?: number;
  error?: string;
}

interface SaveResult {
  ok: boolean;
  error?: string;
}

export function Settings(): React.JSX.Element {
  const { state } = useApp();
  const project = state.projects.find(p => p.id === state.selectedProjectId);

  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);

  // Form state
  const [providerName, setProviderName] = useState('minimax');
  const [providerType, setProviderType] = useState('openai-compatible');
  const [baseUrl, setBaseUrl] = useState('https://api.minimaxi.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('MiniMax-M3');

  const runConnectivityTest = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/provider/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, apiKey, model }),
      });
      const data = await res.json() as TestResult;
      setTestResult(data);
    } catch (err) {
      setTestResult({ ok: false, error: String(err) });
    }
    setTesting(false);
  };

  const saveSettings = async (): Promise<void> => {
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerName,
          type: providerType,
          baseUrl,
          apiKey,
          model,
          projectId: state.selectedProjectId,
        }),
      });
      const data = await res.json() as SaveResult;
      setSaveResult(data);
    } catch (err) {
      setSaveResult({ ok: false, error: String(err) });
    }
    setSaving(false);
  };

  useEffect(() => {
    setTestResult(null);
    setSaveResult(null);
  }, [project?.id]);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold mb-1">Settings</h2>
        <p className="text-secondary text-sm">
          Configure LLM provider for Sentinel debug analysis.
          {project && <span> Current project: <strong>{project.name}</strong></span>}
        </p>
      </div>

      {/* LLM Configuration Form */}
      <div className="card mb-6">
        <h3 className="font-semibold mb-4 pb-2 border-b border-color" style={{ borderColor: 'var(--border-color)' }}>
          LLM Provider
        </h3>

        <div className="flex flex-col gap-4">
          {/* Provider Name */}
          <div>
            <label className="block text-sm font-medium mb-1">Provider Name</label>
            <input
              type="text"
              className="w-full px-3 py-2 rounded text-sm"
              style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              value={providerName}
              onChange={e => setProviderName(e.target.value)}
              placeholder="my-provider"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm font-medium mb-1">Type</label>
            <select
              className="w-full px-3 py-2 rounded text-sm"
              style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              value={providerType}
              onChange={e => setProviderType(e.target.value)}
            >
              <option value="openai-compatible">OpenAI Compatible</option>
              <option value="ollama-native">Ollama Native (Local)</option>
            </select>
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-sm font-medium mb-1">Base URL</label>
            <input
              type="text"
              className="w-full px-3 py-2 rounded text-sm"
              style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder={providerType === 'ollama-native' ? 'http://localhost:11434' : 'https://api.example.com/v1'}
            />
          </div>

          {/* API Key */}
          {providerType === 'openai-compatible' && (
            <div>
              <label className="block text-sm font-medium mb-1">API Key</label>
              <input
                type="password"
                className="w-full px-3 py-2 rounded text-sm"
                style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-..."
              />
              <p className="text-xs text-muted mt-1">
                Tip: You can also use environment variable syntax like {'${MINIMAX_API_KEY}'}
              </p>
            </div>
          )}

          {/* Model */}
          <div>
            <label className="block text-sm font-medium mb-1">Model</label>
            <input
              type="text"
              className="w-full px-3 py-2 rounded text-sm"
              style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="gpt-4o / qwen3:7b / ..."
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-2">
            <button
              className="btn btn-primary"
              onClick={saveSettings}
              disabled={saving}
            >
              {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Saving…' : 'Save Configuration'}
            </button>

            <button
              className="btn"
              onClick={runConnectivityTest}
              disabled={testing}
              style={{ border: '1px solid var(--border-color)' }}
            >
              {testing ? <Loader size={14} className="animate-spin" /> : <Wifi size={14} />}
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
          </div>

          {/* Results */}
          <div className="flex flex-col gap-2">
            {saveResult && (
              <span className={`flex items-center gap-1 text-sm ${saveResult.ok ? 'text-accent-green' : 'text-accent-red'}`}>
                {saveResult.ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
                {saveResult.ok ? 'Configuration saved!' : `Save failed: ${saveResult.error}`}
              </span>
            )}
            {testResult && (
              <span className={`flex items-center gap-1 text-sm ${testResult.ok ? 'text-accent-green' : 'text-accent-red'}`}>
                {testResult.ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
                {testResult.ok ? 'LLM connected successfully!' : `Connection failed: ${testResult.error ?? `HTTP ${testResult.status}`}`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="card">
        <h3 className="font-semibold mb-3 pb-2 border-b border-color" style={{ borderColor: 'var(--border-color)' }}>
          How it works
        </h3>
        <ul className="text-sm text-secondary flex flex-col gap-2">
          <li>• Save writes <code className="bg-surface-elevated px-1 rounded text-xs">~/.sentinel/llm.yml</code> (global default for all projects)</li>
          {project && (
            <li>• Also writes to <code className="bg-surface-elevated px-1 rounded text-xs">{project.path}/.sentinel/llm.yml</code></li>
          )}
          <li>• New projects will automatically use your global config</li>
          <li>• Supports any OpenAI-compatible API (OpenAI, MiniMax, DeepSeek, etc.) or local Ollama</li>
        </ul>
      </div>
    </div>
  );
}
