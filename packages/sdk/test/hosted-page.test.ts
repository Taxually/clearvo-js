// Coverage for ClearvoClient.revokeHostedPage() — DELETE /v1/invoices/{id}/hosted-page.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';
import type { InvoiceRecordTimestamps } from '../src/index';

describe('ClearvoClient.revokeHostedPage', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('DELETEs /invoices/{id}/hosted-page, url-encodes the id and forwards entityId as the x-entity-id header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ revoked: 2 }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new ClearvoClient({ apiKey: 'csk_live_acct_x', baseUrl: 'http://x/v1' });
    const result = await client.revokeHostedPage('inv/1', 'ent-1');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/invoices/inv%2F1/hosted-page');
    expect(opts.method).toBe('DELETE');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    expect(result.revoked).toBe(2);
  });

  it('sends no x-entity-id header when none is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ revoked: 0 }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.revokeHostedPage('inv-1');
    expect(fetchMock.mock.calls[0][1].headers['x-entity-id']).toBeUndefined();
  });

  it('types the hostedPage block on an invoice row', () => {
    const row: InvoiceRecordTimestamps = {
      submittedAt: null,
      ingestedAt: null,
      hostedPage: { sentToCustomer: true, sentAt: '2026-11-06T00:00:00.000Z', url: null, expiresAt: null },
    };
    expect(row.hostedPage?.url).toBeNull();
  });
});
