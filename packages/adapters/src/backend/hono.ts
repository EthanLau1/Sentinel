import type { Adapter } from '../types.js';

export const honoAdapter: Adapter = {
  name: 'hono',
  async detect(scan): Promise<boolean> {
    const pkg = scan.packageJson;
    if (!pkg) return false;
    const deps = { ...(pkg['dependencies'] as object) };
    return 'hono' in (deps ?? {});
  },
  async profile() {
    return { frameworks: ['hono'] };
  },
};
