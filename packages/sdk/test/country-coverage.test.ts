// ClearvoClient.listCountryCoverage(): GET /v1/coverage, no parameters.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';

describe('ClearvoClient.listCountryCoverage', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('GETs /coverage and returns the countries', async () => {
    const body = { ok: true, data: { countries: [{ country: 'DE', name: 'Germany', mandate: 'DE_XRECHNUNG', status: 'live', goLiveDate: '2025-01-01' }] } };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new ClearvoClient({ apiKey: 'csk_test_x', baseUrl: 'http://x/v1' });
    const out = await client.listCountryCoverage();
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string }];
    expect(url).toBe('http://x/v1/coverage');
    expect(init.method).toBe('GET');
    expect(out.data.countries[0].status).toBe('live');
  });
});
