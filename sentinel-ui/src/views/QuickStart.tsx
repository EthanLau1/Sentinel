import { useState, useEffect } from 'react';
import { useApp } from '../context/AppState';
import { apiClient } from '../api/client';
import {
  Cpu,
  Terminal,
  Cloud,
  Server,
  Sparkles,
  Play,
  CheckCircle2,
  XCircle,
  Loader,
  ArrowRight,
  FolderOpen,
  RefreshCw
} from 'lucide-react';

interface Preset {
  id: string;
  name: string;
  type: 'openai-compatible' | 'ollama-native';
  baseUrl: string;
  model: string;
  hint: string;
  requiresKey: boolean;
}

const PRESETS: Preset[] = [
  {
    id: 'lm-studio',
    name: 'LM Studio',
    type: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'deepseek-r1-distill-qwen-7b',
    hint: '本地桌面运行 · 127.0.0.1:1234 · 免 Key',
    requiresKey: false,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    type: 'ollama-native',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5-coder:7b',
    hint: '本地终端守护 · 127.0.0.1:11434 · 免 Key',
    requiresKey: false,
  },
  {
    id: 'cloud',
    name: '云端 API',
    type: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    hint: 'DeepSeek / OpenAI 兼容协议',
    requiresKey: true,
  },
  {
    id: 'vllm',
    name: 'vLLM',
    type: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: 'Qwen/Qwen2.5-Coder-14B-Instruct',
    hint: '自建高并发服务 · 127.0.0.1:8000',
    requiresKey: false,
  },
  {
    id: 'demo',
    name: '演示模式',
    type: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:4317/mock',
    model: 'sentinel-mock',
    hint: '内置离线体验 · 无需本地模型',
    requiresKey: false,
  },
];

