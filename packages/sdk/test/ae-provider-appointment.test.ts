// Coverage for ClearvoClient.getAeProviderAppointment() / requestAeProviderAppointment() —
// GET /v1/ae/provider-appointment and POST /v1/ae/provider-appointment/request. entityId travels as x-entity-id.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';

const appointment = {
  status: 'pending',
  providerName: 'Taxually',
  instructions: ['Wait for confirmation.'],
  requestedAt: '2026-11-24T10:00:00.000Z',
};

describe('UAE provider appointment', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch() {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => appointment });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it('getAeProviderAppointment GETs /ae/provider-appointment with x-entity-id', async () => {
    const fetchMock = mockFetch();
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const result = await client.getAeProviderAppointment('ent-1');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/ae/provider-appointment');
    expect(opts.method).toBe('GET');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    expect(result.status).toBe('pending');
    expect(result.providerName).toBe('Taxually');
  });

  it('omits x-entity-id when no entityId is given', async () => {
    const fetchMock = mockFetch();
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.getAeProviderAppointment();
    expect(fetchMock.mock.calls[0][1].headers['x-entity-id']).toBeUndefined();
  });

  it('requestAeProviderAppointment POSTs to /ae/provider-appointment/request with x-entity-id', async () => {
    const fetchMock = mockFetch();
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const result = await client.requestAeProviderAppointment('ent-1');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/ae/provider-appointment/request');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    expect(result.requestedAt).toBe('2026-11-24T10:00:00.000Z');
  });
});
