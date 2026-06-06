import type { Adapter } from '../types.js';

export const trpcAdapter: Adapter = {
  name: 'trpc',
  async detect(scan): Promise<boolean> {
    const pkg = scan.packageJson;
    if (!pkg) return false;
    const deps = { ...(pkg['dependencies'] as object) };
    return '@trpc/server' in (deps ?? {}) || '@trpc/client' in (deps ?? {});
  },
  async profile() {
    return { frameworks: ['trpc'] };
  },
};
