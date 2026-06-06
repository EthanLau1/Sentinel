import type { Adapter } from '../types.js';

export const vueAdapter: Adapter = {
  name: 'vue',
  async detect(scan): Promise<boolean> {
    const pkg = scan.packageJson;
    if (!pkg) return false;
    const deps = { ...(pkg['dependencies'] as object), ...(pkg['devDependencies'] as object) };
    return 'vue' in (deps ?? {}) || 'nuxt' in (deps ?? {});
  },
  async profile() {
    return { frameworks: ['vue'] };
  },
};
