import type { Adapter } from '../types.js';

export const svelteAdapter: Adapter = {
  name: 'svelte',
  async detect(scan): Promise<boolean> {
    const pkg = scan.packageJson;
    if (!pkg) return false;
    const deps = { ...(pkg['dependencies'] as object), ...(pkg['devDependencies'] as object) };
    return 'svelte' in (deps ?? {}) || '@sveltejs/kit' in (deps ?? {});
  },
  async profile() {
    return { frameworks: ['svelte'] };
  },
};
