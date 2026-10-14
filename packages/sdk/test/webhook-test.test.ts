// ClearvoClient.testWebhook(): POST /v1/webhooks/test with the webhook id, optional event and invoice id.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';

describe('ClearvoClient.testWebhook', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts the input to /webhooks/test and returns the result', async () => {
    const result = { webhookId: 'wh_1', event: 'invoice.received', delivered: true, status: 200, durationMs: 31, subscribed: true, payload: { test: true } };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => result });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new ClearvoClient({ apiKey: 'csk_test_x', baseUrl: 'http://x/v1' });

    const out = await client.testWebhook({ webhookId: 'wh_1', event: 'invoice.received', invoiceId: 'EI-1' });

    expect(out).toEqual(result);
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('http://x/v1/webhooks/test');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ webhookId: 'wh_1', event: 'invoice.received', invoiceId: 'EI-1' });
  });
});
