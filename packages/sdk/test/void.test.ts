// Coverage for the void methods: voidInvoice, voidInvoices, voidBulkUpload, voidReportingBatch.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';
import { ClearvoError } from '../src/types';

const VOIDED = { id: 'inv_1', result: 'voided', status: 'VOIDED', voidedAt: '2026-11-12T10:00:00Z', voidedBy: 'api_key:ci', voidReason: 'duplicate' };

describe('void', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  const client = () => new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
  const mockOk = (body: unknown) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  };

  it('voidInvoice posts the reason to the id-encoded path with the entity header', async () => {
    const fetchMock = mockOk({ ok: true, ...VOIDED });
    const out = await client().voidInvoice('inv/1 2', { reason: 'duplicate' }, 'ent_1');
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/invoices/inv%2F1%202/void');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ reason: 'duplicate' });
    expect(fetchMock.mock.calls[0][1].headers['x-entity-id']).toBe('ent_1');
    expect(out.status).toBe('VOIDED');
  });

  it('voidInvoice sends an empty body without a reason', async () => {
    const fetchMock = mockOk({ ok: true, ...VOIDED, result: 'already_voided' });
    await client().voidInvoice('inv_1');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({});
  });

  it('voidInvoice throws ClearvoError on 409 CANNOT_VOID_COMPLETED', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 409,
      json: async () => ({ ok: false, error: { code: 'CANNOT_VOID_COMPLETED', message: 'Already transmitted.' } }),
    }) as unknown as typeof fetch;
    await expect(client().voidInvoice('inv_1')).rejects.toBeInstanceOf(ClearvoError);
  });

  it('voidInvoices posts ids and reason to /invoices/void and returns per-item results', async () => {
    const body = { ok: true, voided: 1, alreadyVoided: 0, skipped: 1, items: [VOIDED, { id: 'inv_2', result: 'skipped', code: 'CANNOT_VOID_COMPLETED', reason: 'Already transmitted.' }] };
    const fetchMock = mockOk(body);
    const out = await client().voidInvoices({ ids: ['inv_1', 'inv_2'], reason: 'test' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/invoices/void');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ ids: ['inv_1', 'inv_2'], reason: 'test' });
    expect(out.skipped).toBe(1);
  });

  it('voidBulkUpload posts to /send/bulk/{batchId}/void', async () => {
    const fetchMock = mockOk({ ok: true, batchId: 'b/1', voided: 2, alreadyVoided: 0, skipped: 0, items: [], discardedInvoices: 2 });
    const out = await client().voidBulkUpload('b/1', { reason: 'wrong file' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/send/bulk/b%2F1/void');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ reason: 'wrong file' });
    expect(out.discardedInvoices).toBe(2);
  });

  it('voidReportingBatch posts to /reporting-batches/{id}/void', async () => {
    const fetchMock = mockOk({ ok: true, batchId: 'rb_1', voided: 3, alreadyVoided: 0, skipped: 0, items: [] });
    await client().voidReportingBatch('rb_1', {}, 'ent_2');
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/reporting-batches/rb_1/void');
    expect(fetchMock.mock.calls[0][1].headers['x-entity-id']).toBe('ent_2');
  });
});
