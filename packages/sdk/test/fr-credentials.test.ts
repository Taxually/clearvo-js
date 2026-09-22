// Coverage for ClearvoClient.setFrCredentials()/getFrCredentials() —
// POST/GET /v1/fr/credentials (docs/features/fr-credentials-api). No secret
// is stored on this endpoint; the SDK methods must post {taxNumber} and
// forward entityId as the x-entity-id header, never in the body — same
// convention as every other set*Credentials call (see client.ts's suppliers/
// client-tax-codes methods for the pattern these mirror).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';

describe('ClearvoClient France platform credentials', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('setFrCredentials POSTs {taxNumber} to /fr/credentials with x-entity-id, not in the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, entityId: 'ent-1', taxNumber: 'FR34501692511', credentialStatus: 'pending_activation' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const result = await client.setFrCredentials({ taxNumber: 'FR34501692511', entityId: 'ent-1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/fr/credentials');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    expect(opts.headers['x-api-key']).toBe('csk_live_x');
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({ taxNumber: 'FR34501692511' });
    expect(body).not.toHaveProperty('entityId');
    expect(result.credentialStatus).toBe('pending_activation');
  });

  it('setFrCredentials omits the x-entity-id header when entityId is not supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, entityId: 'ent-1', taxNumber: 'FR34501692511', credentialStatus: 'sandbox' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_test_x', baseUrl: 'http://x/v1' });
    await client.setFrCredentials({ taxNumber: 'FR34501692511' });

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['x-entity-id']).toBeUndefined();
  });

  it('getFrCredentials issues a GET to /fr/credentials, forwarding entityId as the x-entity-id header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, entityId: 'ent-1', taxNumber: null, credentialStatus: 'not_registered' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const result = await client.getFrCredentials('ent-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/fr/credentials');
    expect(opts.method).toBe('GET');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    expect(opts.body).toBeUndefined();
    expect(result.credentialStatus).toBe('not_registered');
  });

  it('getFrCredentials omits the x-entity-id header when no entityId is passed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, entityId: 'ent-1', taxNumber: null, credentialStatus: 'not_registered' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.getFrCredentials();

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['x-entity-id']).toBeUndefined();
  });

  it('setFrCredentials propagates a non-2xx response as a ClearvoError with the upstream message', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'INVALID_FORMAT', hint: 'bad tax number' }),
    }) as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await expect(client.setFrCredentials({ taxNumber: 'not-a-vat-number' })).rejects.toThrow('INVALID_FORMAT');
  });
});
