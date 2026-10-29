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
export { aggregateDuplicateBugs, isToolFailure, mergeBugFinding, normalizeMessage } from './aggregate.js';
export { createBugCollector, type BugCollector } from './collect.js';
export { applyTierDecisions, findTierDecision, type TierDecisionRecord } from './tier.js';
