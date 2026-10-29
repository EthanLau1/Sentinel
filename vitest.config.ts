import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // 固定 root，防止 vite/postcss 配置搜索向上爬出 iCloud 目录边界
  root: path.resolve(__dirname),
  // 明确设空 postcss 配置，避免 vite 向上爬出项目目录触发 iCloud 权限错误
  css: {
    postcss: {},
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // dev-server / ui 测试真起 HTTP 进程，iCloud 目录下启动慢，5s 不够
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['packages/*/src/**/*.ts'],
      // 纯类型 / 桶文件不计入运行时覆盖率
      exclude: [
        '**/types.ts',
        '**/ports.ts',
        '**/index.ts',
      ],
      thresholds: {
        // M0 红线：core 运行时代码 100% 覆盖
        'packages/core/src/**/*.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        // 批2：报告层 —— 11 字段缺一不可，必须有断言守住
        'packages/reporters/src/**/*.ts': {
          lines: 70,
          statements: 70,
          functions: 70,
          branches: 60,
        },
        // 批2：检索层 —— provider 契约测试（不发真网络请求）
        'packages/providers/src/knowledge/**/*.ts': {
          lines: 70,
          statements: 70,
          functions: 70,
          branches: 70,
        },
        // adapters —— 11 个框架 adapter 的检测口径必须被钉住
        // （口径漂移会让 mapper 静默漏掉项目，代价是"什么都没发现"）
        'packages/adapters/src/**/*.ts': {
          lines: 70,
          statements: 70,
          functions: 70,
          branches: 60,
        },
      },
    },
  },
});
