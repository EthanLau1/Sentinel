import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Budget,
  Kernel,
  type BugFinding,
  type ChatMessage,
  type Evidence,
  type ProviderSet,
  type Subagent,
} from '@sentinel/core';
import { createAnalyst } from '../src/analyst.js';

/**
 * 截图必须**真的**到达模型，不能只是一句"模型看不到图"。
 *
 * 以前的现状：证据里写了截图路径，模型通道只支持文本，
 * 于是 analyst 只能如实说"没看图"—— 诚实，但等于白采。
 * 现在 vision 打开时会把 PNG 读出来随消息附上，模型能直接看。
 */

/** 一张最小 PNG 的头部字节（只测字节传递，不需要真图） */
const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function shot(hash: string, path: string): Evidence {
  return { kind: 'screenshot', source: 'browser', timestamp: 1, hash, path };
}

async function runAnalyst(
  supportsVision: boolean,
  evidence: Evidence[],
): Promise<{ messages: ChatMessage[]; draft: BugFinding }> {
  const messages: ChatMessage[] = [];
  const providers: ProviderSet = {
    llm: {
      name: 'fake',
      supportsTools: false,
      supportsVision,
      async chat(msgs) {
        messages.push(...msgs);
        return {
          content: JSON.stringify({ rootCause: '根因假设', confidence: 0.7, reproSteps: ['步骤1'] }),
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          costUsd: 0,
        };
      },
      estimateCost: () => 0,
    },
    memory: { name: 'none', async recall() { return []; }, async remember() {} },
    skills: { async list() { return []; }, async load() { throw new Error('unused'); }, async refresh() {} },
    mcp: { register() {}, unregister() {}, get() { return undefined; }, list() { return [] } },
    knowledge: [],
  };

  let draft: BugFinding | undefined;
  const capture: Subagent = {
    name: 'capture',
    register(ctx) {
      ctx.bus.subscribe<BugFinding>('bug.draft', (e) => { draft = e.payload; });
    },
  };

  const kernel = new Kernel({ providers, budget: new Budget({}), subagents: [createAnalyst(), capture] });
  await kernel.kick('flow.failed', {
    flowId: 'flow_home',
    error: '页面加载失败',
    evidence,
  }, 'test');
  await kernel.stop();
  if (!draft) throw new Error('analyst 没有产出 draft');
  return { messages, draft };
}

function userMessage(messages: ChatMessage[]): ChatMessage {
  const msg = messages.find((m) => m.role === 'user');
  if (!msg) throw new Error('没有 user 消息');
  return msg;
}

describe('analyst 把截图附给模型', () => {
  it('vision 打开 → data URI 截图被拆成 base64 随消息发出', async () => {
    const dataUri = 'data:image/png;base64,QUJD';
    const { messages } = await runAnalyst(true, [shot('h1', dataUri)]);
    const user = userMessage(messages);
    expect(user.images).toHaveLength(1);
    expect(user.images![0]).toEqual({ mimeType: 'image/png', data: 'QUJD' });
    // 附图成功，文字描述必须改成"已附图"，不能还写着"模型看不到"
    expect(user.content).toContain('已作为图片随本条消息附给模型');
    expect(user.content).not.toContain('模型通道只支持文本');
  });

  it('vision 打开 → 落盘的 PNG 文件被读出来附上（base64 与文件字节一致）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sentinel-vision-'));
    try {
      const file = join(dir, 'shot-abc.png');
      await writeFile(file, PNG_BYTES);
      const { messages } = await runAnalyst(true, [shot('h1', file)]);
      const user = userMessage(messages);
      expect(user.images).toHaveLength(1);
      expect(user.images![0].mimeType).toBe('image/png');
      expect(user.images![0].data).toBe(PNG_BYTES.toString('base64'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('vision 关闭 → 不附图，文字如实说明模型通道只支持文本', async () => {
    const { messages } = await runAnalyst(false, [shot('h1', 'data:image/png;base64,QUJD')]);
    const user = userMessage(messages);
    expect(user.images).toBeUndefined();
    expect(user.content).toContain('模型通道只支持文本');
    expect(user.content).not.toContain('已作为图片随本条消息附给模型');
  });

  it('截图读不出来（文件不存在）→ 跳过附图，不让整轮 run 挂掉', async () => {
    const { messages, draft } = await runAnalyst(true, [shot('h1', '/不存在的路径/shot-x.png')]);
    const user = userMessage(messages);
    expect(user.images).toBeUndefined();
    // 证据还在，draft 照样产出
    expect(draft.evidence).toHaveLength(1);
  });

  it('一次最多附 3 张图（图片 token 贵，不能把预算打爆）', async () => {
    const shots = [1, 2, 3, 4, 5].map((i) => shot(`h${i}`, `data:image/png;base64,QUJD${i}`));
    const { messages } = await runAnalyst(true, shots);
    expect(userMessage(messages).images).toHaveLength(3);
  });
});
