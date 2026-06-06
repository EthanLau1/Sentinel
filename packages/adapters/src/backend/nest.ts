import type { Adapter } from '../types.js';

export const nestAdapter: Adapter = {
  name: 'nest',
  async detect(scan): Promise<boolean> {
    const pkg = scan.packageJson;
    if (!pkg) return false;
    const deps = { ...(pkg['dependencies'] as object) };
    return '@nestjs/core' in (deps ?? {});
  },
  async profile() {
    return { frameworks: ['nestjs'] };
  },
};
