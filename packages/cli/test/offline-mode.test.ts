import { describe, expect, it, vi } from 'vitest';

/**
 * 离线模式的三道门：
 *   1. doctor 不能再因为"没配 LLM"拒绝启动
 *   2. 离线 LLM 桩必须**每次调用都抛错**（不能静默返回空内容）
 *   3. 报告与 run-status 必须写明 llmMode
 */

vi.mock('../src/config.js', () => ({
  projectRoot: () => '/private/tmp/sentinel-offline-test-missing',
  loadLlmConfig: async () => null,
  loadBudgetConfig: async () => ({ stage: 'MVP', limits: { maxCostUsdPerRun: 0.5 } }),
}));

import { collectConfigChecks } from '../src/doctor.js';
import { createOfflineLLMProvider, OfflineLLMError } from '@sentinel/providers';
import { reportToJson, reportToMarkdown } from '@sentinel/reporters';
import type { BugFinding } from '@sentinel/core';

describe('离线模式', () => {
  it('没配 LLM 时 doctor 的 llm.yml 检查不阻塞（否则"没有模型 = 连启动都不行"）', async () => {
    const checks = await collectConfigChecks('/private/tmp/sentinel-offline-test-missing');
    const llmCheck = checks.find((c) => c.name === 'llm.yml');
    expect(llmCheck).toBeDefined();
    expect(llmCheck!.status).toBe('fail');
    expect(llmCheck!.blocking).toBe(false);
    expect(llmCheck!.message).toContain('离线模式');
  });

  it('离线 LLM 桩：调用即抛错，不会静默返回空内容', async () => {
    const provider = createOfflineLLMProvider();
    await expect(provider.chat([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(OfflineLLMError);
    expect(provider.estimateCost(1000)).toBe(0);
  });

  it('报告写明 llmMode，并把规则判定与模型推断区分开', () => {
    const bug: BugFinding = {
      id: 'bug_rule_x',
      title: '页面 /blog 控制台报错',
      severity: 'P1',
      source: 'ui',
      affectedFeature: 'flow_page_blog',
      symptom: 'boom',
      reproSteps: ['访问 /blog'],
      evidence: [{ kind: 'console', source: 'browser', timestamp: 1, hash: 'h1', level: 'error', message: 'boom' }],
      rootCauseStatus: 'confirmed',
      origin: 'rule',
      rootCause: '页面加载后控制台输出 error：boom',
      counterEvidence: [],
      confidence: 0.7,
      fixOptions: [],
    };

    const json = reportToJson([bug], { project: 'demo', llmMode: 'offline' });
    expect(json.llm_mode).toBe('offline');
    expect(json.summary.by_origin['rule']).toBe(1);

    const md = reportToMarkdown([bug], { project: 'demo', llmMode: 'offline' });
    expect(md).toContain('离线');
    expect(md).toContain('确定性规则判定');
  });

  it('模型没参与的结论不许冒充"模型推断"（离线模式 llmRequests=0 却标 llm）', () => {
    // 真实踩过的坑：离线模式下 analyst 的 LLM 桩抛错 → 回退启发式 →
    // 这条 finding 根本没经过模型，但 origin 没标 → 报告按 'llm' 计入 by_origin。
    // 报告于是声称"有模型参与"，而 llmRequests 明明是 0 —— 报告说能做、实际没做。
    const heuristicBug: BugFinding = {
      id: 'bug_flow_api_x',
      title: 'flow_api_x: API GET /api/posts returned 500',
      severity: 'P2',
      source: 'api',
      affectedFeature: 'flow_api_x',
      symptom: 'boom',
      reproSteps: ['访问 /api/posts'],
      evidence: [{ kind: 'console', source: 'browser', timestamp: 1, hash: 'h2', level: 'error', message: 'boom' }],
      rootCauseStatus: 'hypothesis',
      origin: 'heuristic',
      counterEvidence: [],
      confidence: 0.4,
      fixOptions: [],
    };

    const json = reportToJson([heuristicBug], { project: 'demo', llmMode: 'offline' });
    expect(json.summary.by_origin['heuristic']).toBe(1);
    // 关键断言：不能被算成模型推断
    expect(json.summary.by_origin['llm']).toBeUndefined();

    const md = reportToMarkdown([heuristicBug], { project: 'demo', llmMode: 'offline' });
    expect(md).toContain('启发式判定（未调用模型）');
  });

  it('三种结论来源在 markdown 里都要标出来', () => {
    const mk = (origin: BugFinding['origin']): BugFinding => ({
      id: `bug_${origin}`,
      title: 't',
      severity: 'P1',
      source: 'ui',
      affectedFeature: 'f',
      symptom: 's',
      reproSteps: ['r'],
      evidence: [{ kind: 'console', source: 'browser', timestamp: 1, hash: `h_${origin}`, level: 'error', message: 'm' }],
      rootCauseStatus: 'confirmed',
      ...(origin ? { origin } : {}),
      rootCause: 'rc',
      counterEvidence: [],
      confidence: 0.7,
      fixOptions: [],
    });

    const md = reportToMarkdown([mk('rule'), mk('llm'), mk('heuristic')], { project: 'demo' });
    expect(md).toContain('确定性规则判定');
    expect(md).toContain('模型推断');
    expect(md).toContain('启发式判定（未调用模型）');
  });
});
