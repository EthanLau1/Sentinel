/**
 * @sentinel/core/bus
 *
 * Typed Event Bus —— 子代理之间唯一的通信方式。
 * 宪法第 3 工程纪律：Event-Driven Spine，没有直接调用，只过 bus。
 *
 * 特性：
 *  - typed pub/sub
 *  - traceId 自动生成 / 复用
 *  - record 模式可完整回放（黑匣子）
 *  - unsubscribe 可释放
 */

import type { Event, EventType } from './types.js';

export type Handler<T = unknown> = (event: Event<T>) => void | Promise<void>;
export type Unsubscribe = () => void;

/** 简单 traceId 生成（不依赖 crypto / uuid 第三方） */
function makeTraceId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `t_${t}_${r}`;
}

export interface PublishInput<T> {
  type: EventType;
  payload: T;
  source: string;
  /** 可继承上游 traceId */
  traceId?: string;
}

export class Bus {
  private handlers = new Map<EventType, Set<Handler>>();
  private recording = false;
  private recorded: Event[] = [];
  private currentTraceId?: string;

  /** 订阅事件 */
  subscribe<T = unknown>(type: EventType, handler: Handler<T>): Unsubscribe {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler);
    return () => {
      set!.delete(handler as Handler);
    };
  }

  /** 发布事件 */
  async publish<T>(input: PublishInput<T>): Promise<void> {
    const event: Event<T> = {
      type: input.type,
      payload: input.payload,
      source: input.source,
      timestamp: Date.now(),
      traceId: input.traceId ?? this.currentTraceId ?? makeTraceId(),
    };
    // 第一个事件确定本次 trace
    if (!this.currentTraceId) this.currentTraceId = event.traceId;
    if (this.recording) this.recorded.push(event as Event);

    const set = this.handlers.get(event.type);
    if (!set || set.size === 0) return;

    // 顺序执行：保证因果关系。错误隔离：一个 handler 抛错不阻塞其他。
    const errors: unknown[] = [];
    for (const handler of set) {
      try {
        await handler(event as Event);
      } catch (err) {
        errors.push(err);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `bus handler errors for ${event.type}`);
    }
  }

  /** 开始录制（用于回放调试） */
  startRecording(): void {
    this.recording = true;
    this.recorded = [];
  }

  /** 停止录制并返回所有事件 */
  stopRecording(): Event[] {
    this.recording = false;
    const events = [...this.recorded];
    this.recorded = [];
    return events;
  }

  /** 重置 traceId（每次 sentinel run 调用） */
  newTrace(): string {
    this.currentTraceId = makeTraceId();
    return this.currentTraceId;
  }

  /** 当前 trace（只读） */
  get traceId(): string | undefined {
    return this.currentTraceId;
  }
}
