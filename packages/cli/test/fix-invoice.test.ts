// Coverage for `clearvo invoices fix`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createProgram } from '../src/program';

describe('clearvo invoices fix', () => {
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

  it('posts repeated --field values, keeping text as text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, mode: 'updated_in_place' }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await createProgram().parseAsync(['node', 'clearvo', 'invoices', 'fix', 'inv_1', '--field', 'customer.address.country=DE', '--field', 'customer.address.postalCode=01234']);
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/invoices/inv_1/fix');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ fields: { 'customer.address.country': 'DE', 'customer.address.postalCode': '01234' } });
  });

  it('accepts a JSON object with --fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await createProgram().parseAsync(['node', 'clearvo', 'invoices', 'fix', 'inv_1', '--fields', '{"lines.0.quantity":2}']);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ fields: { 'lines.0.quantity': 2 } });
  });

  it('sends dryRun and the confirmation token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'inv_1' }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await createProgram().parseAsync(['node', 'clearvo', 'invoices', 'fix', 'inv_1', '--field', 'a=b', '--dry-run', '--confirmation-token', 'tok']);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ fields: { a: 'b' }, dryRun: true, confirmationToken: 'tok' });
  });
});
