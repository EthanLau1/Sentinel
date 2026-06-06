/**
 * MCP Registry — 3+N 模式实现。
 *
 * 内置 3 个核心 MCP（http / browser / fs）跟工具一起发布。
 * 用户可通过 register() 加任意第三方 MCP server。
 */

import type { MCPRegistry, MCPServer } from '@sentinel/core';

export function createMCPRegistry(): MCPRegistry {
  const servers = new Map<string, MCPServer>();

  return {
    register(server: MCPServer): void {
      servers.set(server.name, server);
    },
    unregister(name: string): void {
      servers.delete(name);
    },
    get(name: string): MCPServer | undefined {
      return servers.get(name);
    },
    list(): MCPServer[] {
      return [...servers.values()];
    },
  };
}
