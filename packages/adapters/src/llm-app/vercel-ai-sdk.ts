import type { Adapter } from '../types.js';

export const vercelAiSdkAdapter: Adapter = {
  name: 'vercel-ai-sdk',
  async detect(scan): Promise<boolean> {
    const pkg = scan.packageJson;
    if (!pkg) return false;
    const deps = { ...(pkg['dependencies'] as object) };
    return 'ai' in (deps ?? {});
  },
  async profile() {
    return { frameworks: ['vercel-ai-sdk'] };
  },
};
