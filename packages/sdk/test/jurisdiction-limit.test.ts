// ClearvoClient: getUsage and the typed 409 jurisdiction_limit_reached error on the registration writes.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';
import { ClearvoError, ClearvoJurisdictionLimitError } from '../src/types';

const LIMIT_BODY = {
  error: 'You have reached the limit of 10 jurisdictions on self-serve pricing. To collect tax in more jurisdictions you need to upgrade. Contact us to discuss.',
  code: 'jurisdiction_limit_reached',
  limit: 10,
  collecting: 10,
  contactSalesUrl: 'mailto:hello@clearvo.io',
  hint: 'Nothing was changed. Contact us to collect tax in more jurisdictions.',
};

describe('jurisdiction limit', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  const client = () => new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
  const mockFetch = (status: number, body: unknown) => {
    const fn = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
    global.fetch = fn as unknown as typeof fetch;
    return fn;
  };

  it('getUsage reads /usage', async () => {
    const fn = mockFetch(200, { usage: { jurisdictions: { active: 2, countedTowardLimit: 3, max: 10 } } });
    const res = await client().getUsage();
    expect(fn.mock.calls[0][0]).toBe('http://x/v1/usage');
    expect(res.usage.jurisdictions).toEqual({ active: 2, countedTowardLimit: 3, max: 10 });
  });

  it.each([
    ['addRegistration', (c: ClearvoClient) => c.addRegistration({ type: 'VAT', country: 'DE', collectFromDate: null })],
    ['setCollectionDate', (c: ClearvoClient) => c.setCollectionDate('reg_1', { collectFromDate: null })],
  ])('%s throws a typed error carrying the limit and where to contact us', async (_name, call) => {
    mockFetch(409, LIMIT_BODY);
    const err = await call(client()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClearvoJurisdictionLimitError);
    const e = err as ClearvoJurisdictionLimitError;
    expect(e.status).toBe(409);
    expect(e.code).toBe('jurisdiction_limit_reached');
    expect(e.limit).toBe(10);
    expect(e.collecting).toBe(10);
    expect(e.contactSalesUrl).toBe('mailto:hello@clearvo.io');
    expect(e.message).toBe(LIMIT_BODY.error);
  });

  it('any other 409 stays a ClearvoError', async () => {
    mockFetch(409, { error: 'duplicate', code: 'DUPLICATE_REGISTRATION' });
    const err = await client().addRegistration({ type: 'VAT', country: 'DE' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClearvoError);
    expect(err).not.toBeInstanceOf(ClearvoJurisdictionLimitError);
  });
});
