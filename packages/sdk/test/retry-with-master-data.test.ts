// Coverage for ClearvoClient.retryInvoiceWithMasterData(): POST /v1/invoices/{id}/retry-with-master-data.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';
import { ClearvoError } from '../src/types';

const OK = {
  ok: true, invoiceId: 'inv_new', previousInvoiceId: 'inv_old', status: 'ACCEPTED', clearanceStatus: 'CLEARED',
  changes: [{ field: 'customer.taxId', before: 'DE1', after: 'DE123456789' }], completed: true,
};

describe('retryInvoiceWithMasterData', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  const client = () => new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });

  it('posts to the id-encoded path with an empty body by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => OK });
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await client().retryInvoiceWithMasterData('EI/1 2');
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/invoices/EI%2F1%202/retry-with-master-data');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({});
    expect((result as typeof OK).previousInvoiceId).toBe('inv_old');
  });

  it('sends dryRun and the entity header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, wouldSubmit: { operation: 'use_master_data', invoiceId: 'i' }, changes: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await client().retryInvoiceWithMasterData('i', { dryRun: true }, 'ent_1');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ dryRun: true });
    expect(fetchMock.mock.calls[0][1].headers['x-entity-id']).toBe('ent_1');
  });

  it('throws ClearvoError on a 422 MASTER_TAX_ID_UNCHANGED', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 422,
      json: async () => ({ ok: false, error: 'same', code: 'MASTER_TAX_ID_UNCHANGED', message: 'same' }),
    }) as unknown as typeof fetch;
    await expect(client().retryInvoiceWithMasterData('i')).rejects.toBeInstanceOf(ClearvoError);
  });
});
