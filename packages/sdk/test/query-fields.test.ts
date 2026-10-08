// ClearvoClient.getQueryFields(): optional dataset / compact / field narrowing of GET /v1/query/fields.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';

describe('ClearvoClient.getQueryFields', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  async function urlFor(params?: Parameters<ClearvoClient['getQueryFields']>[0]): Promise<string> {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ schemaVersion: '1.0.0', datasets: {} }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.getQueryFields(params);
    return fetchMock.mock.calls[0][0] as string;
  }

  it('sends no query string by default (full payload)', async () => {
    expect(await urlFor()).toBe('http://x/v1/query/fields');
  });

  it('forwards dataset, compact and field', async () => {
    expect(await urlFor({ dataset: 'tax_calculation_line_items', compact: true })).toBe('http://x/v1/query/fields?dataset=tax_calculation_line_items&compact=true');
    expect(await urlFor({ dataset: 'tax_calculations', field: 'taxCode' })).toBe('http://x/v1/query/fields?dataset=tax_calculations&field=taxCode');
    expect(await urlFor({ compact: false })).toBe('http://x/v1/query/fields?compact=false');
  });
});
