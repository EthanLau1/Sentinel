import { useState, useEffect } from 'react';
import { useApp } from '../context/AppState';
import { CheckCircle, XCircle, Loader, Save, Wifi, ArrowRight } from 'lucide-react';

interface TestResult {
  ok: boolean;
  status?: number;
  error?: string;
}

interface SaveResult {
  ok: boolean;
  error?: string;
}

interface LoadedSettings {
  configured: boolean;
  providerName?: string;
  type?: string;
  baseUrl?: string;
  apiKey?: string;
  apiKeyConfigured?: boolean;
  model?: string;
}

export function Settings(): React.JSX.Element {
  const { state, navigate } = useApp();
  const project = state.projects.find(p => p.id === state.selectedProjectId);
  const projectId = project?.id;

  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [scope, setScope] = useState<'global' | 'project'>('global');
  const scopeKey = scope + ':' + (projectId ?? '');
  const [loadedKey, setLoadedKey] = useState('');
  const [loadError, setLoadError] = useState('');

  // Form state
  const [providerType, setProviderType] = useState('openai-compatible');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [hasExistingKey, setHasExistingKey] = useState(false);

  useEffect(() => {
    if (scope === 'project' && !projectId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ scope, ...(scope === 'project' && projectId ? { projectId } : {}) });
    fetch('/api/settings?' + query, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json() as Promise<LoadedSettings>;
      })
      .then(data => {
        setProviderType(data.type ?? 'openai-compatible');
        setBaseUrl(data.baseUrl ?? '');
        setModel(data.model ?? '');
        setApiKey('');
        setHasExistingKey(data.apiKeyConfigured === true);
        setLoadError('');
        setLoadedKey(scopeKey);
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          setLoadError(String(err));
          setLoadedKey(scopeKey);
        }
      });
    return () => controller.abort();
  }, [scope, projectId, scopeKey]);

  const runConnectivityTest = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/provider/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, apiKey, model, scope, projectId }),
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
          type: providerType,
          baseUrl,
          apiKey,
          model,
          scope,
          ...(scope === 'project' ? { projectId } : {}),
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
    queueMicrotask(() => {
      setTestResult(null);
      setSaveResult(null);
    });
  }, [projectId, scope]);

  if (loadedKey !== scopeKey) {
    return (
      <div className="max-w-2xl mx-auto flex items-center justify-center" style={{ paddingTop: '4rem' }}>
        <Loader size={20} className="animate-spin" style={{ color: 'var(--accent-blue)' }} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold mb-1">Step 1: Setup</h2>
        <p className="text-secondary text-sm">
          Configure your LLM provider. Sentinel uses AI to analyze bugs and generate fixes.
        </p>
      </div>

      <div className="flex gap-2 mb-4" role="group" aria-label="Configuration scope">
        <button className={`btn ${scope === 'global' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setScope('global')}>Global default</button>
        <button className={`btn ${scope === 'project' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setScope('project')} disabled={!projectId}>Project override</button>
      </div>
      {scope === 'project' && <p className="text-sm text-secondary mb-4">{project?.name}: settings saved here override the global default. Leave unconfigured to use the global default.</p>}
      {loadError && <p role="alert" className="text-accent-red mb-4">Unable to load settings: {loadError}</p>}

      {/* LLM Configuration Form */}
      <div className="card mb-6">
        <h3 className="font-semibold mb-4 pb-2 border-b border-color" style={{ borderColor: 'var(--border-color)' }}>
          LLM Provider Configuration
        </h3>

        <div className="flex flex-col gap-4">
          {/* Type */}
          <div>
            <label className="block text-sm font-medium mb-1">Type</label>
            <select
              className="w-full px-3 py-2 rounded text-sm"
              style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              value={providerType}
              onChange={e => setProviderType(e.target.value)}
            >
              <option value="openai-compatible">Cloud API (OpenAI, Anthropic, MiniMax, DeepSeek, Groq...)</option>
              <option value="ollama-native">Local Model (Ollama, LM Studio, LocalAI)</option>
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
              placeholder={providerType === 'ollama-native' ? 'http://localhost:11434' : 'https://api.minimaxi.com/v1'}
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
                onChange={e => { setApiKey(e.target.value); setHasExistingKey(false); }}
                placeholder={hasExistingKey ? '••• Already configured (type new key to change)' : 'your-api-key'}
              />
              {hasExistingKey && !apiKey && (
                <p className="text-xs mt-1" style={{ color: 'var(--accent-green)' }}>
                  ✓ API Key already saved. Leave empty to keep current key.
                </p>
              )}
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
              placeholder="e.g. MiniMax-M3, gpt-4o, qwen3:7b"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-2">
            <button
              className="btn btn-primary"
              onClick={saveSettings}
              disabled={saving || Boolean(loadError)}
            >
              {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Saving…' : 'Save'}
            </button>

            <button
              className="btn"
              onClick={runConnectivityTest}
              disabled={testing || !baseUrl}
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

      {/* Next Step Guide — shows after save */}
      {saveResult?.ok && (
        <button
          className="card mb-6 card-interactive w-full text-left"
          onClick={() => navigate('run')}
          style={{
            cursor: 'pointer',
            borderColor: 'var(--accent-green)',
            borderLeftWidth: '3px',
            padding: '1rem 1.25rem',
            display: 'block',
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-green)', marginBottom: '0.25rem' }}>
                ✓ STEP 1 COMPLETE
              </p>
              <p style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                Next: Add a project and run debug
              </p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Click here to go to Step 2 → Select your web project folder → Click Run
              </p>
            </div>
            <ArrowRight size={20} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
          </div>
        </button>
      )}

      {/* Info */}
      <div className="card">
        <h3 className="font-semibold mb-3 pb-2 border-b border-color" style={{ borderColor: 'var(--border-color)' }}>
          Supported Providers
        </h3>
        <ul className="text-sm text-secondary flex flex-col gap-2">
          <li>• <strong>OpenAI Compatible</strong> — OpenAI, MiniMax, DeepSeek, Groq, Together AI, etc.</li>
          <li>• <strong>Ollama Native</strong> — Local models via Ollama or LM Studio (free, no key)</li>
        </ul>
      </div>
    </div>
  );
}
