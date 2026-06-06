import { describe, it, expect } from 'vitest';
import { parseSimpleYaml, expandEnv } from '../src/config.js';

describe('parseSimpleYaml', () => {
  it('键值对 + 嵌套', () => {
    const text = `
default: my-cloud-api

providers:
  my-cloud-api:
    type: openai-compatible
    baseUrl: https://x.com/v1
    model: gpt-4o
`;
    const r = parseSimpleYaml(text) as {
      default: string;
      providers: { 'my-cloud-api': { type: string; baseUrl: string; model: string } };
    };
    expect(r.default).toBe('my-cloud-api');
    expect(r.providers['my-cloud-api'].type).toBe('openai-compatible');
    expect(r.providers['my-cloud-api'].baseUrl).toBe('https://x.com/v1');
  });

  it('数字 / 布尔 / null', () => {
    const r = parseSimpleYaml(`
limits:
  maxTokens: 100000
  enabled: true
  optional: null
`) as { limits: { maxTokens: number; enabled: boolean; optional: null } };
    expect(r.limits.maxTokens).toBe(100000);
    expect(r.limits.enabled).toBe(true);
    expect(r.limits.optional).toBeNull();
  });

  it('注释忽略', () => {
    const r = parseSimpleYaml(`
# 这是注释
key: value  # 行尾注释
`) as { key: string };
    expect(r.key).toBe('value');
  });
});

describe('expandEnv', () => {
  it('替换 ${VAR}', () => {
    process.env['SENTINEL_TEST_VAR'] = 'hello';
    expect(expandEnv('Bearer ${SENTINEL_TEST_VAR}')).toBe('Bearer hello');
    delete process.env['SENTINEL_TEST_VAR'];
  });

  it('未设置的 var → 空串', () => {
    delete process.env['SENTINEL_NEVER_SET_XYZ'];
    expect(expandEnv('a${SENTINEL_NEVER_SET_XYZ}b')).toBe('ab');
  });
});
