// Coverage for ClearvoClient.getUsage() (GET /v1/usage) and the free-plan 402 contract on calculateTax():
// a committed calculation on a free plan throws ClearvoPlanRequiredError, never a generic ClearvoError.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';
import { ClearvoError, ClearvoPlanRequiredError, ClearvoPlanNotIncludedError } from '../src/types';
import type { GetUsageResponse } from '../src/types';

describe('ClearvoClient.getUsage', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const usage: GetUsageResponse = {
    usage: {
      plan: 'starter',
      billingStatus: 'active',
      period: { start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' },
      used: 120,
      included: 500,
      remaining: 380,
      percentUsed: 24,
      overageUsd: 0.12,
      overage: 0,
      inTrial: false,
      updatedAt: '2026-10-04T09:00:00.000Z',
    },
  };

  it('GETs /usage and returns the usage summary unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => usage });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const result = await client.getUsage();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/usage');
    expect(opts.method).toBe('GET');
    expect(opts.body).toBeUndefined();
    expect(result).toEqual(usage);
  });
});

describe('ClearvoClient.calculateTax on a free plan', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const input = {
    currency: 'EUR',
    customer: { billingAddress: { country: 'FR' } },
    lineItems: [{ id: 'l1', amount: 100, productName: 'Widget' }],
  };

  it('throws ClearvoPlanRequiredError carrying calculationId, monitorOnly and upgradeUrl on a 402 plan_required', async () => {
    const body = {
      error: 'plan_required',
      calculationId: 'calc_123',
      monitorOnly: true,
      message: 'Your current plan records this transaction for Compliance Radar but does not include tax calculation results.',
      upgradeUrl: 'https://app.clearvo.io/settings/billing',
    };
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 402, json: async () => body }) as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const err = await client.calculateTax(input).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ClearvoPlanRequiredError);
    expect(err).toBeInstanceOf(ClearvoError);
    const e = err as ClearvoPlanRequiredError;
    expect(e.status).toBe(402);
    expect(e.message).toBe(`${body.message} Upgrade: ${body.upgradeUrl}`);
    expect(e.calculationId).toBe('calc_123');
    expect(e.monitorOnly).toBe(true);
    expect(e.reason).toBeUndefined();
    expect(e.upgradeUrl).toBe('https://app.clearvo.io/settings/billing');
    expect(e.hint).toBe(body.message);
  });

  it('exposes reason custom_api_requires_growth on a committed 402', async () => {
    const body = {
      error: 'plan_required',
      reason: 'custom_api_requires_growth',
      calculationId: 'calc_9',
      monitorOnly: true,
      message: 'Calculations from your own API key need Growth.',
      upgradeUrl: 'https://app.clearvo.io/settings/billing',
    };
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 402, json: async () => body }) as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const e = (await client.calculateTax(input).catch((x: unknown) => x)) as ClearvoPlanRequiredError;

    expect(e).toBeInstanceOf(ClearvoPlanRequiredError);
    expect(e.reason).toBe('custom_api_requires_growth');
    expect(e.calculationId).toBe('calc_9');
    expect(e.monitorOnly).toBe(true);
    expect(e.message).toContain(body.message);
    expect(e.message).toContain(body.upgradeUrl);
  });

  it('maps a commit=false preview 402 to calculationId null and monitorOnly false', async () => {
    const body = {
      error: 'plan_required',
      reason: 'custom_api_requires_growth',
      calculationId: null,
      monitorOnly: false,
      message: 'Calculations from your own API key need Growth.',
      upgradeUrl: 'https://app.clearvo.io/settings/billing',
    };
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 402, json: async () => body }) as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const e = (await client.calculateTax({ ...input, commit: false }).catch((x: unknown) => x)) as ClearvoPlanRequiredError;

    expect(e).toBeInstanceOf(ClearvoPlanRequiredError);
    expect(e.calculationId).toBeNull();
    expect(e.monitorOnly).toBe(false);
    expect(e.reason).toBe('custom_api_requires_growth');
  });

  it('leaves any other 402 as a generic ClearvoError', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 402, json: async () => ({ error: 'payment_failed' }) }) as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const err = await client.calculateTax(input).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ClearvoError);
    expect(err).not.toBeInstanceOf(ClearvoPlanRequiredError);
    expect((err as ClearvoError).message).toBe('payment_failed');
  });
});

describe('ClearvoClient plan-not-included 403', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it.each([
    ['explore_not_included', 'explore'],
    ['rules_not_included', 'rules'],
  ] as const)('throws ClearvoPlanNotIncludedError for a 403 %s', async (code, feature) => {
    const body = { error: code, message: 'Your plan does not include this feature.', upgradeUrl: 'https://app.clearvo.io/settings/billing' };
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => body }) as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const err = await client.getUsage().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ClearvoPlanNotIncludedError);
    expect(err).toBeInstanceOf(ClearvoError);
    const e = err as ClearvoPlanNotIncludedError;
    expect(e.status).toBe(403);
    expect(e.message).toBe(code);
    expect(e.feature).toBe(feature);
    expect(e.upgradeUrl).toBe(body.upgradeUrl);
    expect(e.hint).toBe(body.message);
  });

  it('leaves any other 403 as a generic ClearvoError', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) }) as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const err = await client.getUsage().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ClearvoError);
    expect(err).not.toBeInstanceOf(ClearvoPlanNotIncludedError);
  });
});
