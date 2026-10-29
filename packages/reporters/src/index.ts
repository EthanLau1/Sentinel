export { bugToMarkdown, reportToMarkdown } from './markdown.js';
export { reportToJson, type JsonReport, type JsonBug } from './json.js';
export {
  buildCoverageInfo,
  coverageIsUninformative,
  type CoverageInfo,
  type CoverageRisk,
  type CoverageStats,
} from './coverage.js';
export { color, printBug, printSummary } from './cli.js';
export {
  aggregateDuplicateBugs,
  aggregateDuplicateBugsWithStats,
  isToolFailure,
  isSentinelInvalidUrl,
  classifyBug,
  hasRoutePlaceholder,
  pathOfUrl,
  mergeBugFinding,
  normalizeMessage,
  type BugVerdict,
} from './aggregate.js';
export {
  clusterBugs,
  clusterAndDedupe,
  similarity,
  levenshteinRatio,
  jaccardSimilarity,
  normalizeSignature,
  errorTypeKeys,
  dedupeEvidence,
  LEVENSHTEIN_THRESHOLD,
  JACCARD_THRESHOLD,
  PATTERN_MATCH_BONUS,
  COMPARE_PREFIX_LENGTH,
  type ClusterResult,
  type EvidenceDedupeStats,
} from './cluster.js';
export { createBugCollector, type BugCollector, type RejectionKind } from './collect.js';
export { applyTierDecisions, findTierDecision, type TierDecisionRecord } from './tier.js';
