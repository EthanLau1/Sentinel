import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextjsAdapter } from '../src/frontend/nextjs.js';
import { prismaAdapter } from '../src/data/prisma.js';
import { createProjectScan } from '../src/scan.js';

async function makeFakeProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sentinel-test-'));

  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'fake-app',
      dependencies: { next: '15.0.0', react: '19.0.0', '@prisma/client': '6.0.0' },
      devDependencies: { prisma: '6.0.0' },
    }),
    'utf8',
  );

  await mkdir(join(root, 'app/posts'), { recursive: true });
  await writeFile(join(root, 'app/page.tsx'), 'export default () => null', 'utf8');
  await writeFile(join(root, 'app/posts/page.tsx'), 'export default () => null', 'utf8');
  await mkdir(join(root, 'app/api/posts'), { recursive: true });
  await writeFile(join(root, 'app/api/posts/route.ts'), 'export async function GET() {}', 'utf8');

  await mkdir(join(root, 'prisma'), { recursive: true });
  await writeFile(
    join(root, 'prisma/schema.prisma'),
    `model User { id String @id }\nmodel Post { id String @id }\n`,
    'utf8',
  );

  return root;
}

describe('nextjsAdapter', () => {
  it('detect 正确识别 next 项目', async () => {
    const root = await makeFakeProject();
    const scan = await createProjectScan(root);
    expect(await nextjsAdapter.detect(scan)).toBe(true);
  });

  it('routes 识别 page + api', async () => {
    const root = await makeFakeProject();
    const scan = await createProjectScan(root);
    const routes = await nextjsAdapter.routes!(scan);
    expect(routes.pages?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(routes.api?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('未带 next deps 时 detect=false', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sentinel-noproj-'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'plain' }), 'utf8');
    const scan = await createProjectScan(root);
    expect(await nextjsAdapter.detect(scan)).toBe(false);
  });
});

describe('prismaAdapter', () => {
  it('解析 schema.prisma 中的 model', async () => {
    const root = await makeFakeProject();
    const scan = await createProjectScan(root);
    const data = await prismaAdapter.data!(scan);
    const names = data.map((d) => d.name);
    expect(names).toContain('User');
    expect(names).toContain('Post');
  });
});
