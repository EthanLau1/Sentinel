export type { Adapter, ProjectScan } from './types.js';
export { createProjectScan } from './scan.js';

// Frontend
export { nextjsAdapter } from './frontend/nextjs.js';
export { reactAdapter } from './frontend/react.js';
export { vueAdapter } from './frontend/vue.js';
export { svelteAdapter } from './frontend/svelte.js';

// Backend
export { expressAdapter } from './backend/express.js';
export { honoAdapter } from './backend/hono.js';
export { nestAdapter } from './backend/nest.js';
export { trpcAdapter } from './backend/trpc.js';

// Data
export { prismaAdapter } from './data/prisma.js';
export { drizzleAdapter } from './data/drizzle.js';
export { supabaseAdapter } from './data/supabase.js';

// LLM-app
export { vercelAiSdkAdapter } from './llm-app/vercel-ai-sdk.js';
export { langchainAdapter } from './llm-app/langchain.js';

// 全部 adapter 集合（mapper 默认遍历）
import { nextjsAdapter } from './frontend/nextjs.js';
import { reactAdapter } from './frontend/react.js';
import { vueAdapter } from './frontend/vue.js';
import { svelteAdapter } from './frontend/svelte.js';
import { expressAdapter } from './backend/express.js';
import { honoAdapter } from './backend/hono.js';
import { nestAdapter } from './backend/nest.js';
import { trpcAdapter } from './backend/trpc.js';
import { prismaAdapter } from './data/prisma.js';
import { drizzleAdapter } from './data/drizzle.js';
import { supabaseAdapter } from './data/supabase.js';
import { vercelAiSdkAdapter } from './llm-app/vercel-ai-sdk.js';
import { langchainAdapter } from './llm-app/langchain.js';
import type { Adapter } from './types.js';

export const ALL_ADAPTERS: Adapter[] = [
  nextjsAdapter,
  reactAdapter,
  vueAdapter,
  svelteAdapter,
  expressAdapter,
  honoAdapter,
  nestAdapter,
  trpcAdapter,
  prismaAdapter,
  drizzleAdapter,
  supabaseAdapter,
  vercelAiSdkAdapter,
  langchainAdapter,
];
