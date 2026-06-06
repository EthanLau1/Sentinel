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
      },
    },
  },
});
