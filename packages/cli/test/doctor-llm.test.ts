import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  close: vi.fn(),
  ariaSnapshot: vi.fn(),
  ollamaChat: vi.fn(),
  openaiChat: vi.fn(),
}));

vi.mock('playwright', () => ({ chromium: { launch: mocks.launch } }));
vi.mock('@sentinel/providers', () => ({
  createOpenAICompatibleProvider: () => ({ chat: mocks.openaiChat }),
  createOllamaNativeProvider: () => ({ chat: mocks.ollamaChat }),
}));

import { collectConfigChecks, runDoctor } from '../src/doctor.js';
import { loadLlmConfig } from '../src/config.js';

// 造一个"已初始化"的项目目录 —— .sentinel/ 存在是 doctor 的**阻塞项**，
// 缺了它 exit 1 是正确行为（项目还没 init），不是我们要测的东西。
const PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'sentinel-doctor-llm-'));
mkdirSync(join(PROJECT_ROOT, '.sentinel'), { recursive: true });

vi.mock('../src/config.js', async () => {
  const actual = await vi.importActual<typeof import('../src/config.js')>('../src/config.js');
  return {
    ...actual,
    projectRoot: () => PROJECT_ROOT,
    loadLlmConfig: vi.fn(),
    // loadBudgetConfig 用**真实实现** —— 它才是 budget.yml 校验的第一道关，
    // mock 掉它的话"非法 limits 必须阻塞"这条根本测不到。
    loadBudgetConfig: actual.loadBudgetConfig,
  };
});

const mockedLlm = vi.mocked(loadLlmConfig);

describe('doctor 的 LLM 探测（不许给出误导建议）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedLlm.mockReset();
  });

  it('openai-compatible 缺 apiKey → 直接报"缺 apiKey"，绝不回退去探 Ollama', async () => {
    mockedLlm.mockResolvedValue({
      default: 'cloud',
      providers: {
        cloud: { type: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'm' },
      },
    });
    const checks = await collectConfigChecks('/private/tmp/sentinel-doctor-test-missing');
    const llm = checks.find((c) => c.name === 'LLM API');
    expect(llm).toBeDefined();
    expect(llm!.status).toBe('fail');
    // 以前这里会回退去探 Ollama，把 "Ollama HTTP 404" 解释成 "baseUrl 漏了 /v1" ——
    // 一条彻底误导的建议（用户的问题是缺 key）。
    expect(llm!.message).toContain('apiKey');
    expect(llm!.message).not.toContain('漏了 /v1');
    expect(mocks.ollamaChat).not.toHaveBeenCalled();
    expect(mocks.openaiChat).not.toHaveBeenCalled();
  });

  it('openai-compatible 缺 baseUrl → 报缺 baseUrl（不是缺 key）', async () => {
    mockedLlm.mockResolvedValue({
      default: 'cloud',
      providers: { cloud: { type: 'openai-compatible', apiKey: 'k', model: 'm' } },
    });
    const checks = await collectConfigChecks('/private/tmp/sentinel-doctor-test-missing');
    const llm = checks.find((c) => c.name === 'LLM API');
    expect(llm!.message).toContain('baseUrl');
    expect(mocks.ollamaChat).not.toHaveBeenCalled();
  });

  it('ollama-native 的 404 按模型名解释，不说"baseUrl 漏了 /v1"', async () => {
    mockedLlm.mockResolvedValue({
      default: 'local',
      providers: { local: { type: 'ollama-native', baseUrl: 'http://localhost:11434', model: 'qwen3' } },
    });
    mocks.ollamaChat.mockRejectedValue(new Error('HTTP 404 model not found'));
    const checks = await collectConfigChecks('/private/tmp/sentinel-doctor-test-missing');
    const llm = checks.find((c) => c.name === 'LLM API');
    expect(llm!.status).toBe('fail');
    expect(llm!.suggestion).toContain('模型');
    expect(llm!.suggestion).not.toContain('漏了 /v1');
  });

  it('配置里引用了但没设置的环境变量 → 点名说出来', async () => {
    mockedLlm.mockResolvedValue({
      default: 'cloud',
      providers: {
        cloud: { type: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'm' },
      },
      missingEnvVars: ['SENTINEL_API_KEY'],
    });
    const checks = await collectConfigChecks('/private/tmp/sentinel-doctor-test-missing');
    const env = checks.find((c) => c.name === '环境变量');
    expect(env).toBeDefined();
    expect(env!.status).toBe('fail');
    expect(env!.message).toContain('SENTINEL_API_KEY');
  });
});

describe('doctor 退出码语义（提示必须和实际行为一致）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedLlm.mockReset();
    mockedLlm.mockResolvedValue(null);
    // 浏览器可用
    mocks.launch.mockResolvedValue({
      newPage: async () => ({ locator: () => ({ ariaSnapshot: mocks.ariaSnapshot }) }),
      close: mocks.close,
    });
  });

  it('只有非阻塞项失败 → exit 0，且不再说 "Fix above before sentinel run"', async () => {
    // 没配 LLM = 非阻塞（离线也能跑）
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await runDoctor()).toBe(0);
      const out = log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(out).not.toContain('Fix above before');
      expect(out).toContain('不阻塞');
    } finally {
      log.mockRestore();
    }
  });

  it('阻塞项失败（浏览器起不来）→ exit 1，且明确要求先修', async () => {
    mocks.launch.mockRejectedValue(new Error('no browser'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await runDoctor()).toBe(1);
      expect(log.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('Fix above before');
    } finally {
      log.mockRestore();
    }
  });
});

describe('doctor 的 budget.yml 校验（非法配置必须阻塞，不能静默失效）', () => {
  async function checkWithBudget(content: string): Promise<{ status: string; blocking?: boolean; message: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'sentinel-budget-'));
    mkdirSync(join(dir, '.sentinel'), { recursive: true });
    writeFileSync(join(dir, '.sentinel', 'budget.yml'), content, 'utf8');
    const checks = await collectConfigChecks(dir);
    const budget = checks.find((c) => c.name === 'budget.yml');
    return { status: budget!.status, blocking: budget!.blocking, message: budget!.message };
  }

  it('limits 写成标量 → 必须 fail 且阻塞', async () => {
    // 以前 `limits: 100` 会被原样带进运行时：
    // limits.maxCostUsdPerRun 是 undefined → 三条预算护栏全部静默失效。
    const r = await checkWithBudget('stage: MVP\nlimits: 100\n');
    expect(r.status).toBe('fail');
    expect(r.blocking).toBe(true);
    expect(r.message).toContain('limits');
  });

  it('stage 写成数字 → 必须 fail 且阻塞（以前会被悄悄换成 MVP）', async () => {
    const r = await checkWithBudget('stage: 3\nlimits:\n  maxCostUsdPerRun: 1\n');
    expect(r.status).toBe('fail');
    expect(r.blocking).toBe(true);
    expect(r.message).toContain('stage');
  });

  it('limits 里的值是负数 → 必须 fail 且阻塞', async () => {
    const r = await checkWithBudget('stage: MVP\nlimits:\n  maxCostUsdPerRun: -1\n');
    expect(r.status).toBe('fail');
    expect(r.blocking).toBe(true);
  });

  it('stage 写小写 mvp → 合法（归一成 MVP，不阻塞）', async () => {
    const r = await checkWithBudget('stage: mvp\nlimits:\n  maxCostUsdPerRun: 1\n');
    expect(r.status).toBe('ok');
  });
});
