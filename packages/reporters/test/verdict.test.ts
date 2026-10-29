import { describe, it, expect } from 'vitest';
import type { BugFinding, Evidence } from '@sentinel/core';
import {
  classifyBug,
  isSentinelInvalidUrl,
  hasRoutePlaceholder,
  pathOfUrl,
  reportToMarkdown,
  reportToJson,
} from '../src/index.js';

/** 造一条「访问某个 URL 拿到 404」的诊断 */
function notFoundBug(url: string, over: Partial<BugFinding> = {}): BugFinding {
  const evidence: Evidence[] = [
    {
      kind: 'network',
      source: 'browser',
      hash: 'h404',
      timestamp: 1,
      url,
      method: 'GET',
      status: 404,
      duration_ms: 12,
      failed: true,
    },
  ];
  return {
    id: 'bug_404',
    title: `访问 ${url} 返回 404`,
    severity: 'P1',
    source: 'api',
    affectedFeature: 'flow_page_1',
    symptom: `访问 ${url} 时：Page ${url} returned HTTP 404`,
    reproSteps: [`访问 ${url}`],
    evidence,
    rootCauseStatus: 'hypothesis',
    counterEvidence: [],
    confidence: 0.7,
    fixOptions: [],
    ...over,
  };
}

describe('三类判定口径', () => {
  it('工具性失败归 tool-failure', () => {
    const bug = notFoundBug('http://127.0.0.1:3000/posts/1', {
      symptom: 'Cannot navigate to invalid URL',
    });
    expect(classifyBug(bug)).toBe('tool-failure');
  });

  it('Sentinel 自造地址（路由占位符）打到 404 → sentinel-invalid-url', () => {
    // /posts/:id 是 Sentinel 从 Next.js 的 [id] 目录推出来的地址 —— 真实路由不存在
    const bug = notFoundBug('http://127.0.0.1:3000/posts/:id');
    expect(isSentinelInvalidUrl(bug)).toBe(true);
    expect(classifyBug(bug)).toBe('sentinel-invalid-url');
  });

  it('并行路由槽 @modal 与动态占位符算自造地址', () => {
    expect(isSentinelInvalidUrl(notFoundBug('http://127.0.0.1:3000/@modal'))).toBe(true);
    expect(isSentinelInvalidUrl(notFoundBug('http://127.0.0.1:3000/blog/:all*'))).toBe(true);
    expect(isSentinelInvalidUrl(notFoundBug('http://127.0.0.1:3000/shop/:slug*'))).toBe(true);
  });

  it('Pages Router 的字面量目录段是真实路由，404 仍然是项目缺陷', () => {
    // pages/(marketing)/about.tsx 的真实地址就是 /(marketing)/about
    const bug = notFoundBug('http://127.0.0.1:3000/(marketing)/about');
    expect(isSentinelInvalidUrl(bug)).toBe(false);
    expect(classifyBug(bug)).toBe('project-defect');
  });

  it('真实地址上的 404 仍然是项目缺陷（不能过度归类）', () => {
    const bug = notFoundBug('http://127.0.0.1:3000/posts/does-not-exist');
    expect(isSentinelInvalidUrl(bug)).toBe(false);
    expect(classifyBug(bug)).toBe('project-defect');
  });

  it('有 5xx 或 console error 时不归为自造地址', () => {
    const bug = notFoundBug('http://127.0.0.1:3000/posts/:id', {
      evidence: [
        {
          kind: 'network',
          source: 'browser',
          hash: 'h500',
          timestamp: 1,
          url: 'http://127.0.0.1:3000/api/x',
          method: 'GET',
          status: 500,
          duration_ms: 10,
          failed: true,
        },
      ],
    });
    expect(classifyBug(bug)).toBe('project-defect');
  });

  it('端口号不算路由占位符', () => {
    // http://127.0.0.1:3000/ 的冒号在主机部分，不在路径里
    expect(hasRoutePlaceholder('http://127.0.0.1:3000/')).toBe(false);
    expect(hasRoutePlaceholder('http://127.0.0.1:3000/posts/1')).toBe(false);
    expect(hasRoutePlaceholder('/posts/:id')).toBe(true);
    expect(pathOfUrl('http://127.0.0.1:3000/posts/1?x=1')).toBe('/posts/1');
  });
});

describe('报告里的三类口径', () => {
  it('自造地址的单独立项，措辞说清不是项目缺陷', () => {
    const md = reportToMarkdown([notFoundBug('http://127.0.0.1:3000/posts/:id')], {}, {});
    expect(md).toContain('覆盖缺口（Sentinel 自造地址）');
    expect(md).toContain('不是被测项目的缺陷');
    // 口径说明必须出现，避免读者把分级数字当成"项目有 1 个 P1"
    expect(md).toContain('Sentinel 自造地址造成的覆盖缺口');
  });

  it('工具性失败与项目缺陷各自的说法互不串台', () => {
    const toolBug = notFoundBug('http://127.0.0.1:3000/x', { symptom: 'runner error: boom' });
    const realBug = notFoundBug('http://127.0.0.1:3000/missing');
    const md = reportToMarkdown([toolBug, realBug], {}, {});
    expect(md).toContain('工具性失败');
    expect(md).not.toContain('覆盖缺口（Sentinel 自造地址）');
  });

  it('JSON 报告给出机器可读的判定字段', () => {
    const json = reportToJson(
      [notFoundBug('http://127.0.0.1:3000/posts/:id'), notFoundBug('http://127.0.0.1:3000/missing')],
      {},
    );
    expect(json.summary.by_verdict).toEqual({ 'sentinel-invalid-url': 1, 'project-defect': 1 });
    expect(json.bugs.map((b) => b.verdict)).toEqual(['sentinel-invalid-url', 'project-defect']);
  });

  it('被 critic 拒绝的假设单列，不混进诊断列表', () => {
    const md = reportToMarkdown(
      [notFoundBug('http://127.0.0.1:3000/missing')],
      {},
      { rejectedFindings: [{ bugId: 'bug_x', reason: '证据不足以支撑根因' }] },
    );
    expect(md).toContain('被 Critic 拒绝的假设');
    expect(md).toContain('bug_x');
  });

  it('critic 没跑起来的结论要标明未经反向验证', () => {
    const md = reportToMarkdown(
      [notFoundBug('http://127.0.0.1:3000/missing')],
      {},
      { unverifiedBugIds: ['bug_404'] },
    );
    expect(md).toContain('未经反向验证');
  });
});
