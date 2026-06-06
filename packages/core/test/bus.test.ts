import { describe, it, expect, vi } from 'vitest';
import { Bus } from '../src/bus.js';
import type { Event } from '../src/types.js';

describe('Bus', () => {
  it('subscribe → publish → handler 链路', async () => {
    const bus = new Bus();
    const handler = vi.fn();
    bus.subscribe('map.ready', handler);
    await bus.publish({ type: 'map.ready', payload: { foo: 1 }, source: 'test' });

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0] as Event;
    expect(event.type).toBe('map.ready');
    expect(event.payload).toEqual({ foo: 1 });
    expect(event.source).toBe('test');
    expect(event.traceId).toMatch(/^t_/);
    expect(event.timestamp).toBeTypeOf('number');
  });

  it('traceId 跨多个 publish 保持', async () => {
    const bus = new Bus();
    const seen: string[] = [];
    bus.subscribe('map.ready', (e) => {
      seen.push(e.traceId);
    });
    bus.subscribe('evidence.ready', (e) => {
      seen.push(e.traceId);
    });

    await bus.publish({ type: 'map.ready', payload: {}, source: 'a' });
    await bus.publish({ type: 'evidence.ready', payload: {}, source: 'b' });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it('newTrace 重置 traceId', async () => {
    const bus = new Bus();
    const seen: string[] = [];
    bus.subscribe('map.ready', (e) => {
      seen.push(e.traceId);
    });

    await bus.publish({ type: 'map.ready', payload: {}, source: 'a' });
    bus.newTrace();
    await bus.publish({ type: 'map.ready', payload: {}, source: 'a' });

    expect(seen[0]).not.toBe(seen[1]);
  });

  it('显式传入 traceId 优先', async () => {
    const bus = new Bus();
    let captured = '';
    bus.subscribe('map.ready', (e) => {
      captured = e.traceId;
    });
    await bus.publish({
      type: 'map.ready',
      payload: {},
      source: 'a',
      traceId: 't_explicit_123',
    });
    expect(captured).toBe('t_explicit_123');
  });

  it('多个订阅者收同一事件', async () => {
    const bus = new Bus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    const h3 = vi.fn();
    bus.subscribe('map.ready', h1);
    bus.subscribe('map.ready', h2);
    bus.subscribe('map.ready', h3);

    await bus.publish({ type: 'map.ready', payload: {}, source: 't' });

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
    expect(h3).toHaveBeenCalledOnce();
  });

  it('unsubscribe 后不再收事件', async () => {
    const bus = new Bus();
    const handler = vi.fn();
    const unsub = bus.subscribe('map.ready', handler);

    await bus.publish({ type: 'map.ready', payload: {}, source: 't' });
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();
    await bus.publish({ type: 'map.ready', payload: {}, source: 't' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('handler 错误隔离 → 其他 handler 仍执行', async () => {
    const bus = new Bus();
    const ok1 = vi.fn();
    const ok2 = vi.fn();
    bus.subscribe('map.ready', ok1);
    bus.subscribe('map.ready', () => {
      throw new Error('boom');
    });
    bus.subscribe('map.ready', ok2);

    await expect(
      bus.publish({ type: 'map.ready', payload: {}, source: 't' }),
    ).rejects.toThrow();
    expect(ok1).toHaveBeenCalled();
    expect(ok2).toHaveBeenCalled();
  });

  it('record 模式完整回放', async () => {
    const bus = new Bus();
    bus.startRecording();

    await bus.publish({ type: 'map.ready', payload: { a: 1 }, source: 'm' });
    await bus.publish({ type: 'evidence.ready', payload: { b: 2 }, source: 's' });
    await bus.publish({ type: 'flow.failed', payload: { c: 3 }, source: 'r' });

    const recorded = bus.stopRecording();
    expect(recorded).toHaveLength(3);
    expect(recorded.map((e) => e.type)).toEqual([
      'map.ready',
      'evidence.ready',
      'flow.failed',
    ]);
    // record 仅捕获已发布事件，不重复
    await bus.publish({ type: 'map.ready', payload: {}, source: 'm' });
    expect(bus.stopRecording()).toHaveLength(0);
  });

  it('订阅了无人发布的事件不报错', async () => {
    const bus = new Bus();
    const handler = vi.fn();
    bus.subscribe('budget.exceeded', handler);
    await bus.publish({ type: 'map.ready', payload: {}, source: 't' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('async handler 顺序执行', async () => {
    const bus = new Bus();
    const order: number[] = [];
    bus.subscribe('map.ready', async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
    });
    bus.subscribe('map.ready', async () => {
      order.push(2);
    });
    await bus.publish({ type: 'map.ready', payload: {}, source: 't' });
    expect(order).toEqual([1, 2]);
  });

  it('traceId 在第一次 publish 后可读', async () => {
    const bus = new Bus();
    expect(bus.traceId).toBeUndefined();
    await bus.publish({ type: 'map.ready', payload: {}, source: 't' });
    expect(bus.traceId).toMatch(/^t_/);
  });
});
