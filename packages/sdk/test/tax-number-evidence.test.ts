import { describe, it, expect, vi } from 'vitest';
import { ClearvoClient } from '../src/client';

function client() {
  const m = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  global.fetch = m as unknown as typeof fetch;
  return { c: new ClearvoClient({ apiKey: 'csk_test_x', baseUrl: 'http://x/v1' }), m };
}

describe('tax number evidence', () => {
  it('listTaxNumberLookups builds the query', async () => {
    const { c, m } = client();
    await c.listTaxNumberLookups({ countryCode: 'DE', valid: false, from: '2026-01-01', page: 2, limit: 10 });
    expect(m.mock.calls[0][0]).toBe('http://x/v1/tax-numbers/lookups?countryCode=DE&valid=false&from=2026-01-01&page=2&limit=10');
    expect((m.mock.calls[0][1] as { method: string }).method).toBe('GET');
  });
  it('listTaxNumberLookups with no params has no query string', async () => {
    const { c, m } = client();
    await c.listTaxNumberLookups();
    expect(m.mock.calls[0][0]).toBe('http://x/v1/tax-numbers/lookups');
  });
  it('queryTaxNumberCheckHistory posts the request', async () => {
    const { c, m } = client();
    await c.queryTaxNumberCheckHistory({ items: [{ taxNumber: 'DE123456789' }], asOf: '2026-03-31', includeChecks: true });
    expect(m.mock.calls[0][0]).toBe('http://x/v1/tax-numbers/check-history');
    const init = m.mock.calls[0][1] as { method: string; body: string };
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ items: [{ taxNumber: 'DE123456789' }], asOf: '2026-03-31', includeChecks: true });
  });
});
