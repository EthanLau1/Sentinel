import { describe, expect, it } from 'vitest';
import { createBrowserMCPServer } from '../src/mcp/built-in/browser.js';

describe('browser MCP', () => {
  it('launches Chrome fallback, captures aria snapshot, and rejects false UI assertions', async () => {
    const browser = createBrowserMCPServer();
    const url = 'data:text/html,<title>Smoke</title><main><h1>Ready</h1><span hidden>Secret</span></main>';
    try {
      await browser.call('visit', { url });
      const snapshot = await browser.call('snapshot', {}) as { a11yTree: string };
      expect(snapshot.a11yTree).toContain('Ready');
      await expect(browser.call('assert', { kind: 'url', expected: url })).resolves.toEqual({ passed: true });
      await expect(browser.call('assert', { kind: 'text', expected: 'Ready' })).resolves.toEqual({ passed: true });
      await expect(browser.call('assert', { kind: 'visible', selector: 'h1' })).resolves.toEqual({ passed: true });
      await expect(browser.call('assert', { kind: 'url', expected: '/wrong' })).rejects.toThrow('Expected URL');
      await expect(browser.call('assert', { kind: 'visible', selector: '[hidden]' })).rejects.toThrow();
      await expect(browser.call('assert', { kind: 'text', expected: 'Absent' })).rejects.toThrow();
    } finally {
      await browser.call('close', {});
    }
  }, 30_000);
});
