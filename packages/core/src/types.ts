/**
 * @sentinel/core/types
 *
 * 5 个核心类型，永远只有 5 个：
 *   FeatureMap   项目长什么样
 *   Evidence     一条证据（sum type，12 种）
 *   BugFinding   一个 bug
 *   FixOption    一个修复方案
 *   Event<T>     bus 上流的消息
 *
 * 宪法第 5 条：不允许引入第 6 个核心类型。
 */

// ────────────────────────────────────────────────────────────────────────────
// 1. FeatureMap — 项目长什么样
// ────────────────────────────────────────────────────────────────────────────

/** 项目档案：栈、运行时、部署目标 */
export interface ProjectProfile {
  name: string;
  stack: string[];
  frameworks: string[];
  runtime: string;
  packageManager: string;
  deployTarget?: string;
}

/** 认证规约 */
export interface AuthSpec {
  type: 'session' | 'jwt' | 'oauth' | 'magic-link' | 'otp';
  loginEndpoint?: string;
  sessionStorage?: 'cookie' | 'localStorage' | 'header';
  testCredentials?: Record<string, string>;
}

/** 页面规约 */
export interface PageSpec {
  id: string;
  path: string;
  title?: string;
  requiresAuth: boolean;
  criticalCTAs: string[];
}

/** API 规约 */
export interface ApiSpec {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  requiresAuth: boolean;
  produces?: string;
}

/** 数据规约 */
export interface DataSpec {
  id: string;
  kind: 'table' | 'collection' | 'cache';
  name: string;
  writtenBy?: string[];
  readBy?: string[];
}

/** 用户流程规约 */
export interface FlowSpec {
  id: string;
  description: string;
  steps: FlowStep[];
}

/** 流程内一步 */
export type FlowStep =
  | { action: 'visit'; url: string }
  | { action: 'fill'; selector: string; value: string }
  | { action: 'click'; selector: string }
  | { action: 'wait'; ms: number }
  | { action: 'assert'; kind: 'url' | 'text' | 'db' | 'api'; [k: string]: unknown };

/** 项目风险点 */
export interface ProjectRisk {
  id: string;
  area: 'auth' | 'data' | 'perf' | 'deploy' | 'security' | 'ui';
  description: string;
  severity: 'low' | 'medium' | 'high';
}

