// Coverage for `clearvo revoke-hosted-page <id>` — DELETE /v1/invoices/{id}/hosted-page.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createProgram } from '../src/program';

describe('clearvo revoke-hosted-page', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CLEARVO_API_KEY;
  const originalBaseUrl = process.env.CLEARVO_BASE_URL;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.CLEARVO_API_KEY = 'csk_live_testkey';
    process.env.CLEARVO_BASE_URL = 'http://x/v1';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.CLEARVO_API_KEY; else process.env.CLEARVO_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.CLEARVO_BASE_URL; else process.env.CLEARVO_BASE_URL = originalBaseUrl;
    logSpy.mockRestore();
  });

  it('DELETEs /invoices/{id}/hosted-page and forwards --entity as x-entity-id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ revoked: 1 }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await createProgram().parseAsync(['node', 'clearvo', 'revoke-hosted-page', 'inv-1', '--entity', 'ent-9']);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/invoices/inv-1/hosted-page');
    expect(opts.method).toBe('DELETE');
    expect(opts.headers['x-entity-id']).toBe('ent-9');
    expect(logSpy).toHaveBeenCalled();
  });
});
