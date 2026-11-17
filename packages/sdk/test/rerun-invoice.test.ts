// Coverage for ClearvoClient.rerunInvoice(): POST /v1/invoices/{id}/rerun.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';
import { ClearvoError } from '../src/types';

describe('rerunInvoice', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  const client = () => new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });

  it('posts to the id-encoded path with an empty body by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, invoiceId: 'i', status: 'ACCEPTED', clearanceStatus: 'CLEARED', previousClearanceStatus: 'NEEDS_INFO', completed: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await client().rerunInvoice('EI/1 2');
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/invoices/EI%2F1%202/rerun');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({});
  });

  it('sends dryRun and the entity header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, wouldSubmit: { operation: 'rerun', invoiceId: 'i' }, currentClearanceStatus: 'NEEDS_INFO' }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await client().rerunInvoice('i', { dryRun: true }, 'ent_1');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ dryRun: true });
    expect(fetchMock.mock.calls[0][1].headers['x-entity-id']).toBe('ent_1');
  });

  it('throws ClearvoError on a 409 NOT_RERUNNABLE', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 409,
      json: async () => ({ ok: false, error: 'already sent', code: 'NOT_RERUNNABLE', message: 'already sent' }),
    }) as unknown as typeof fetch;
    await expect(client().rerunInvoice('i')).rejects.toBeInstanceOf(ClearvoError);
  });
});
