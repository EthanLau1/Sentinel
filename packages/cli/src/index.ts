#!/usr/bin/env node
/**
 * Sentinel CLI 主入口。
 *
 * 用法：
 *   sentinel run                ← 主入口（一键跑全流程）
 *   sentinel doctor             ← Self-Check
 *   sentinel map                ← 只生成 FeatureMap
 *   sentinel hello              ← 验证 LLM 通路
 *   sentinel init               ← 初始化项目
 *   sentinel ui                 ← 启动本地 WebUI 控制台
 *   sentinel update             ← 自更新（占位，M8.5）
 */

import { color } from '@sentinel/reporters';

const HELP = `Sentinel — Universal Debug Agent

Usage:
  sentinel run [options]      Run end-to-end debug flow
  sentinel run --demo         Show a complete no-key demo run
  sentinel doctor             Self-Check environment + config
  sentinel map                Generate FeatureMap only
  sentinel hello              Verify LLM connectivity
  sentinel init               Initialize .sentinel/ in project
  sentinel ui                 Start local Sentinel Console (WebUI)
  sentinel update             Auto-update skills/adapters/cache
  sentinel --help             Show this help

Options for 'run':
  --detailed                  Include sensitive Evidence (cookie/storage)
  --demo                      Run a no-key demo with sample bugs/fixes
  --no-enhance                Skip M6 knowledge enhancement
  --tier <0|1|2|3>            Max auto-fix tier (default 1)
  --report <markdown|json|both>  Report format (default both)

Global:
  --project <path>            Project root (default cwd)
`;

async function main(): Promise<void> {
  const cmd = process.argv[2];

  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    process.exit(0);
  }

  try {
    switch (cmd) {
      case 'run': {
        const { runRun } = await import('./run.js');
        process.exit(await runRun());
      }
      case 'doctor': {
        const { runDoctor } = await import('./doctor.js');
        process.exit(await runDoctor());
      }
      case 'map': {
        const { runMap } = await import('./map.js');
        process.exit(await runMap());
      }
      case 'hello': {
        const { runHello } = await import('./hello.js');
        process.exit(await runHello());
      }
      case 'init': {
        const { runInit } = await import('./init.js');
        await runInit();
        process.exit(0);
      }
      case 'ui': {
        const { runUi } = await import('./ui.js');
        process.exit(await runUi());
      }
      case 'update': {
        console.log(color.yellow('sentinel update — M8.5 stub'));
        console.log('M8.5 will refresh skills/adapters/knowledge cache.');
        process.exit(0);
      }
      default:
        console.error(color.red(`Unknown command: ${cmd}`));
        console.log(HELP);
        process.exit(1);
    }
  } catch (err) {
    console.error(color.red(`Fatal: ${(err as Error).message}`));
    if (process.env['SENTINEL_DEBUG']) console.error((err as Error).stack);
    process.exit(2);
  }
}

void main();
