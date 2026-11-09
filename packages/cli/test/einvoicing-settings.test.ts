// `clearvo einvoicing-settings get|set` — GET/PATCH /v1/einvoicing/settings.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createProgram } from '../src/program';

const okBody = {
  ok: true,
  settings: { validateTaxNumbersOnSend: true, effectiveValidateTaxNumbersOnSend: true },
  validateTaxNumbersOnSendCopy: { label: 'l', description: 'd' },
};

describe('clearvo einvoicing-settings', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CLEARVO_API_KEY;
  const originalBaseUrl = process.env.CLEARVO_BASE_URL;

  beforeEach(() => {
    process.env.CLEARVO_API_KEY = 'csk_live_testkey';
    process.env.CLEARVO_BASE_URL = 'http://x/v1';
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    if (originalApiKey === undefined) delete process.env.CLEARVO_API_KEY; else process.env.CLEARVO_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.CLEARVO_BASE_URL; else process.env.CLEARVO_BASE_URL = originalBaseUrl;
  });

  function mockFetch() {
    const m = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => okBody,
      text: async () => JSON.stringify(okBody),
    });
    global.fetch = m as unknown as typeof fetch;
    return m;
  }

  it('get calls GET /einvoicing/settings with the entity header', async () => {
    const m = mockFetch();
    await createProgram().parseAsync(['node', 'clearvo', 'einvoicing-settings', 'get', '--entity', 'ent_1']);
    expect(m.mock.calls[0][0]).toBe('http://x/v1/einvoicing/settings');
    expect(m.mock.calls[0][1].method).toBe('GET');
    expect(m.mock.calls[0][1].headers['x-entity-id']).toBe('ent_1');
  });

  it.each([
    ['true', true],
    ['false', false],
    ['inherit', null],
  ])('set --validate-tax-numbers-on-send %s sends %s', async (arg, expected) => {
    const m = mockFetch();
    await createProgram().parseAsync(['node', 'clearvo', 'einvoicing-settings', 'set', '--validate-tax-numbers-on-send', arg]);
    expect(m.mock.calls[0][1].method).toBe('PATCH');
    expect(JSON.parse(m.mock.calls[0][1].body)).toEqual({ validateTaxNumbersOnSend: expected });
  });

  it('set rejects any other value without calling the API', async () => {
    const m = mockFetch();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      createProgram().parseAsync(['node', 'clearvo', 'einvoicing-settings', 'set', '--validate-tax-numbers-on-send', 'maybe']),
    ).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(m).not.toHaveBeenCalled();
  });
});
