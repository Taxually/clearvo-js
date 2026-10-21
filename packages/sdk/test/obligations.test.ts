// Coverage for ClearvoClient.listObligations() — GET /v1/tax/obligations query building, including includePreview.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';
import type { ListObligationsResponse } from '../src/types';

describe('ClearvoClient.listObligations', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const response: ListObligationsResponse = {
    obligations: [],
    total: 0,
    previewObligations: [{
      id: 'eu-distance-sales', country: 'EU', region: null, scheme: 'EU_DISTANCE_SALES', registrationStatus: 'NOT_REGISTERED',
      obligationStatus: 'MONITORING', thresholdAmount: 10000, thresholdCurrency: 'EUR', currentPeriodAmount: 1200,
      actionRequired: false, statusLabel: 'Monitoring', severity: 'neutral', commentary: null, isPreview: true,
    }],
    previewTotal: 1,
  };

  function setup() {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => response });
    global.fetch = fetchMock as unknown as typeof fetch;
    return { fetchMock, client: new ClearvoClient({ apiKey: 'csk_test_x', baseUrl: 'http://x/v1' }) };
  }

  it('sends no query string without params', async () => {
    const { fetchMock, client } = setup();
    await client.listObligations();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/tax/obligations');
    expect(opts.method).toBe('GET');
  });

  it('sends includePreview=true with country and status, and returns previewObligations', async () => {
    const { fetchMock, client } = setup();
    const result = await client.listObligations({ country: 'EU', status: 'BREACH', includePreview: true });
    const [url] = fetchMock.mock.calls[0];
    const qs = new URL(url as string).searchParams;
    expect(qs.get('country')).toBe('EU');
    expect(qs.get('status')).toBe('BREACH');
    expect(qs.get('includePreview')).toBe('true');
    expect(result.previewObligations?.[0].id).toBe('eu-distance-sales');
    expect(result.previewTotal).toBe(1);
  });

  it('omits undefined params and keeps includePreview=false', async () => {
    const { fetchMock, client } = setup();
    await client.listObligations({ country: undefined, includePreview: false });
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/tax/obligations?includePreview=false');
  });
});
