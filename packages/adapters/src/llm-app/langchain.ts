import type { Adapter } from '../types.js';

export const langchainAdapter: Adapter = {
  name: 'langchain',
  async detect(scan): Promise<boolean> {
    const pkg = scan.packageJson;
    if (!pkg) return false;
    const deps = { ...(pkg['dependencies'] as object) };
    return 'langchain' in (deps ?? {}) || '@langchain/core' in (deps ?? {});
  },
  async profile() {
    return { frameworks: ['langchain'] };
  },
};
