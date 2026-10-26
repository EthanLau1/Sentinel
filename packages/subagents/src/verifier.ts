/**
 * Verifier subagent — final evidence gate before planning.
 *
 * Critic asks whether the diagnosis is plausible. Verifier checks whether the
 * confirmed finding is structurally safe to turn into fix options.
 */

import type { BugFinding, KernelContext, Subagent } from '@sentinel/core';

export interface VerifierConfig {
  minConfidence?: number;
}

export function createVerifier(config: VerifierConfig = {}): Subagent {
  const minConfidence = config.minConfidence ?? 0.4;

  return {
    name: 'verifier',

    register(ctx: KernelContext): void {
      ctx.bus.subscribe<BugFinding>('bug.confirmed', async (event) => {
        if (event.source === 'verifier') return;
        const bug = event.payload;
        const reason = verificationFailure(bug, minConfidence);

        if (reason) {
          await ctx.bus.publish({
            type: 'bug.insufficient_evidence',
            payload: { bugId: bug.id, reason },
            source: 'verifier',
            traceId: event.traceId,
          });
          return;
        }

        await ctx.bus.publish({
          type: 'bug.confirmed',
          payload: bug,
          source: 'verifier',
          traceId: event.traceId,
        });
      });
    },
  };
}

function verificationFailure(bug: BugFinding, minConfidence: number): string | null {
  if (bug.evidence.length === 0) return 'confirmed bug has no evidence';
  // 确定性规则判定（origin='rule'）的根因是**运行时事实**，证据由规则自己产出
  // （控制台报错 / 失败请求 / 5xx / 空 body …），不需要再套"代码证据 + 运行时错误证据"这两道。
  // 否则"白屏""混合内容"这类真故障会被误杀 —— 它们的证据形态本来就不是 console/network。
  // 模型推断（origin='llm' 或没标）仍必须同时给出代码证据和运行时证据，
  // 否则"根因"只是一句话，无法复核。
  if (bug.origin !== 'rule') {
    if (!bug.evidence.some((e) => e.kind === 'file' && e.snippet.trim())) {
      return 'confirmed root cause has no code evidence';
    }
    if (!bug.evidence.some((e) =>
      (e.kind === 'console' && e.level === 'error') || (e.kind === 'network' && e.failed) ||
      (e.kind === 'http' && e.status >= 400) || (e.kind === 'log' && e.level === 'error') || e.kind === 'trace'
    )) return 'confirmed root cause has no runtime failure evidence';
  }
  if (bug.rootCauseStatus !== 'confirmed') return 'root cause is not confirmed';
  if (!bug.rootCause?.trim()) return 'confirmed bug has no rootCause';
  if (bug.confidence < minConfidence) return 'confidence below verifier threshold';
  return null;
}
