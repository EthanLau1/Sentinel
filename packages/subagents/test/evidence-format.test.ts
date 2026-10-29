import { describe, it, expect } from 'vitest';
import type { Evidence } from '@sentinel/core';
import { formatEvidence } from '../src/analyst.js';

describe('证据呈现给模型看的形态', () => {
  it('a11y 树超长时头尾都保留，并写明截断了多少', () => {
    // Playwright 的 ariaSnapshot 是一段很长的 YAML 文本
    const tree = 'A'.repeat(3000) + '\n' + 'B'.repeat(3000) + '\n- 尾部节点: 关键结论';
    const evidence: Evidence = {
      kind: 'a11y',
      source: 'browser',
      hash: 'h_a11y',
      timestamp: 1,
      tree,
    };
    const text = formatEvidence(evidence);
    expect(text).toContain('A'.repeat(50));
    expect(text).toContain('尾部节点: 关键结论');
    expect(text).toMatch(/已省略/);
    // 不能出现旧实现那种"砍掉尾巴却不说明"的情况
    expect(text).not.toBe(`[a11y/browser hash=h_a11y] ${tree.slice(0, 4000)}`);
  });

  it('a11y 树是对象时也能读', () => {
    const evidence: Evidence = {
      kind: 'a11y',
      source: 'browser',
      hash: 'h_a11y2',
      timestamp: 1,
      tree: { role: 'button', name: '提交' },
    };
    expect(formatEvidence(evidence)).toContain('提交');
  });

  it('截图不再被换成占位串，且如实说明模型看不到图', () => {
    const evidence: Evidence = {
      kind: 'screenshot',
      source: 'browser',
      hash: 'h_shot',
      timestamp: 1,
      path: '/project/reports/evidence/shot-abc.png',
    };
    const text = formatEvidence(evidence);
    expect(text).toContain('/project/reports/evidence/shot-abc.png');
    expect(text).not.toContain('[image data; inspect separately]');
    expect(text).toContain('模型通道只支持文本');
  });

  it('DOM 超长时写明截断尾部', () => {
    const evidence: Evidence = {
      kind: 'dom-snapshot',
      source: 'browser',
      hash: 'h_dom',
      timestamp: 1,
      html: 'x'.repeat(5000),
    };
    const text = formatEvidence(evidence);
    expect(text).toContain('已截断尾部');
    expect(text).toContain('5000');
  });

  it('普通证据超长时保留尾部（文件证据的 snippet 结尾常是关键）', () => {
    const evidence: Evidence = {
      kind: 'file',
      source: 'fs',
      hash: 'h_file',
      timestamp: 1,
      path: 'app/page.tsx',
      snippet: 'S'.repeat(5000) + '<<关键行>>',
    };
    const text = formatEvidence(evidence);
    expect(text).toContain('<<关键行>>');
  });
});
