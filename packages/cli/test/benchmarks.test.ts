import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateCase } from '../../../benchmarks/schema.js';

/**
 * 红线 6：每个真实案例必须按 schema 进入 benchmarks/cases/。
 * 这个测试让"案例格式写错"在 CI 里就暴露，而不是等到有人翻归档才发现。
 */

const repoRoot = join(import.meta.dirname, '../../..');
const casesDir = join(repoRoot, 'benchmarks', 'cases');

describe('benchmark 案例归档', () => {
  it('benchmarks/cases 目录存在', () => {
    expect(existsSync(casesDir)).toBe(true);
  });

  it('每个案例文件都是合法 JSON 且符合 schema', () => {
    const files = readdirSync(casesDir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    const invalid: string[] = [];
    for (const f of files) {
      const raw = readFileSync(join(casesDir, f), 'utf8');
      let obj: unknown;
      try {
        obj = JSON.parse(raw);
      } catch (e) {
        invalid.push(`${f}: JSON 解析失败 ${(e as Error).message}`);
        continue;
      }
      if (!validateCase(obj)) invalid.push(`${f}: 不符合 BenchmarkCase schema`);
    }
    expect(invalid).toEqual([]);
  });

  it('案例 id 唯一且与文件名对应', () => {
    const files = readdirSync(casesDir).filter((f) => f.endsWith('.json'));
    const ids = files.map((f) => {
      const obj = JSON.parse(readFileSync(join(casesDir, f), 'utf8')) as { id: string };
      return obj.id;
    });
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of files) {
      const obj = JSON.parse(readFileSync(join(casesDir, f), 'utf8')) as { id: string };
      expect(f.startsWith(obj.id), `${f} 的 id 与文件名不匹配`).toBe(true);
    }
  });

  it('每个案例都记录了命中与否与采纳情况（否则统计口径没意义）', () => {
    const files = readdirSync(casesDir).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const obj = JSON.parse(readFileSync(join(casesDir, f), 'utf8')) as {
        hit: boolean;
        fixAdopted: boolean;
        fixPassedVerification: boolean;
        sentinelJudgment: { rootCauseStatus: string; confidence: number };
        createdAt: string;
        sentinelVersion: string;
      };
      expect(typeof obj.hit, f).toBe('boolean');
      expect(typeof obj.fixAdopted, f).toBe('boolean');
      expect(typeof obj.fixPassedVerification, f).toBe('boolean');
      expect(Number.isFinite(obj.sentinelJudgment.confidence), f).toBe(true);
      expect(Number.isNaN(Date.parse(obj.createdAt)), f).toBe(false);
      expect(obj.sentinelVersion.length, f).toBeGreaterThan(0);
    }
  });

  it('validateCase 对残缺对象返回 false（不能是恒真判据）', () => {
    expect(validateCase(null)).toBe(false);
    expect(validateCase({})).toBe(false);
    expect(validateCase({ id: 'x' })).toBe(false);
    expect(validateCase('not an object')).toBe(false);
  });
});
