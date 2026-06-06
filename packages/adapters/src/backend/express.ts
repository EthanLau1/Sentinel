import type { Adapter } from '../types.js';

export const expressAdapter: Adapter = {
  name: 'express',
  async detect(scan): Promise<boolean> {
    const pkg = scan.packageJson;
    if (!pkg) return false;
    const deps = { ...(pkg['dependencies'] as object) };
    return 'express' in (deps ?? {});
  },
  async profile() {
    return { frameworks: ['express'] };
  },
};
