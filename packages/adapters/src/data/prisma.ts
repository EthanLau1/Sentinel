import type { Adapter } from '../types.js';
import type { DataSpec } from '@sentinel/core';

export const prismaAdapter: Adapter = {
  name: 'prisma',

  async detect(scan): Promise<boolean> {
    const pkg = scan.packageJson;
    if (!pkg) return false;
    const deps = { ...(pkg['dependencies'] as object), ...(pkg['devDependencies'] as object) };
    if ('prisma' in (deps ?? {}) || '@prisma/client' in (deps ?? {})) return true;
    return scan.has('prisma/schema.prisma');
  },

  async profile() {
    return { frameworks: ['prisma'] };
  },

  async data(scan): Promise<DataSpec[]> {
    const schema = await scan.read('prisma/schema.prisma');
    if (!schema) return [];
    const out: DataSpec[] = [];
    const re = /^\s*model\s+(\w+)\s*\{/gm;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(schema)) !== null) {
      out.push({ id: `data_${i++}`, kind: 'table', name: m[1]! });
    }
    return out;
  },
};
