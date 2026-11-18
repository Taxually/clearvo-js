// Coverage for ClearvoClient.rerunInvoices(): POST /v1/invoices/rerun.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';
import { ClearvoError } from '../src/types';

describe('rerunInvoices', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  const client = () => new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
  const page = { ok: true, results: [{ invoiceId: 'a', invoiceNumber: 'INV-1', ok: true, outcome: 'rerun', status: 'ACCEPTED' }], summary: { requested: 1, rerun: 1, skipped: 0, failed: 0 }, done: true, nextCursor: null, remaining: 0 };

  it('posts ids to /invoices/rerun', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => page });
    global.fetch = fetchMock as unknown as typeof fetch;
    await client().rerunInvoices({ ids: ['a', 'b'] });
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/invoices/rerun');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ ids: ['a', 'b'] });
  });

  it('sends a filter, cursor, dryRun and the entity header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, wouldSubmit: { operation: 'rerun_bulk', matched: 3 }, matched: 3 }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await client().rerunInvoices({ filter: { status: 'WAITING_FOR_YOU', country: 'DE' }, cursor: 'k:x', dryRun: true }, 'ent_1');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ filter: { status: 'WAITING_FOR_YOU', country: 'DE' }, cursor: 'k:x', dryRun: true });
    expect(fetchMock.mock.calls[0][1].headers['x-entity-id']).toBe('ent_1');
  });

  it('throws ClearvoError on a 400', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Send either ids or filter' }) }) as unknown as typeof fetch;
    await expect(client().rerunInvoices({})).rejects.toBeInstanceOf(ClearvoError);
  });
});
