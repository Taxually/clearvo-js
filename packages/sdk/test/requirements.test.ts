// ClearvoClient.getRequirements(): GET /v1/requirements with the country and the optional obligation class and mandate filters.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';

describe('ClearvoClient.getRequirements', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const call = async (country: string, filter?: Parameters<ClearvoClient['getRequirements']>[1]) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ country, countryName: 'Germany', invoiceContent: { requirements: [], total: 0 } }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new ClearvoClient({ apiKey: 'csk_test_x', baseUrl: 'http://x/v1' });
    const out = await client.getRequirements(country, filter);
    return { out, url: (fetchMock.mock.calls[0] as [string])[0] };
  };

  it('asks for the country alone by default', async () => {
    const { out, url } = await call('DE');
    expect(url).toBe('http://x/v1/requirements?country=DE');
    expect(out.invoiceContent?.total).toBe(0);
  });

  it('passes the obligation class and mandate filters', async () => {
    const { url } = await call('ES', { class: 'format_authority', mandate: 'ES_SII' });
    expect(url).toBe('http://x/v1/requirements?country=ES&class=format_authority&mandate=ES_SII');
  });
});
