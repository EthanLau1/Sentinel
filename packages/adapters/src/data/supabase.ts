import type { Adapter } from '../types.js';

export const supabaseAdapter: Adapter = {
  name: 'supabase',
  async detect(scan): Promise<boolean> {
    const pkg = scan.packageJson;
    if (!pkg) return false;
    const deps = { ...(pkg['dependencies'] as object) };
    return '@supabase/supabase-js' in (deps ?? {});
  },
  async profile() {
    return { frameworks: ['supabase'] };
  },
};
