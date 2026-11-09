// E-Invoicing settings: GET/PATCH /v1/einvoicing/settings (the optional live tax-number check on sent invoices).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function mock(body: unknown, status = 200) {
  const m = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  global.fetch = m as unknown as typeof fetch;
  return m;
}
const client = () => new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
const response = {
  ok: true,
  settings: { validateTaxNumbersOnSend: null, effectiveValidateTaxNumbersOnSend: false },
  validateTaxNumbersOnSendCopy: { label: 'l', description: 'd' },
};

describe('E-Invoicing settings', () => {
  it('getEinvoicingSettings GETs /einvoicing/settings', async () => {
    const m = mock(response);
    const out = await client().getEinvoicingSettings();
    expect(m.mock.calls[0][0]).toBe('http://x/v1/einvoicing/settings');
    expect(m.mock.calls[0][1].method).toBe('GET');
    expect(out.settings.validateTaxNumbersOnSend).toBeNull();
    expect(out.settings.effectiveValidateTaxNumbersOnSend).toBe(false);
  });

  it('updateEinvoicingSettings PATCHes the body and forwards x-entity-id', async () => {
    const m = mock(response);
    await client().updateEinvoicingSettings({ validateTaxNumbersOnSend: true }, 'ent_1');
    expect(m.mock.calls[0][1].method).toBe('PATCH');
    expect(JSON.parse(m.mock.calls[0][1].body)).toEqual({ validateTaxNumbersOnSend: true });
    expect(m.mock.calls[0][1].headers['x-entity-id']).toBe('ent_1');
  });

  it('null clears an entity override and is sent as null', async () => {
    const m = mock(response);
    await client().updateEinvoicingSettings({ validateTaxNumbersOnSend: null });
    expect(JSON.parse(m.mock.calls[0][1].body)).toEqual({ validateTaxNumbersOnSend: null });
  });
});
