import { describe, it, expect, vi } from 'vitest';
import { ClearvoClient } from '../src/client';

function client() {
  const m = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: true }) });
  global.fetch = m as unknown as typeof fetch;
  const c = new ClearvoClient({ apiKey: 'csk_test_x', baseUrl: 'http://x/v1' });
  return { c, m };
}
const body = (m: ReturnType<typeof vi.fn>) => JSON.parse((m.mock.calls[0][1] as { body: string }).body);

describe('company name on tax number validation', () => {
  it('validateTaxNumber sends companyName only when given', async () => {
    const { c, m } = client();
    await c.validateTaxNumber('RO', 'RO1', { companyName: 'Acme SRL' });
    expect(body(m)).toEqual({ countryCode: 'RO', taxNumber: 'RO1', companyName: 'Acme SRL' });
    m.mockClear();
    await c.validateTaxNumber('RO', 'RO1');
    expect(body(m)).toEqual({ countryCode: 'RO', taxNumber: 'RO1' });
  });
  it('validateTaxNumbersBatch passes companyName per item', async () => {
    const { c, m } = client();
    await c.validateTaxNumbersBatch([{ countryCode: 'CZ', taxNumber: 'CZ1', companyName: 'Foo s.r.o.' }]);
    expect(body(m).items[0].companyName).toBe('Foo s.r.o.');
  });
});
