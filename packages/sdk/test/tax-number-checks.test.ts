import { describe, it, expect, vi } from 'vitest';
import { ClearvoClient } from '../src/client';

function client(response: Record<string, unknown> = {}) {
  const m = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => 'csv', ...response });
  global.fetch = m as unknown as typeof fetch;
  return { c: new ClearvoClient({ apiKey: 'csk_test_x', baseUrl: 'http://x/v1' }), m };
}

describe('tax number checks', () => {
  it('listTaxNumberChecks builds the query from every filter', async () => {
    const { c, m } = client();
    await c.listTaxNumberChecks({ page: 2, pageSize: 100, countryCode: 'DE', result: 'valid', source: 'cache', requester: 'own', from: '2026-01-01', to: '2026-02-01', q: '123', taxNumber: 'DE123456789' });
    const url = new URL(m.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/v1/tax-numbers/checks');
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: '2', pageSize: '100', countryCode: 'DE', result: 'valid', source: 'cache', requester: 'own', from: '2026-01-01', to: '2026-02-01', q: '123', taxNumber: 'DE123456789' });
    expect((m.mock.calls[0][1] as { method: string }).method).toBe('GET');
  });
  it('listTaxNumberChecks with no params has no query string', async () => {
    const { c, m } = client();
    await c.listTaxNumberChecks();
    expect(m.mock.calls[0][0]).toBe('http://x/v1/tax-numbers/checks');
  });
  it('exportTaxNumberChecks returns the CSV text', async () => {
    const { c, m } = client({ text: async () => 'id,checkedAt\n1,2026' });
    const csv = await c.exportTaxNumberChecks({ countryCode: 'FR', result: 'invalid' });
    expect(m.mock.calls[0][0]).toBe('http://x/v1/tax-numbers/checks/export?countryCode=FR&result=invalid');
    expect(csv).toBe('id,checkedAt\n1,2026');
  });
  it('exportTaxNumberChecks surfaces an API error', async () => {
    const { c } = client({ ok: false, status: 400, json: async () => ({ error: 'bad' }), text: async () => '{"error":"bad"}', headers: new Headers() });
    await expect(c.exportTaxNumberChecks({})).rejects.toThrow();
  });
  it('listTaxNumberBatchJobs hits the validate-batch list route', async () => {
    const { c, m } = client();
    await c.listTaxNumberBatchJobs({ page: 3, pageSize: 10 });
    expect(m.mock.calls[0][0]).toBe('http://x/v1/tax-numbers/validate-batch?page=3&pageSize=10');
    await c.listTaxNumberBatchJobs();
    expect(m.mock.calls[1][0]).toBe('http://x/v1/tax-numbers/validate-batch');
  });
  it('recheckTaxNumber posts the body', async () => {
    const { c, m } = client();
    await c.recheckTaxNumber({ countryCode: 'DE', taxNumber: 'DE123456789' });
    expect(m.mock.calls[0][0]).toBe('http://x/v1/tax-numbers/recheck');
    const init = m.mock.calls[0][1] as { method: string; body: string };
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ countryCode: 'DE', taxNumber: 'DE123456789' });
  });
});
