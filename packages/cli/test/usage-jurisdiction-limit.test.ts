// `clearvo usage`, and the 409 jurisdiction_limit_reached rendering of the registration commands.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createProgram } from '../src/program';

describe('clearvo usage and the jurisdiction limit', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CLEARVO_API_KEY;
  const originalBaseUrl = process.env.CLEARVO_BASE_URL;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.CLEARVO_API_KEY = 'csk_live_testkey';
    process.env.CLEARVO_BASE_URL = 'http://x/v1';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.CLEARVO_API_KEY; else process.env.CLEARVO_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.CLEARVO_BASE_URL; else process.env.CLEARVO_BASE_URL = originalBaseUrl;
    logSpy.mockRestore(); errSpy.mockRestore(); exitSpy.mockRestore();
  });

  it('"usage" GETs /usage and prints the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ usage: { jurisdictions: { active: 1, countedTowardLimit: 2, max: 10 } } }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await createProgram().parseAsync(['node', 'clearvo', 'usage']);
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/usage');
    expect(logSpy.mock.calls[0][0]).toContain('countedTowardLimit');
  });

  it('"registrations add --collect-now" sends collectFromDate null', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await createProgram().parseAsync(['node', 'clearvo', 'registrations', 'add', '--type', 'VAT', '--number', 'DE1', '--country', 'DE', '--collect-now']);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({ collectFromDate: null, taxNumber: 'DE1' });
  });

  it('a 409 jurisdiction_limit_reached prints the message and the contact link, then exits 1', async () => {
    const body = { error: 'Limit reached.', code: 'jurisdiction_limit_reached', limit: 10, collecting: 10, contactSalesUrl: 'mailto:hello@clearvo.io', hint: 'h' };
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => body }) as unknown as typeof fetch;
    await expect(createProgram().parseAsync(['node', 'clearvo', 'registrations', 'set-collection', 'reg_1', '--immediately'])).rejects.toThrow('exit');
    const printed = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('Limit reached.');
    expect(printed).toContain('Nothing was changed');
    expect(printed).toContain('mailto:hello@clearvo.io');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
