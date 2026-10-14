// ClearvoClient.simulateReceivedInvoices(): POST /v1/receive/simulate; entityId goes in the x-entity-id header, not the body.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';

describe('ClearvoClient.simulateReceivedInvoices', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts the input and sends entityId as a header', async () => {
    const result = { ok: true, sandbox: true, created: [{ id: 'EI-1' }], duplicates: [], webhooks: { event: 'invoice.received', subscribedEndpoints: 1 }, notes: [] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => result });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new ClearvoClient({ apiKey: 'csk_test_x', baseUrl: 'http://x/v1' });

    const out = await client.simulateReceivedInvoices({ country: 'FR', type: 'credit_note', count: 2, entityId: 'ent_1' });

    expect(out).toEqual(result);
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string; headers: Record<string, string> }];
    expect(url).toBe('http://x/v1/receive/simulate');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ country: 'FR', type: 'credit_note', count: 2 });
    expect(init.headers['x-entity-id']).toBe('ent_1');
  });

  it('works with no input', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new ClearvoClient({ apiKey: 'csk_test_x', baseUrl: 'http://x/v1' });
    await client.simulateReceivedInvoices();
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({});
  });
});
