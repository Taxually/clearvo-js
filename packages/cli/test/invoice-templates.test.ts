// `clearvo invoice-templates ...` and `clearvo send --invoice-template`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createProgram } from '../src/program';

const originalFetch = global.fetch;
const dir = mkdtempSync(join(tmpdir(), 'cit-'));
const defFile = join(dir, 'definition.json');
const def = { schemaVersion: 1, background: { asset: 'letterhead' }, body: [{ kind: 'section', section: 'header' }] };
writeFileSync(defFile, JSON.stringify(def));

beforeEach(() => {
  process.env.CLEARVO_API_KEY = 'csk_live_testkey';
  process.env.CLEARVO_BASE_URL = 'http://x/v1';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

function mockFetch(body: unknown = {}) {
  const m = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  global.fetch = m as unknown as typeof fetch;
  return m;
}
const run = (args: string[]) => createProgram().parseAsync(args, { from: 'user' });
const runT = (args: string[]) => run(['invoice-templates', ...args]);
const call = (m: ReturnType<typeof mockFetch>) => ({ url: m.mock.calls[0][0] as string, init: m.mock.calls[0][1] });

describe('invoice-templates', () => {
  it('list and get', async () => {
    let m = mockFetch();
    await runT(['list', '--active', '--entity', 'ent_1']);
    expect(call(m).url).toBe('http://x/v1/invoice-templates?status=active');
    expect(call(m).init.headers['x-entity-id']).toBe('ent_1');
    m = mockFetch();
    await runT(['get', 'VW-STANDARD', '--template-version', '2']);
    expect(call(m).url).toBe('http://x/v1/invoice-templates/VW-STANDARD?version=2');
  });

  it('create reads the definition file and turns --asset into assetIds', async () => {
    const m = mockFetch();
    await runT(['create', '--key', 'VW', '--name', 'VW layout', '--definition-file', defFile, '--asset', 'letterhead=ab12.png', '--default']);
    expect(call(m).init.method).toBe('POST');
    expect(JSON.parse(call(m).init.body)).toEqual({ key: 'VW', name: 'VW layout', definition: def, assetIds: { letterhead: 'ab12.png' }, isDefault: true });
  });

  it('update sends only what was asked, including --no-default', async () => {
    let m = mockFetch();
    await runT(['update', 't1', '--archive']);
    expect(call(m).init.method).toBe('PATCH');
    expect(JSON.parse(call(m).init.body)).toEqual({ status: 'archived' });
    m = mockFetch();
    await runT(['update', 't1', '--no-default', '--name', 'New']);
    expect(JSON.parse(call(m).init.body)).toEqual({ name: 'New', isDefault: false });
    m = mockFetch();
    await runT(['update', 't1', '--default']);
    expect(JSON.parse(call(m).init.body)).toEqual({ isDefault: true });
  });

  it('definition PUTs a new version', async () => {
    const m = mockFetch();
    await runT(['definition', 'VW', '--definition-file', defFile, '--asset', 'letterhead=ab12.png']);
    expect(call(m).init.method).toBe('PUT');
    expect(call(m).url).toBe('http://x/v1/invoice-templates/VW/definition');
    expect(JSON.parse(call(m).init.body)).toEqual({ definition: def, assetIds: { letterhead: 'ab12.png' } });
  });

  it('upload-asset sends multipart with the image content type from the extension', async () => {
    const img = join(dir, 'letterhead.png');
    writeFileSync(img, Buffer.from([1, 2, 3]));
    const m = mockFetch({ assetId: 'a.png' });
    await runT(['upload-asset', img]);
    expect(call(m).url).toBe('http://x/v1/invoice-templates/assets');
    const file = (call(m).init.body as FormData).get('file') as File;
    expect(file.type).toBe('image/png');
    expect(file.name).toBe('letterhead.png');
    expect(call(m).init.headers['Content-Type']).toBeUndefined();
  });

  it('preview of a saved template writes the PDF', async () => {
    const out = join(dir, 'p.pdf');
    const m = mockFetch({ contentType: 'application/pdf', bytes: 3, pdfBase64: Buffer.from('%PD').toString('base64'), appended: [] });
    await runT(['preview', 'VW', '--template-version', '2', '--country', 'DE', '--out', out]);
    expect(call(m).init.method).toBe('GET');
    expect(call(m).url).toBe('http://x/v1/invoice-templates/VW/preview?format=base64&version=2&country=DE');
    expect(readFileSync(out).toString()).toBe('%PD');
  });

  it('preview of an unsaved definition POSTs it with its assets', async () => {
    const out = join(dir, 'q.pdf');
    const m = mockFetch({ contentType: 'application/pdf', bytes: 1, pdfBase64: 'AA==', appended: [] });
    await runT(['preview', '--definition-file', defFile, '--asset', 'letterhead=ab12.png', '--out', out]);
    expect(call(m).init.method).toBe('POST');
    expect(call(m).url).toBe('http://x/v1/invoice-templates/preview?format=base64');
    expect(JSON.parse(call(m).init.body)).toEqual({ definition: def, assetIds: { letterhead: 'ab12.png' } });
  });

  it('send --invoice-template sets invoiceTemplate on the body', async () => {
    const inv = join(dir, 'inv.json');
    writeFileSync(inv, JSON.stringify({ invoiceNumber: 'I-1', invoiceTemplate: 'OLD' }));
    const m = mockFetch({ outcome: 'ACCEPTED' });
    await run(['send', inv, '--invoice-template', 'VW']);
    expect(JSON.parse(call(m).init.body).invoiceTemplate).toBe('VW');
  });
});
