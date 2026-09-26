import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  close: vi.fn(),
  ariaSnapshot: vi.fn(),
}));

vi.mock('playwright', () => ({ chromium: { launch: mocks.launch } }));
vi.mock('../src/config.js', () => ({
  projectRoot: () => '/private/tmp/sentinel-doctor-test-missing',
  loadLlmConfig: async () => null,
  loadBudgetConfig: async () => ({ stage: 'mvp', limits: { maxCostUsdPerRun: 1 } }),
}));

import { runDoctor } from '../src/doctor.js';

describe('doctor browser readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to Chrome and verifies launch, aria snapshot and close', async () => {
    mocks.launch.mockRejectedValueOnce(new Error("Executable doesn't exist"))
      .mockResolvedValueOnce({
        newPage: async () => ({ locator: () => ({ ariaSnapshot: mocks.ariaSnapshot }) }),
        close: mocks.close,
      });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runDoctor();
      expect(mocks.launch).toHaveBeenNthCalledWith(2, { headless: true, channel: 'chrome' });
      expect(mocks.ariaSnapshot).toHaveBeenCalledOnce();
      expect(mocks.close).toHaveBeenCalledOnce();
      expect(log.mock.calls.map(call => call.join(' ')).join('\n')).toContain('Chromium/Chrome launched and closed');
    } finally {
      log.mockRestore();
    }
  });

  it('reports failure when neither browser can start', async () => {
    mocks.launch.mockRejectedValueOnce(new Error("Executable doesn't exist"))
      .mockRejectedValueOnce(new Error('Chrome unavailable'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await runDoctor()).toBe(1);
      expect(log.mock.calls.map(call => call.join(' ')).join('\n')).toContain('browser not ready: Chrome unavailable');
    } finally {
      log.mockRestore();
    }
  });
});
