// Coverage for `clearvo invoices attachments` and `clearvo invoices download-attachment`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createProgram } from '../src/program';

describe('clearvo invoices attachments', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CLEARVO_API_KEY;
  const originalBaseUrl = process.env.CLEARVO_BASE_URL;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let dir: string;

  beforeEach(() => {
    process.env.CLEARVO_API_KEY = 'csk_live_testkey';
    process.env.CLEARVO_BASE_URL = 'http://x/v1';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    dir = mkdtempSync(join(tmpdir(), 'clearvo-att-'));
  });
  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.CLEARVO_API_KEY; else process.env.CLEARVO_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.CLEARVO_BASE_URL; else process.env.CLEARVO_BASE_URL = originalBaseUrl;
    logSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists the attachments of an invoice', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, invoiceId: 'inv_1', attachments: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await createProgram().parseAsync(['node', 'clearvo', 'invoices', 'attachments', 'inv_1']);
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/invoices/inv_1/attachments');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });

  it('writes the downloaded bytes to --out', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-disposition': 'attachment; filename="x.pdf"' }), arrayBuffer: async () => bytes.buffer });
    global.fetch = fetchMock as unknown as typeof fetch;
    const out = join(dir, 'copy.pdf');
    await createProgram().parseAsync(['node', 'clearvo', 'invoices', 'download-attachment', 'inv_1', '0', '--out', out]);
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/invoices/inv_1/attachments/0');
    expect([...readFileSync(out)]).toEqual([0, 1, 2, 250, 255]);
  });
});
