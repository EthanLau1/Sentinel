/**
 * @sentinel/core/ports
 *
 * 5 个 Provider 接口：core 与外部世界的唯一通道。
 *   LLMProvider        语言模型
 *   MemoryProvider     记忆（默认无）
 *   SkillsLoader       技能（markdown）
 *   MCPRegistry        工具协议
 *   KnowledgeProvider  外部知识源
 *
 * 宪法第 1 条：core 不依赖任何具体实现。
 * 这里只定义接口，所有具体 provider 在 packages/providers/。
 */

// ────────────────────────────────────────────────────────────────────────────
// 1. LLMProvider
// ────────────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** tool 调用结果时填 */
  toolCallId?: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolSchema[];
  /** 单次请求超时 (ms) */
  timeoutMs?: number;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatResponse {
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  /** 实际消耗 */
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  /** 估算成本 (USD) */
  costUsd: number;
}

export interface LLMProvider {
  /** Provider 名称（具体实现由 packages/providers/llm 提供） */
  readonly name: string;
  /** 是否支持 tool calling */
  readonly supportsTools: boolean;
  /** 主对话接口 */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  /** 估算 token 数对应的 USD 成本（用于预估） */
  estimateCost(tokens: number): number;
}

// ────────────────────────────────────────────────────────────────────────────
// 2. MemoryProvider — 默认 NoneProvider
// ────────────────────────────────────────────────────────────────────────────

export interface MemoryProvider {
  readonly name: string;
  /** 给 LLM 喂上下文 */
  recall(query: string, limit?: number): Promise<string[]>;
  /** 写回（可选实现） */
  remember(fact: string, metadata?: Record<string, unknown>): Promise<void>;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. SkillsLoader — markdown 格式
// ────────────────────────────────────────────────────────────────────────────

export interface SkillMeta {
  name: string;
  authority: 'core' | 'community' | 'custom';
  version: string;
  trigger?: string;
}

export interface SkillContent extends SkillMeta {
  /** markdown 正文 */
  body: string;
}

export interface SkillsLoader {
  list(): Promise<SkillMeta[]>;
  load(name: string): Promise<SkillContent>;
  /** 自更新入口 — Self-Update 允许范围 */
  refresh(): Promise<void>;
}

// ────────────────────────────────────────────────────────────────────────────
// 4. MCPRegistry — 工具协议（3+N 模式）
// ────────────────────────────────────────────────────────────────────────────

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPServer {
  name: string;
  tools: MCPTool[];
  call(toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface MCPRegistry {
  register(server: MCPServer): void;
  unregister(name: string): void;
  get(name: string): MCPServer | undefined;
  list(): MCPServer[];
}

// ────────────────────────────────────────────────────────────────────────────
// 5. KnowledgeProvider — 外部知识源（M6）
// ────────────────────────────────────────────────────────────────────────────

export interface SearchOptions {
  /** 限制结果数 */
  limit?: number;
  /** 时间窗（ISO 8601 duration 或天数） */
  recencyDays?: number;
  /** 项目栈 hint，便于过滤 */
  stack?: string[];
}

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  authority: 'official' | 'community' | 'unverified';
  publishedAt?: number;
}

export interface KnowledgeProvider {
  readonly name: string;
  /** 用于源排序：数字越小越优先（官方文档=1，X.com=4） */
  readonly priority: number;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

// ────────────────────────────────────────────────────────────────────────────
// Provider 容器（kernel 持有）
// ────────────────────────────────────────────────────────────────────────────

/** 给 kernel 注入的 provider 集合 */
export interface ProviderSet {
  llm: LLMProvider;
  memory: MemoryProvider;
  skills: SkillsLoader;
  mcp: MCPRegistry;
  /** 多个知识源按 priority 排序使用 */
  knowledge: KnowledgeProvider[];
}
