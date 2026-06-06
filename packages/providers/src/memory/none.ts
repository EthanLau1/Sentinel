/**
 * 默认 Memory Provider — 无记忆。
 * 工具的 zero-state 哲学：没有用户即插即用的 memory，就什么都不存。
 */

import type { MemoryProvider } from '@sentinel/core';

export function createNoneMemory(): MemoryProvider {
  return {
    name: 'none',
    async recall() {
      return [];
    },
    async remember() {
      // 无操作
    },
  };
}