export function QuickStart(): React.JSX.Element {
  const { state, navigate, selectProject, setProjects } = useApp();
  const currentProject = state.projects.find((p) => p.id === state.selectedProjectId);

  const [selectedId, setSelectedId] = useState<string>('lm-studio');
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:1234/v1');
  const [model, setModel] = useState('deepseek-r1-distill-qwen-7b');
  const [apiKey, setApiKey] = useState('');
  const [hasExistingKey, setHasExistingKey] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; status?: number; error?: string } | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Load existing configuration on mount
  useEffect(() => {
    fetch('/api/settings?scope=global')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || !data.configured) return;
        if (data.baseUrl) setBaseUrl(data.baseUrl);
        if (data.model) setModel(data.model);
        if (data.apiKeyConfigured) setHasExistingKey(true);

        const matched = PRESETS.find(
          (p) => p.baseUrl === data.baseUrl || (data.baseUrl && data.baseUrl.includes(p.id))
        );
        if (matched) setSelectedId(matched.id);
      })
      .catch(() => {});
  }, []);

  const handleSelect = async (preset: Preset) => {
    setSelectedId(preset.id);
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
    setTestResult(null);

    // Auto-save preset choice
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: preset.type,
          providerName: preset.id,
          baseUrl: preset.baseUrl,
          apiKey: preset.requiresKey ? apiKey : '',
          model: preset.model,
          scope: 'global',
        }),
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch {
      // silent
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/provider/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, apiKey, model, scope: 'global' }),
      });
      const data = (await res.json()) as { ok: boolean; status?: number; error?: string };
      setTestResult(data);
    } catch (err) {
      setTestResult({ ok: false, error: String(err) });
    }
    setTesting(false);
  };

  const handleChooseProject = async () => {
    try {
      const res = await fetch('/api/pick-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = (await res.json()) as { ok: boolean; path?: string; cancelled?: boolean };
      if (data.cancelled || !data.ok || !data.path) return;

      const suggestedName = data.path.split('/').filter(Boolean).at(-1) ?? 'my-project';
      const created = await apiClient.addProject(data.path, suggestedName);
      const projects = await apiClient.getProjects();
      setProjects(projects);
      selectProject(created.id);
      navigate('run');
    } catch (err) {
      window.alert(`选择项目失败: ${String(err)}`);
    }
  };

  const activePreset = PRESETS.find((p) => p.id === selectedId) ?? PRESETS[0];

  return (
    <div className="flex flex-col h-full justify-between animate-fade-in w-full max-w-4xl">
      <div>
        {/* Header - Clean typography & proper baseline */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-neutral-100">
          <div>
            <h1 className="text-xl font-bold text-neutral-900 tracking-tight">
              快速启航
            </h1>
            <p className="text-xs text-neutral-500 mt-1">
              自动化探查 Web 页面交互与接口，截获运行时异常并由 AI 生成代码补丁。
            </p>
          </div>
          <div className="flex items-center gap-2">
            {savedSuccess && (
              <span className="text-xs text-emerald-600 font-medium">配置已保存 ✓</span>
            )}
            <span className="text-tiny font-mono text-neutral-400 bg-neutral-50 px-2 py-0.5 rounded border border-neutral-200">
              01 / START
            </span>
          </div>
        </div>

        {/* SECTION 1: 模型接口选择（响应式分段开关） */}
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <label className="text-xs font-semibold text-neutral-800 tracking-wide uppercase">
              1. 推理模型接入
            </label>
            <span className="text-xs text-neutral-500">
              {activePreset.hint}
            </span>
          </div>

          {/* Segmented Control - Responsive Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-1.5 p-1 bg-neutral-100 rounded-xl border border-neutral-200">
            {PRESETS.map((preset) => {
              const isSelected = selectedId === preset.id;
              return (
                <button
                  key={preset.id}
                  onClick={() => handleSelect(preset)}
                  className={`py-2 px-2.5 rounded-lg text-xs font-medium transition inline-flex items-center justify-center gap-1.5 cursor-pointer min-h-[34px] ${
                    isSelected
                      ? 'bg-white text-neutral-900 shadow-sm font-semibold'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  {preset.id === 'lm-studio' && <Cpu size={14} />}
                  {preset.id === 'ollama' && <Terminal size={14} />}
                  {preset.id === 'cloud' && <Cloud size={14} />}
                  {preset.id === 'vllm' && <Server size={14} />}
                  {preset.id === 'demo' && <Sparkles size={14} />}
                  <span>{preset.name}</span>
                </button>
              );
            })}
          </div>

          {/* Active Preset Quick Status & Test */}
          <div className="mt-3 p-3 rounded-xl border border-neutral-200 bg-white flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 min-w-0">
              <span className="status-dot status-dot-green"></span>
              <span className="font-mono text-xs text-neutral-800 truncate max-w-xs">{baseUrl}</span>
              <span className="text-neutral-300">|</span>
              <span className="font-mono text-xs text-neutral-500 truncate max-w-xs">{model}</span>
            </div>

            <div className="flex items-center gap-2">
              {testResult && (
                <span className="text-xs inline-flex items-center gap-1">
                  {testResult.ok ? (
                    <span className="text-emerald-600 inline-flex items-center gap-1">
                      <CheckCircle2 size={13} /> 连通正常 (HTTP {testResult.status ?? 200})
                    </span>
                  ) : (
                    <span className="text-red-500 inline-flex items-center gap-1">
                      <XCircle size={13} /> 连接失败
                    </span>
                  )}
                </span>
              )}

              <button
                onClick={runTest}
                disabled={testing}
                className="btn-secondary text-xs py-1 px-2.5 min-h-[30px]"
              >
                {testing ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                <span>{testing ? '测试中' : '测试连通性'}</span>
              </button>
            </div>
          </div>

          {/* Cloud API Key Drawer - Responsive Flex */}
          {activePreset.requiresKey && (
            <div className="mt-2.5 p-3 rounded-xl border border-neutral-200 bg-neutral-50 flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
              <input
                type="text"
                placeholder="Base URL: https://api.deepseek.com/v1"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="input-field text-xs font-mono bg-white flex-1"
              />
              <input
                type="password"
                placeholder={hasExistingKey ? '•••••••• (已保存密钥)' : '输入 API Key'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="input-field text-xs font-mono bg-white flex-1"
              />
              <button
                onClick={() => handleSelect(activePreset)}
                className="btn-primary text-xs px-4 flex-shrink-0"
              >
                保存密钥
              </button>
            </div>
          )}
        </div>

        {/* SECTION 2: 目标项目与运行 - Responsive Card */}
        <div className="mt-6 pt-5 border-t border-neutral-100">
          <label className="block text-xs font-semibold text-neutral-800 tracking-wide uppercase mb-2.5">
            2. 目标项目与操作
          </label>

          <div className="border border-neutral-200 rounded-2xl p-4 sm:p-5 bg-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-800 border border-neutral-200 flex-shrink-0">
                <FolderOpen size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-sm text-neutral-900 truncate">
                  {currentProject ? currentProject.name : '未绑定项目工作区'}
                </div>
                <div className="font-mono text-xs text-neutral-500 mt-0.5 truncate">
                  {currentProject ? currentProject.path : '选择本地 Web 项目目录，即可开始全自动诊断'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto justify-end">
              <button
                onClick={handleChooseProject}
                className="btn-secondary text-xs"
              >
                {currentProject ? '更换目录' : '选择项目目录'}
              </button>

              <button
                onClick={currentProject ? () => navigate('run') : handleChooseProject}
                className="btn-primary text-xs px-4"
              >
                <Play size={13} fill="white" />
                <span>{currentProject ? '启动巡检' : '选择项目并开始'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Footer minimal info: 1 line */}
      <div className="pt-4 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500 mt-4">
        <div>本地沙箱执行 · 源码与密钥绝不出域</div>
        {currentProject && (
          <button
            onClick={() => navigate('overview')}
            className="text-neutral-700 hover:text-black font-medium inline-flex items-center gap-1 cursor-pointer"
          >
            <span>查看上次检查结果</span>
            <ArrowRight size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
