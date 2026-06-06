#!/usr/bin/env node
// scripts/check-core-purity.mjs
// 宪法红线 1: core/ 不允许依赖任何具体平台/框架/LLM/浏览器
// 任何 PR 必须通过此脚本

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CORE_DIR = 'packages/core/src';

// 不允许在 core/ 中出现的关键字（来自具体平台实现）
const FORBIDDEN_PATTERNS = [
  // Frameworks
  /\bnext(\/|-)/i,
  /\bexpress\b/i,
  /\bhono\b/i,
  /\b@nestjs\b/i,
  /\bvue\b/i,
  /\bsvelte\b/i,
  // Browser/automation
  /\bplaywright\b/i,
  /\bpuppeteer\b/i,
  /\bcypress\b/i,
  // LLM SDKs
  /\b@?anthropic\b/i,
  /\bopenai\b/i,
  /\bclaude\b/i,
  /\bollama\b/i,
  /\bdeepseek\b/i,
  // Data
  /\bprisma\b/i,
  /\bdrizzle\b/i,
  /\bsupabase\b/i,
  /\bmongodb\b/i,
  /\bredis\b/i,
  /\bioredis\b/i,
  /\bpostgres\b/i,
];

// 允许出现的例外（这些词在通用上下文也合法）
const ALLOWED_IN_COMMENTS = false; // 红线：注释也不能出现

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, files);
    else if (path.endsWith('.ts')) files.push(path);
  }
  return files;
}

function check() {
  const files = walk(CORE_DIR);
  const violations = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      // 跳过纯注释行（如果允许）
      if (ALLOWED_IN_COMMENTS && line.trim().startsWith('//')) return;

      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({
            file,
            line: idx + 1,
            content: line.trim(),
            pattern: pattern.source,
          });
        }
      }
    });
  }

  if (violations.length > 0) {
    console.error('\n❌ 宪法红线 1 违反：core/ 出现了具体平台/框架/LLM 关键字\n');
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}`);
      console.error(`    ${v.content}`);
      console.error(`    匹配: ${v.pattern}\n`);
    }
    process.exit(1);
  }

  console.log(`✅ core/ 纯度检查通过（${files.length} 个文件无违规）`);
}

check();
