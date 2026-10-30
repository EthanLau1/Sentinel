/**
 * 事件录制 → NDJSON 落盘（红线 6：案例永久留档）
 *
 * 每次 sentinel run 把 bus 录制的所有事件序列化为 NDJSON（每行一个 JSON），
 * 写到 reports/events.ndjson。格式支持 grep / jq / 流式解析，也是 P2-I 回放的底座。
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Event } from '@sentinel/core';

export async function writeEventsNdjson(
  reportsDir: string,
  events: Event[],
): Promise<void> {
  if (events.length === 0) return;
  await mkdir(reportsDir, { recursive: true });
  const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  await writeFile(join(reportsDir, 'events.ndjson'), lines, 'utf8');
}