/** 完整功能地图 */
export interface FeatureMap {
  project: ProjectProfile;
  auth?: AuthSpec;
  pages: PageSpec[];
  api: ApiSpec[];
  data: DataSpec[];
  flows: FlowSpec[];
  risks: ProjectRisk[];
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Evidence — 一条证据 (sum type, 12 种)
// ────────────────────────────────────────────────────────────────────────────

/** Evidence 通用基础字段 */
export interface EvidenceBase {
  /** content-addressed hash，PR / 报告里以此引用 */
  hash: string;
  /** 何时采集 */
  timestamp: number;
  /** 数据来源 */
  source: 'browser' | 'api' | 'backend' | 'database' | 'fs' | 'git';
}

export type Evidence =
  | (EvidenceBase & { kind: 'screenshot'; path: string; viewport?: { w: number; h: number } })
  | (EvidenceBase & { kind: 'dom-snapshot'; html: string })
  | (EvidenceBase & { kind: 'a11y'; tree: unknown })
  | (EvidenceBase & { kind: 'console'; level: 'log' | 'warn' | 'error'; message: string; stack?: string })
  | (EvidenceBase & { kind: 'network'; url: string; method: string; status: number; duration_ms: number; failed: boolean })
  | (EvidenceBase & { kind: 'http'; url: string; method: string; status: number; bodySummary?: string })
  | (EvidenceBase & { kind: 'log'; level: string; message: string; service?: string })
  | (EvidenceBase & { kind: 'file'; path: string; lineRange?: [number, number]; snippet: string })
  | (EvidenceBase & { kind: 'git'; ref: string; subject: 'log' | 'diff' | 'blame'; data: string })
  | (EvidenceBase & { kind: 'db'; query: string; rows: number; sample?: unknown })
  | (EvidenceBase & { kind: 'trace'; traceId: string; service: string; data: unknown })
  | (EvidenceBase & { kind: 'storage'; storage: 'localStorage' | 'sessionStorage' | 'cookie'; keys: string[] });

/** Evidence 种类枚举（运行时可用） */
export type EvidenceKind = Evidence['kind'];

// ────────────────────────────────────────────────────────────────────────────
// 3. BugFinding — 一个 bug
// ────────────────────────────────────────────────────────────────────────────

export type Severity = 'P0' | 'P1' | 'P2' | 'P3';
export type BugSource = 'ui' | 'api' | 'auth' | 'data' | 'env' | 'perf' | 'deploy';

export interface BugFinding {
  id: string;
  title: string;
  severity: Severity;
  source: BugSource;
  affectedFeature: string;
  symptom: string;
  reproSteps: string[];
  /** 至少 1 条；为 0 时 rootCauseStatus 必须为 'hypothesis' */
  evidence: Evidence[];
  /** 宪法第 4 条：无 Evidence 不允许 'confirmed' */
  rootCauseStatus: 'hypothesis' | 'confirmed';
  rootCause?: string;
  /** critic 找到的反证 */
  counterEvidence: Evidence[];
  /** 0–1 */
  confidence: number;
  verificationCommand?: string;
  fixOptions: FixOption[];
  recommendedFixId?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// 4. FixOption — 一个修复方案
// ────────────────────────────────────────────────────────────────────────────

export type Effort = 'low' | 'medium' | 'high';
export type Risk = 'low' | 'medium' | 'high';
export type Cost = 'none' | 'low' | 'medium' | 'high';
export type Stage = 'Idea' | 'MVP' | 'Launch' | 'Scale';
/** 宪法机制 Self-Repair 分级 */
export type Tier = 0 | 1 | 2 | 3;

/** 知识增强来源（M6） */
export interface KnowledgeSource {
  url: string;
  authority: 'official' | 'community' | 'unverified';
  recency: 'fresh' | 'recent' | 'aged';
  type: 'docs' | 'github' | 'stackoverflow' | 'x';
}

export interface FixOption {
  id: string;
  title: string;
  description: string;

  /** 5 维成本 */
  effort: Effort;
  risk: Risk;
  runtimeCost: Cost;
  regressionRisk: Risk;
  maintenanceCost: Cost;

  stageFit: Stage;
  /** Self-Repair Tier，决定 executor 行为 */
  tier: Tier;
  /** 0–1 */
  confidence: number;
  /** 推荐公式产出，可解释 */
  score: number;
  patch?: string;
  verificationCommand?: string;
  /** M6 知识增强填充 */
  sources: KnowledgeSource[];
  whyRecommended?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// 5. Event<T> — bus 上流的消息
// ────────────────────────────────────────────────────────────────────────────

/** 24 个固定事件类型，必须与 EVENT-CATALOG.md 一致 */
export type EventType =
  // 项目理解
  | 'project.scanned'
  | 'map.ready'
  | 'map.failed'
  // 感知
  | 'evidence.requested'
  | 'evidence.collected'
  | 'evidence.ready'
  | 'evidence.failed'
  // 流程
  | 'flow.started'
  | 'flow.passed'
  | 'flow.failed'
  // 诊断
  | 'bug.draft'
  | 'bug.confirmed'
  | 'bug.rejected'
  | 'bug.insufficient_evidence'
  // 方案
  | 'fix.proposed'
  | 'fix.enhanced'
  // 知识
  | 'knowledge.requested'
  | 'knowledge.received'
  | 'knowledge.cached'
  // 执行
  | 'executor.tier_decided'
  | 'patch.applied'
  | 'pr.created'
  | 'report.ready'
  // 监控
  | 'budget.exceeded';

export interface Event<T = unknown> {
  type: EventType;
  payload: T;
  timestamp: number;
  /** 同一次 run 共享，便于追踪 */
  traceId: string;
  /** 哪个子代理发的 */
  source: string;
}
