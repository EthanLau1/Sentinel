/**
 * P1-F 事件录制集成测试（红线 6：案例永久留档）
 *
 * 验证 writeEventsNdjson 工具函数：
 *   1. 能把 Event 数组序列化为合法 NDJSON（每行一个 JSON 对象）
 *   2. 每个对象包含必要字段：type / source / timestamp / traceId
 *   3. 空事件数组不产生文件（避免空占位文件）
 *   4. 文件内容可被逐行 JSON.parse 解析（格式完全合规）
 */

import { describe, expect, it, afterEach } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeEventsNdjson } from '@sentinel/reporters';
import type { Event } from '@sentinel/core';

const TMP_DIR = join(tmpdir(), `sentinel-recording-test-${process.pid}`);

afterEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    type: 'flow.passed',
    payload: { flowId: 'flow_login' },
    source: 'runner',
    timestamp: 1_700_000_000_000,
    traceId: 't_abc123_def456',
    ...overrides,
  };
}

describe('writeEventsNdjson（P1-F 录制落盘）', () => {
  it('单事件 → 文件存在，内容是一行合法 JSON', async () => {
    const events: Event[] = [makeEvent()];
    await writeEventsNdjson(TMP_DIR, events);

    const filePath = join(TMP_DIR, 'events.ndjson');
    expect(existsSync(filePath)).toBe(true);

    const raw = await readFile(filePath, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe('flow.passed');
    expect(parsed.source).toBe('runner');
    expect(parsed.timestamp).toBe(1_700_000_000_000);
    expect(parsed.traceId).toBe('t_abc123_def456');
  });

  it('多事件 → 每行一个 JSON，行数与事件数相等', async () => {
    const events: Event[] = [
      makeEvent({ type: 'flow.passed' }),
      makeEvent({ type: 'flow.failed', payload: { flowId: 'flow_checkout' } }),
      makeEvent({ type: 'bug.draft', source: 'analyst' }),
    ];
    await writeEventsNdjson(TMP_DIR, events);

    const raw = await readFile(join(TMP_DIR, 'events.ndjson'), 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);

    // 每行都是合法 JSON，且类型字段正确
    const types = lines.map((l) => JSON.parse(l).type);
    expect(types).toEqual(['flow.passed', 'flow.failed', 'bug.draft']);
  });

  it('文件以换行符结尾（NDJSON 标准格式）', async () => {
    await writeEventsNdjson(TMP_DIR, [makeEvent()]);
    const raw = await readFile(join(TMP_DIR, 'events.ndjson'), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('空事件数组 → 不产生文件', async () => {
    await writeEventsNdjson(TMP_DIR, []);
    expect(existsSync(join(TMP_DIR, 'events.ndjson'))).toBe(false);
  });

  it('reports 目录不存在时自动创建', async () => {
    const nestedDir = join(TMP_DIR, 'deeply', 'nested', 'reports');
    await writeEventsNdjson(nestedDir, [makeEvent()]);
    expect(existsSync(join(nestedDir, 'events.ndjson'))).toBe(true);
  });

  it('每行都可被独立 JSON.parse（格式完全合规）', async () => {
    const events: Event[] = Array.from({ length: 5 }, (_, i) =>
      makeEvent({ type: 'flow.passed', payload: { flowId: `flow_${i}` } }),
    );
    await writeEventsNdjson(TMP_DIR, events);

    const raw = await readFile(join(TMP_DIR, 'events.ndjson'), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    expect(() => lines.forEach((l) => JSON.parse(l))).not.toThrow();
  });
});
