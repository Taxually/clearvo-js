// Coverage for ClearvoClient.eraseCustomerAddressData() — POST /v1/tax/address-erasure.
// The body names the calculation (calculationId or reference) and an optional level; entityId travels as the x-entity-id header.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';

const RESULT = {
  ok: true, level: 'street', matched: 2, redacted: 2, alreadyClean: 0, skippedPurchases: 0,
  lineItemsRedacted: 2, cacheEntriesRemoved: 1, calculationIds: ['cl_calc_a', 'cl_calc_b'], truncated: false,
};

describe('ClearvoClient.eraseCustomerAddressData', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const mock = () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => RESULT });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  };

  it('POSTs the reference and level to /tax/address-erasure and returns the counts', async () => {
    const fetchMock = mock();
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const result = await client.eraseCustomerAddressData({ reference: 'woo-order-123', level: 'full' });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/tax/address-erasure');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-entity-id']).toBeUndefined();
    expect(JSON.parse(opts.body as string)).toEqual({ reference: 'woo-order-123', level: 'full' });
    expect(result.redacted).toBe(2);
    expect(result.calculationIds).toEqual(['cl_calc_a', 'cl_calc_b']);
  });

  it('sends the calculation id, and the entity as a header not in the body', async () => {
    const fetchMock = mock();
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.eraseCustomerAddressData({ calculationId: 'cl_calc_a' }, 'ent-1');

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    expect(JSON.parse(opts.body as string)).toEqual({ calculationId: 'cl_calc_a' });
  });
});
