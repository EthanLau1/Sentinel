import type { Adapter } from '../types.js';

export const reactAdapter: Adapter = {
  name: 'react',
  async detect(scan): Promise<boolean> {
    const pkg = scan.packageJson;
    if (!pkg) return false;
    const deps = { ...(pkg['dependencies'] as object), ...(pkg['devDependencies'] as object) };
    return 'react' in (deps ?? {});
  },
  async profile() {
    return { frameworks: ['react'] };
  },
};
