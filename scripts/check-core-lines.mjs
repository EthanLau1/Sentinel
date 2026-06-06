#!/usr/bin/env node
// scripts/check-core-lines.mjs
// 宪法红线 2: core/ 总行数 ≤ 500（不含空行和注释）

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CORE_DIR = 'packages/core/src';
const MAX_LINES = 500;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, files);
    else if (path.endsWith('.ts')) files.push(path);
  }
  return files;
}

function countLines(content) {
  const lines = content.split('\n');
  let total = 0;
  let inBlockComment = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true;
      continue;
    }
    if (line.startsWith('//')) continue;
    total++;
  }
  return total;
}

const files = walk(CORE_DIR);
const breakdown = files.map((f) => ({
  file: f,
  lines: countLines(readFileSync(f, 'utf8')),
}));

const total = breakdown.reduce((a, b) => a + b.lines, 0);

console.log('\ncore/ 行数分布（不含空行和注释）:\n');
for (const b of breakdown) {
  const bar = '█'.repeat(Math.ceil(b.lines / 10));
  console.log(`  ${b.lines.toString().padStart(4)} ${bar} ${b.file}`);
}
console.log(`  ----`);
console.log(`  ${total.toString().padStart(4)} TOTAL`);

if (total > MAX_LINES) {
  console.error(`\n❌ 宪法红线 2 违反：core/ 超过 ${MAX_LINES} 行（实际 ${total}）`);
  console.error('   立即拆分或简化\n');
  process.exit(1);
}

console.log(`\n✅ core/ 行数检查通过（${total}/${MAX_LINES}）`);
