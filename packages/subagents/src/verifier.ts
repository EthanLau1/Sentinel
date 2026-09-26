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
  if (!bug.evidence.some((e) => e.kind === 'file' && e.snippet.trim())) return 'confirmed root cause has no code evidence';
  if (!bug.evidence.some((e) =>
    (e.kind === 'console' && e.level === 'error') || (e.kind === 'network' && e.failed) ||
    (e.kind === 'http' && e.status >= 400) || (e.kind === 'log' && e.level === 'error') || e.kind === 'trace'
  )) return 'confirmed root cause has no runtime failure evidence';
  if (bug.rootCauseStatus !== 'confirmed') return 'root cause is not confirmed';
  if (!bug.rootCause?.trim()) return 'confirmed bug has no rootCause';
  if (bug.confidence < minConfidence) return 'confidence below verifier threshold';
  return null;
}
