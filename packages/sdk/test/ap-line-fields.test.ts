// glAccount, costCenter, intendedUse and accountAssignment are flat line fields on
// POST /v1/tax/calculate (not customProperties); BUILT_IN_PROPERTY_AS_CUSTOM surfaces on ClearvoError.code.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';
import { ClearvoError } from '../src/types';

function mockFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const request = {
  currency: 'EUR',
  transactionDirection: 'purchase' as const,
  lineItems: [
    { id: '1', amount: 1000, glAccount: '4000', costCenter: 'CC-7', intendedUse: 'resale', accountAssignment: 'K' },
    { id: '2', amount: 500, accountAssignment: 'stock', customProperties: { poApprover: 'jo' } },
  ],
};

describe('AP first-class line fields', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('calculateTax sends the four fields flat on each line, and returns the echoed values', async () => {
    const fetchMock = mockFetch({
      lineItems: [
        { id: '1', glAccount: '4000', costCenter: 'CC-7', intendedUse: 'resale', accountAssignment: 'expense' },
        { id: '2', accountAssignment: 'stock' },
      ],
    });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const res = await client.calculateTax(request as never);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/tax/calculate');
    const sent = JSON.parse(opts.body as string);
    expect(sent.lineItems[0]).toEqual({ id: '1', amount: 1000, glAccount: '4000', costCenter: 'CC-7', intendedUse: 'resale', accountAssignment: 'K' });
    expect(sent.lineItems[0].customProperties).toBeUndefined();
    expect(sent.lineItems[1].customProperties).toEqual({ poApprover: 'jo' });
    expect(res.lineItems[0].accountAssignment).toBe('expense');
    expect(res.lineItems[0].glAccount).toBe('4000');
  });

  it('a built-in field under customProperties rejects with ClearvoError code BUILT_IN_PROPERTY_AS_CUSTOM', async () => {
    mockFetch(
      {
        error: 'built_in_property_as_custom',
        code: 'BUILT_IN_PROPERTY_AS_CUSTOM',
        message: "'glAccount' is a built-in property, not a custom one; use 'lineItems[1].glAccount'",
      },
      400,
    );
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const err = await client
      .calculateTax({ currency: 'EUR', lineItems: [{ id: '1', amount: 1, customProperties: { glAccount: '4000' } }] } as never)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClearvoError);
    expect((err as ClearvoError).status).toBe(400);
    expect((err as ClearvoError).code).toBe('BUILT_IN_PROPERTY_AS_CUSTOM');
  });

  it('createRulePropertyDefinition with a built-in key rejects 422 with the API message', async () => {
    mockFetch({ error: 'Validation failed' }, 422);
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const err = await client
      .createRulePropertyDefinition({ propertyKey: 'glAccount', label: 'GL', dataType: 'string' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClearvoError);
    expect((err as ClearvoError).status).toBe(422);
    expect((err as ClearvoError).code).toBeUndefined();
  });
});
