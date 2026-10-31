// Coverage for ClearvoClient.createFrPlatformConnectLink() — POST /v1/fr/platform-connect-link.
// The body carries returnUrl / loginHint / requestedCapability; entityId travels as the x-entity-id header,
// never in the body (same convention as setFrCredentials).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';

describe('ClearvoClient.createFrPlatformConnectLink', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('POSTs the link request to /fr/platform-connect-link with x-entity-id in the header, not the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, connectUrl: 'https://connect.example/start/abc' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const result = await client.createFrPlatformConnectLink({
      returnUrl: 'https://app.example.com/return',
      loginHint: 'director@customer.example',
      requestedCapability: 'receive',
      entityId: 'ent-1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/fr/platform-connect-link');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    expect(JSON.parse(opts.body as string)).toEqual({
      returnUrl: 'https://app.example.com/return',
      loginHint: 'director@customer.example',
      requestedCapability: 'receive',
    });
    expect(result.connectUrl).toBe('https://connect.example/start/abc');
  });

  it('omits the x-entity-id header when no entityId is passed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, connectUrl: 'https://connect.example/start/abc' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.createFrPlatformConnectLink({ returnUrl: 'https://app.example.com/return' });

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['x-entity-id']).toBeUndefined();
    expect(JSON.parse(opts.body as string)).toEqual({ returnUrl: 'https://app.example.com/return' });
  });

  it('propagates a non-2xx response as a ClearvoError carrying the upstream code', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ ok: false, error: { code: 'FR_TAX_NUMBER_REQUIRED', message: 'Register a valid French tax number before connecting' } }),
    }) as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await expect(client.createFrPlatformConnectLink({ returnUrl: 'https://app.example.com/return' })).rejects.toThrow(/FR_TAX_NUMBER_REQUIRED|French tax number/);
  });
});
