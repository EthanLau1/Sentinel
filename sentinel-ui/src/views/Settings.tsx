import { useState, useEffect } from 'react';
import { useApp } from '../context/AppState';
import { CheckCircle2, XCircle, Loader, ArrowLeft } from 'lucide-react';

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
  const project = state.projects.find((p) => p.id === state.selectedProjectId);
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
  const [providerName, setProviderName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [hasExistingKey, setHasExistingKey] = useState(false);

  useEffect(() => {
    if (scope === 'project' && !projectId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      scope,
      ...(scope === 'project' && projectId ? { projectId } : {}),
    });
    fetch('/api/settings?' + query, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json() as Promise<LoadedSettings>;
      })
      .then((data) => {
        setProviderType(data.type ?? 'openai-compatible');
        setProviderName(data.providerName ?? '');
        setBaseUrl(data.baseUrl ?? '');
        setModel(data.model ?? '');
        setApiKey('');
        setHasExistingKey(data.apiKeyConfigured === true);
        setLoadError('');
        setLoadedKey(scopeKey);
      })
      .catch((err) => {
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
      const data = (await res.json()) as TestResult;
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
          ...(providerName ? { providerName } : {}),
          baseUrl,
          apiKey,
          model,
          scope,
          ...(scope === 'project' ? { projectId } : {}),
        }),
      });
      const data = (await res.json()) as SaveResult;
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
      <div className="flex flex-col items-center justify-center h-full py-20 text-center">
        <Loader size={20} className="animate-spin text-neutral-400 mb-2" />
        <span className="text-xs text-neutral-400">正在读取配置…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full justify-between">
      <div>
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-neutral-900 tracking-tight">
              模型与规则配置
            </h2>
            <p className="text-xs text-neutral-500 mt-1">
              配置用于根因分析与代码修复的 LLM 供应商，可按项目覆盖默认配置。
            </p>
          </div>
          <div className="border border-neutral-200 rounded px-2.5 py-1 text-xs font-mono text-neutral-500 uppercase tracking-wider">
            05 / SETTINGS
          </div>
        </div>

        {/* Top Status Strip */}
        <div className="border border-neutral-200 rounded-xl p-3.5 flex items-center justify-between bg-white mt-5">
          <div className="flex items-center gap-2 text-xs font-medium text-neutral-800">
            <span className="status-dot status-dot-green"></span>
            <span>
              当前作用域：{scope === 'global' ? '全局默认配置 (~/.sentinel/llm.yml)' : `${project?.name} 专属覆盖`}
            </span>
          </div>

          <div className="flex gap-1.5">
            <button
              onClick={() => setScope('global')}
              className={`px-3 py-1 text-xs rounded-lg font-medium transition cursor-pointer border ${
                scope === 'global'
                  ? 'bg-black text-white border-black'
                  : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
              }`}
            >
              全局默认
            </button>
            <button
              onClick={() => setScope('project')}
              disabled={!projectId}
              className={`px-3 py-1 text-xs rounded-lg font-medium transition cursor-pointer border ${
                scope === 'project'
                  ? 'bg-black text-white border-black'
                  : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
              }`}
            >
              项目专属
            </button>
          </div>
        </div>

        {loadError && (
          <div className="border border-neutral-200 bg-neutral-50 text-neutral-700 p-3 rounded-xl text-xs mt-3">
            无法读取配置文件: {loadError}
          </div>
        )}

        {/* Two-Card Grid - Responsive */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 mt-4 sm:mt-5">
          {/* Card 1: 模型参数输入 */}
          <div className="border border-neutral-200 rounded-xl p-5 bg-white flex flex-col justify-between">
            <div className="flex flex-col gap-3">
              <div>
                <div className="font-bold text-sm text-neutral-900">
                  供应商与端点
                </div>
                <div className="text-xs text-neutral-500 mt-0.5 mb-2">
                  选择模型协议及目标接口 Base URL。
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  接口协议类型
                </label>
                <select
                  value={providerType}
                  onChange={(e) => setProviderType(e.target.value)}
                  className="input-field"
                >
                  <option value="openai-compatible">OpenAI-Compatible (DeepSeek / MiniMax / OpenAI / Qwen)</option>
                  <option value="ollama-native">Ollama 本地原生 (127.0.0.1:11434)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Base URL 地址
                </label>
                <input
                  type="text"
                  placeholder="https://api.openai.com/v1 或 http://127.0.0.1:11434"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  模型标识 (Model)
                </label>
                <input
                  type="text"
                  placeholder="如: deepseek-chat, gpt-4o, qwen2.5-coder"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  API 密钥 (API Key)
                </label>
                <input
                  type="password"
                  placeholder={hasExistingKey ? '•••••••• (已配置，留空保留原值)' : 'sk-...'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="input-field"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 mt-2 pt-3 border-t border-neutral-100">
                <button
                  onClick={saveSettings}
                  disabled={saving}
                  className="btn-primary flex-1 justify-center"
                >
                  {saving ? <Loader className="animate-spin" size={13} /> : null}
                  {saving ? '保存中…' : '保存配置'}
                </button>

                <button
                  onClick={runConnectivityTest}
                  disabled={testing}
                  className="btn-secondary"
                >
                  {testing ? <Loader className="animate-spin" size={13} /> : null}
                  {testing ? '测试中…' : '测试连接'}
                </button>
              </div>

              {/* Save & Test Results */}
              {saveResult && (
                <div
                  className={`p-2.5 rounded-lg text-xs flex items-center gap-2 border ${
                    saveResult.ok
                      ? 'border-neutral-200 bg-neutral-50 text-neutral-800'
                      : 'border-neutral-300 bg-neutral-100 text-neutral-900'
                  }`}
                >
                  {saveResult.ok ? (
                    <CheckCircle2 size={14} className="text-black" />
                  ) : (
                    <XCircle size={14} className="text-black" />
                  )}
                  <span>{saveResult.ok ? '配置已成功持久化至磁盘。' : `保存失败: ${saveResult.error}`}</span>
                </div>
              )}

              {testResult && (
                <div
                  className={`p-2.5 rounded-lg text-xs flex items-center gap-2 border ${
                    testResult.ok
                      ? 'border-neutral-200 bg-neutral-50 text-neutral-800'
                      : 'border-neutral-300 bg-neutral-100 text-neutral-900'
                  }`}
                >
                  {testResult.ok ? (
                    <CheckCircle2 size={14} className="text-black" />
                  ) : (
                    <XCircle size={14} className="text-black" />
                  )}
                  <span>
                    {testResult.ok
                      ? '连接测试通过：通道畅通且响应正常。'
                      : `测试失败: ${testResult.error}`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Card 2: 预算护栏与离线模式 */}
          <div className="border border-neutral-200 rounded-xl p-5 bg-white flex flex-col justify-between">
            <div>
              <div className="font-bold text-sm text-neutral-900">
                规则护栏与隐私准则
              </div>
              <div className="text-xs text-neutral-500 mt-0.5 mb-4">
                Sentinel 自带确定性护栏，避免模型死循环或意外开销。
              </div>

              <div className="flex flex-col gap-2.5 text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-neutral-100 bg-neutral-50/50">
                  <span className="text-neutral-600 font-medium">离线自治能力 (Offline Mode)</span>
                  <span className="font-medium text-neutral-900">原生支持</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-neutral-100 bg-neutral-50/50">
                  <span className="text-neutral-600 font-medium">知识检索限流 (宪法硬条款)</span>
                  <span className="font-mono text-neutral-800">≤ 30% 流程占比</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-neutral-100 bg-neutral-50/50">
                  <span className="text-neutral-600 font-medium">多模态截图传输 (Vision)</span>
                  <span className="font-mono text-neutral-700">默认关闭 (需显式开启)</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-neutral-100 bg-neutral-50/50">
                  <span className="text-neutral-600 font-medium">配置文件磁盘权限</span>
                  <span className="font-mono text-neutral-800">0600 (仅当前用户只读写)</span>
                </div>
              </div>
            </div>

            <div className="p-3 rounded-lg border border-neutral-100 bg-neutral-50/50 text-xs text-neutral-500 leading-relaxed mt-4">
              提示：若不配置任何 LLM 密钥，Sentinel 将自动启用确定性离线模式，依然能够无损扫描页面、捕获控制台报错、网络失败并生成完整的测试报告。
            </div>
          </div>
        </div>

        {/* Bottom Informational Strips */}
        <div className="border border-neutral-200 bg-neutral-50/60 rounded-xl p-3 text-xs text-neutral-600 font-mono mt-5">
          全局配置路径: ~/.sentinel/llm.yml · 单价与预算: .sentinel/budget.yml
        </div>
        <div className="border border-neutral-200 bg-neutral-50/60 rounded-xl p-3 text-xs text-neutral-500 mt-2">
          所有 API 密钥仅在与配置的端点交互时读取，不记录在版本控制，也不向任何第三方遥测上报。
        </div>
      </div>

      {/* Bottom Step Navigation */}
      <div className="border-t border-neutral-100 pt-5 mt-6 flex items-center justify-between">
        <div className="font-mono text-xs text-neutral-400 font-medium">
          05 / 05
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('debug')} className="btn-secondary">
            <ArrowLeft size={13} /> 上一步: 缺陷工单 (04)
          </button>
        </div>
      </div>
    </div>
  );
}
