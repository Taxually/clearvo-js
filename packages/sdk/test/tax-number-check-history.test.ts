// checkTaxNumberHistory: POST /tax-numbers/check-history with the body as given.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';
import { ClearvoError } from '../src/types';

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

describe('checkTaxNumberHistory', () => {
  it('posts items, asOf and includeChecks and returns the typed response', async () => {
    const resp = {
      asOf: '2026-03-31T00:00:00.000Z', applicableWindowDays: 30, total: 1,
      results: [{ index: 0, countryCode: 'DE', taxNumber: 'DE123456789',
        applicable: { checkedAt: '2026-03-20T10:00:00.000Z', valid: true, checkReference: 'WAPIAAAA', registryType: 'vat', source: 'vies', daysFromAsOf: -11 } }],
    };
    const m = mock(resp);
    const out = await client().checkTaxNumberHistory({ items: [{ taxNumber: 'DE123456789' }], asOf: '2026-03-31', includeChecks: true });
    expect(m.mock.calls[0][0]).toBe('http://x/v1/tax-numbers/check-history');
    expect(m.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(m.mock.calls[0][1].body)).toEqual({ items: [{ taxNumber: 'DE123456789' }], asOf: '2026-03-31', includeChecks: true });
    expect(out.results[0].applicable?.checkReference).toBe('WAPIAAAA');
  });

  it('throws ClearvoError on a 400', async () => {
    mock({ ok: false, error: { code: 'TOO_MANY_ITEMS', message: 'Maximum 500 items per request' } }, 400);
    await expect(client().checkTaxNumberHistory({ items: [{ taxNumber: 'x' }] })).rejects.toBeInstanceOf(ClearvoError);
  });
});
