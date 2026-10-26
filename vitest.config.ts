import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
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
