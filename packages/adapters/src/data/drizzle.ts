import type { Adapter } from '../types.js';

export const drizzleAdapter: Adapter = {
  name: 'drizzle',
  async detect(scan): Promise<boolean> {
    const pkg = scan.packageJson;
    if (!pkg) return false;
    const deps = { ...(pkg['dependencies'] as object), ...(pkg['devDependencies'] as object) };
    return 'drizzle-orm' in (deps ?? {});
  },
  async profile() {
    return { frameworks: ['drizzle'] };
  },
};
