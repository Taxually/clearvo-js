// Coverage for ClearvoClient.quoteDuties() — POST /v1/duties/quote (docs/features/duties-engine MH-9). The body is the
// calculate body, sent as given; the result is returned unchanged, including a degraded 200.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';
import type { DutiesResult } from '../src/types';

describe('ClearvoClient.quoteDuties', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const quoted: DutiesResult = {
    currency: 'USD',
    duties: { status: 'quoted', contentVersion: 7 },
    lineItems: [{
      id: 'l1',
      duty: {
        consignmentId: 'c1', commodityCode: '6109100012', scheme: 'HTS10', codeSource: 'request', precision: 'TARIFF_LINE',
        origin: 'CN', originSource: 'request', customsValue: 40, amount: 6.6,
        measures: [{ type: 'MFN', rate: 0.165, rateExpression: { type: 'ad_valorem_pct', value: 16.5 }, amount: 6.6, legalBasis: null, effectiveFrom: '2026-01-01' }],
        notEvaluated: [], missingInputs: [], estimateReasons: ['preference_not_considered'],
      },
    }],
    summary: { totalDuty: 6.6 },
  };

  it('POSTs the body unchanged to /duties/quote and returns the result', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => quoted });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const input = {
      currency: 'USD',
      customer: { billingAddress: { country: 'US', region: 'TX', postalCode: '78701' } },
      shipFrom: { country: 'GB' },
      lineItems: [{ id: 'l1', amount: 40, productName: 'T-shirt', commodityCode: '6109100012', commodityCodeScheme: 'HTS10' as const, countryOfOrigin: 'CN' }],
    };
    const result = await client.quoteDuties(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/duties/quote');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual(input);
    expect(result).toEqual(quoted);
  });

  it('returns a degraded quote as a normal result, never a thrown error', async () => {
    const degraded: DutiesResult = { currency: 'USD', duties: { status: 'degraded', reason: 'content_unavailable' }, lineItems: [] };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => degraded }) as unknown as typeof fetch;
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const result = await client.quoteDuties({ currency: 'USD', lineItems: [{ id: 'l1', amount: 40, productName: 'T-shirt' }] });
    expect(result.duties).toEqual({ status: 'degraded', reason: 'content_unavailable' });
  });
});
