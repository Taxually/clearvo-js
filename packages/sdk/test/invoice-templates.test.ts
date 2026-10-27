// Invoice templates: list/get/create/update/definition/asset upload/preview, and the invoiceTemplate field on send.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';
import { ClearvoError } from '../src/types';
import type { InvoiceTemplateDefinition } from '../src/types';

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function mock(body: unknown, status = 200) {
  const m = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  global.fetch = m as unknown as typeof fetch;
  return m;
}
const client = () => new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
const url = (m: ReturnType<typeof mock>) => m.mock.calls[0][0] as string;
const init = (m: ReturnType<typeof mock>) => m.mock.calls[0][1];
const def: InvoiceTemplateDefinition = {
  schemaVersion: 1,
  fontFamily: 'Roboto',
  background: { asset: 'letterhead', pages: 'first', fit: 'page' },
  body: [{ kind: 'section', section: 'header' }, { kind: 'system', name: 'verification_qr' }],
};

describe('invoice templates', () => {
  it('listInvoiceTemplates hits GET /invoice-templates, with status=active and an entity header when asked', async () => {
    let m = mock({ templates: [], sampleDocumentTypes: ['invoice'], sampleScenarios: ['standard'] });
    await client().listInvoiceTemplates();
    expect(url(m)).toBe('http://x/v1/invoice-templates');
    expect(init(m).method).toBe('GET');
    m = mock({ templates: [], sampleDocumentTypes: [], sampleScenarios: [] });
    await client().listInvoiceTemplates({ status: 'active', entityId: 'ent_1' });
    expect(url(m)).toBe('http://x/v1/invoice-templates?status=active');
    expect(init(m).headers['x-entity-id']).toBe('ent_1');
  });

  it('getInvoiceTemplate encodes the key and passes the version', async () => {
    const m = mock({ template: {}, version: {}, versions: [] });
    await client().getInvoiceTemplate('VW STANDARD', { version: 2 });
    expect(url(m)).toBe('http://x/v1/invoice-templates/VW%20STANDARD?version=2');
  });

  it('createInvoiceTemplate posts the body without entityId and returns the envelope', async () => {
    const m = mock({ template: { id: 't1', key: 'VW' }, version: { version: 1 }, findings: [] }, 201);
    const out = await client().createInvoiceTemplate({ key: 'VW', name: 'VW', definition: def, assetIds: { letterhead: 'abc.png' }, isDefault: true, entityId: 'ent_1' });
    expect(init(m).method).toBe('POST');
    expect(JSON.parse(init(m).body)).toEqual({ key: 'VW', name: 'VW', definition: def, assetIds: { letterhead: 'abc.png' }, isDefault: true });
    expect(init(m).headers['x-entity-id']).toBe('ent_1');
    expect(out.template.key).toBe('VW');
  });

  it('updateInvoiceTemplate PATCHes and updateInvoiceTemplateDefinition PUTs', async () => {
    let m = mock({ template: {} });
    await client().updateInvoiceTemplate('t1', { status: 'archived' });
    expect(init(m).method).toBe('PATCH');
    expect(url(m)).toBe('http://x/v1/invoice-templates/t1');
    expect(JSON.parse(init(m).body)).toEqual({ status: 'archived' });
    m = mock({ template: {}, version: {}, findings: [] });
    await client().updateInvoiceTemplateDefinition('t1', { definition: def, assetIds: ['a.png'] });
    expect(init(m).method).toBe('PUT');
    expect(url(m)).toBe('http://x/v1/invoice-templates/t1/definition');
    expect(JSON.parse(init(m).body)).toEqual({ definition: def, assetIds: ['a.png'] });
  });

  it('an invalid definition surfaces as a ClearvoError', async () => {
    mock({ error: 'The template did not pass validation. Nothing was saved.', code: 'invoice_template_invalid', findings: [] }, 422);
    await expect(client().createInvoiceTemplate({ key: 'K', name: 'N', definition: def })).rejects.toBeInstanceOf(ClearvoError);
  });

  it('uploadInvoiceTemplateAsset sends multipart with a file part and no JSON content type', async () => {
    const m = mock({ assetId: 'a.png', sha256: 'a', contentType: 'image/png', bytes: 3, width: 20, height: 20 }, 201);
    const out = await client().uploadInvoiceTemplateAsset({ file: new Uint8Array([1, 2, 3]), contentType: 'image/png', entityId: 'ent_1' });
    expect(url(m)).toBe('http://x/v1/invoice-templates/assets');
    expect(init(m).method).toBe('POST');
    expect(init(m).body).toBeInstanceOf(FormData);
    const file = (init(m).body as FormData).get('file') as File;
    expect(file.type).toBe('image/png');
    expect(file.name).toBe('template-image.png');
    expect(init(m).headers['Content-Type']).toBeUndefined();
    expect(out.assetId).toBe('a.png');
  });

  it('previewInvoiceTemplate: saved template is a GET, unsaved definition is a POST, both ask for base64', async () => {
    let m = mock({ contentType: 'application/pdf', bytes: 1, pdfBase64: 'AA==', appended: [] });
    await client().previewInvoiceTemplate({ templateId: 'VW', version: 2, country: 'DE', documentType: 'credit_note', scenario: 'exempt' });
    expect(init(m).method).toBe('GET');
    expect(url(m)).toBe('http://x/v1/invoice-templates/VW/preview?format=base64&country=DE&documentType=credit_note&scenario=exempt&version=2');
    m = mock({ contentType: 'application/pdf', bytes: 1, pdfBase64: 'AA==', appended: ['verification_qr'] });
    const out = await client().previewInvoiceTemplate({ definition: def, assetIds: { letterhead: 'a.png' } });
    expect(init(m).method).toBe('POST');
    expect(url(m)).toBe('http://x/v1/invoice-templates/preview?format=base64');
    expect(JSON.parse(init(m).body)).toEqual({ definition: def, assetIds: { letterhead: 'a.png' } });
    expect(out.appended).toEqual(['verification_qr']);
  });

  it('submitInvoice sends invoiceTemplate and the result echoes it', async () => {
    const m = mock({ referenceId: 'r1', invoiceTemplate: { key: 'VW', name: 'VW', version: 1, source: 'request' } });
    const out = await client().submitInvoice({ invoiceNumber: 'I-1', issueDate: '2026-10-01', currency: 'EUR', invoiceTemplate: 'VW' } as never);
    expect(JSON.parse(init(m).body).invoiceTemplate).toBe('VW');
    expect(out.invoiceTemplate).toEqual({ key: 'VW', name: 'VW', version: 1, source: 'request' });
  });
});
