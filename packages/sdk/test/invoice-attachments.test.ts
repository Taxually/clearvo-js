// Coverage for ClearvoClient.listInvoiceAttachments() and downloadInvoiceAttachment():
// GET /v1/invoices/{id}/attachments and /attachments/{index}.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';
import { ClearvoError } from '../src/types';

const LIST = {
  ok: true,
  invoiceId: 'inv_1',
  attachments: [
    { id: 'att-1', index: 0, fileName: 'timesheet.csv', mimeType: 'text/csv', sizeBytes: 12, sha256: 'ab', description: null, externalUrl: null, downloadable: true, downloadUrl: '/v1/invoices/inv_1/attachments/0', origin: 'sender' },
    { id: 'att-2', index: 1, fileName: null, mimeType: null, sizeBytes: null, sha256: null, description: 'Terms', externalUrl: 'https://example.com/t', downloadable: false, downloadUrl: null, origin: 'sender' },
  ],
};

describe('invoice attachments', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  const client = () => new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });

  it('lists attachments with the id URL-encoded', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => LIST });
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await client().listInvoiceAttachments('EI/1 2');
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/invoices/EI%2F1%202/attachments');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    expect(result.attachments[1].downloadable).toBe(false);
  });

  it('downloads the bytes with file name and mime type from the headers', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const headers = new Headers({ 'content-type': 'application/pdf; charset=binary', 'content-disposition': 'attachment; filename="a b.pdf"' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers, arrayBuffer: async () => bytes.buffer });
    global.fetch = fetchMock as unknown as typeof fetch;
    const file = await client().downloadInvoiceAttachment('inv_1', 0);
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/invoices/inv_1/attachments/0');
    expect(Buffer.isBuffer(file.data)).toBe(true);
    expect([...file.data]).toEqual([0, 1, 2, 250, 255]);
    expect(file.fileName).toBe('a b.pdf');
    expect(file.mimeType).toBe('application/pdf');
  });

  it('reads an RFC 5987 file name', async () => {
    const headers = new Headers({ 'content-type': 'text/csv', 'content-disposition': "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.csv" });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, headers, arrayBuffer: async () => new ArrayBuffer(1) }) as unknown as typeof fetch;
    expect((await client().downloadInvoiceAttachment('inv_1', 2)).fileName).toBe('résumé.csv');
  });

  it('surfaces a backend error code faithfully', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'No such attachment', code: 'ATTACHMENT_NOT_FOUND' }) }) as unknown as typeof fetch;
    const err = await client().downloadInvoiceAttachment('inv_1', 9).catch((e) => e);
    expect(err).toBeInstanceOf(ClearvoError);
    expect(err.status).toBe(404);
    expect(err.code).toBe('ATTACHMENT_NOT_FOUND');
  });
});
