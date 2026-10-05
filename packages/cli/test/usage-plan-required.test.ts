// `clearvo usage` (GET /v1/usage) and the free-plan 402 plan_required message on `clearvo calculate`.
// Mocked fetch, fresh program per test.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createProgram } from '../src/program';

describe('clearvo usage / plan_required', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CLEARVO_API_KEY;
  const originalBaseUrl = process.env.CLEARVO_BASE_URL;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.CLEARVO_API_KEY = 'csk_live_testkey';
    process.env.CLEARVO_BASE_URL = 'http://x/v1';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.CLEARVO_API_KEY; else process.env.CLEARVO_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.CLEARVO_BASE_URL; else process.env.CLEARVO_BASE_URL = originalBaseUrl;
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('usage GETs /usage and prints the response', async () => {
    const body = { usage: { plan: 'growth', billingStatus: 'active', used: 10, included: 5000 } };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    global.fetch = fetchMock as unknown as typeof fetch;

    await createProgram().parseAsync(['usage'], { from: 'user' });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/usage');
    expect(opts.method).toBe('GET');
    expect(opts.body).toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(body));
  });

  it('calculate prints a clear upgrade message on a 402 plan_required and exits 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clearvo-cli-test-'));
    const file = join(dir, 'calc.json');
    writeFileSync(file, JSON.stringify({ currency: 'EUR', customer: { billingAddress: { country: 'FR' } }, lineItems: [] }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({ error: 'plan_required', calculationId: 'calc_123', monitorOnly: true, upgradeUrl: 'https://app.clearvo.io/settings/billing' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('process.exit called');
    }) as never);

    await expect(createProgram().parseAsync(['calculate', file], { from: 'user' })).rejects.toThrow('process.exit called');

    const printed = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('does not include tax calculation results');
    expect(printed).toContain('calc_123');
    expect(printed).toContain('https://app.clearvo.io/settings/billing');
    expect(printed).not.toContain('HTTP 402');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('prints the plan sentence and upgrade URL on a 403 explore_not_included and exits 1', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'explore_not_included', message: 'Explore is available on Growth and above.', upgradeUrl: 'https://app.clearvo.io/settings/billing' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('process.exit called');
    }) as never);

    await expect(createProgram().parseAsync(['usage'], { from: 'user' })).rejects.toThrow('process.exit called');

    const printed = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('Explore is available on Growth and above.');
    expect(printed).toContain('https://app.clearvo.io/settings/billing');
    expect(printed).not.toContain('HTTP 403');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
