// Coverage for ClearvoClient.fixInvoice(): POST /v1/invoices/{id}/fix.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';
import { ClearvoError } from '../src/types';

describe('fixInvoice', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  const client = () => new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });

  it('posts the fields to the encoded id URL and returns the result', async () => {
    const body = { ok: true, mode: 'updated_in_place', invoiceId: 'inv_1', status: 'PENDING', clearanceStatus: 'PENDING', changes: [{ field: 'customer.address.country', mode: 'supply', newValue: 'DE' }] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await client().fixInvoice({ id: 'EI/1 2', fields: { 'customer.address.country': 'DE' }, entityId: 'ent_1' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/invoices/EI%2F1%202/fix');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ fields: { 'customer.address.country': 'DE' } });
    expect(fetchMock.mock.calls[0][1].headers['x-entity-id']).toBe('ent_1');
    expect(result.mode).toBe('updated_in_place');
  });

  it('sends dryRun and confirmationToken in the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'inv_1', wouldSubmit: { mode: 'updated_in_place', changes: [] } }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = await client().fixInvoice({ id: 'inv_1', fields: { a: 1 }, dryRun: true, confirmationToken: 'tok' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ fields: { a: 1 }, dryRun: true, confirmationToken: 'tok' });
    expect(r.wouldSubmit.mode).toBe('updated_in_place');
  });

  it('surfaces a backend error code', async () => {
    const err = { ok: false, error: { code: 'SOURCE_LOCKED', message: 'Fix it in the source system', retryable: false } };
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => err, text: async () => JSON.stringify(err) }) as unknown as typeof fetch;
    await expect(client().fixInvoice({ id: 'inv_1', fields: { a: 1 } })).rejects.toMatchObject({ code: 'SOURCE_LOCKED', status: 409 });
    await expect(client().fixInvoice({ id: 'inv_1', fields: { a: 1 } })).rejects.toBeInstanceOf(ClearvoError);
  });
});
