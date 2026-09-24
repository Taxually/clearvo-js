// Coverage for ClearvoClient.updateBusinessStatus()/pollFrInbound() —
// PATCH /v1/invoices/{id}/business-status and POST /v1/fr/inbound/poll
// (code review 2026-09-22, fr-credentials-api: these two endpoints pre-dated
// set_fr_credentials/get_fr_credentials but never got MCP/SDK/CLI parity —
// closing the gap for the MCP-first, no-dashboard buyer-side partner
// persona, who needs to poll their inbox and respond to a received invoice).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';

describe('ClearvoClient.updateBusinessStatus', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('PATCHes /invoices/{id}/business-status with { status } and forwards entityId as the x-entity-id header, not in the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, businessStatus: 'APPROVED', updatedAt: '2026-09-22T00:00:00.000Z' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_acct_x', baseUrl: 'http://x/v1' });
    const result = await client.updateBusinessStatus({ id: 'inv-1', status: 'APPROVED', entityId: 'ent-1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/invoices/inv-1/business-status');
    expect(opts.method).toBe('PATCH');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({ status: 'APPROVED' });
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('entityId');
    expect(result.businessStatus).toBe('APPROVED');
  });

  it('URL-encodes the id path segment', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.updateBusinessStatus({ id: 'inv/with/slash', status: 'APPROVED' });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/invoices/inv%2Fwith%2Fslash/business-status');
  });

  it('forwards rejectionDetail through to the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.updateBusinessStatus({ id: 'inv-1', status: 'DISPUTED', rejectionDetail: { reason: 'wrong amount', message: 'total is off' } });

    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({ status: 'DISPUTED', rejectionDetail: { reason: 'wrong amount', message: 'total is off' } });
  });

  it('propagates a non-2xx response as a ClearvoError with the upstream message', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: 'FR_PLATFORM_ACTIVATION_PENDING' }),
    }) as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await expect(client.updateBusinessStatus({ id: 'inv-1', status: 'APPROVED' })).rejects.toThrow('FR_PLATFORM_ACTIVATION_PENDING');
  });
});

describe('ClearvoClient.pollFrInbound', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('POSTs an empty body to /fr/inbound/poll and forwards entityId as the x-entity-id header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, results: [{ entityId: 'ent-1', resolved: 1, newInvoices: 2, errors: [] }], totalNewInvoices: 2 }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_acct_x', baseUrl: 'http://x/v1' });
    const result = await client.pollFrInbound('ent-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/fr/inbound/poll');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    expect(JSON.parse(opts.body as string)).toEqual({});
    expect(result.totalNewInvoices).toBe(2);
  });

  it('omits the x-entity-id header when no entityId is passed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, results: [], totalNewInvoices: 0 }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.pollFrInbound();

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['x-entity-id']).toBeUndefined();
  });

  it('propagates a non-2xx response as a ClearvoError with the upstream message', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'France e-invoicing platform connection is not configured', code: 'FR_PLATFORM_NOT_CONFIGURED' }),
    }) as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await expect(client.pollFrInbound()).rejects.toThrow('France e-invoicing platform connection is not configured');
  });
});
