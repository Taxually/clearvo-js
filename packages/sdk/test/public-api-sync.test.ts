// Coverage for the public-API surface sync: customers, invoice actions, receiving,
// exemption certificates, obligations, settings and lookups. Each case asserts the exact
// method, path, headers and body the SDK sends against a mocked fetch, mirroring
// rules-engine.test.ts.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';

function mockFetch(body: unknown = { ok: true }, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => new TextEncoder().encode('xml').buffer,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/xml' : null) },
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const client = () => new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });

describe('ClearvoClient public API sync', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('customers', () => {
    it('listCustomers GETs /customers with search/page/limit and forwards x-entity-id', async () => {
      const f = mockFetch({ customers: [], total: 0, page: 2, limit: 10 });
      await client().listCustomers({ search: 'acme', page: 2, limit: 10, entityId: 'ent-1' });
      const [url, opts] = f.mock.calls[0];
      expect(url).toBe('http://x/v1/customers?search=acme&page=2&limit=10');
      expect(opts.method).toBe('GET');
      expect(opts.headers['x-entity-id']).toBe('ent-1');
    });

    it('createCustomer POSTs the body including typed references', async () => {
      const f = mockFetch({ customer: { id: 'c1' } }, 201);
      await client().createCustomer({ name: 'Acme', references: [{ type: 'LEITWEG_ID', value: '04011000-1234512345-06' }] });
      const [url, opts] = f.mock.calls[0];
      expect(url).toBe('http://x/v1/customers');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({ name: 'Acme', references: [{ type: 'LEITWEG_ID', value: '04011000-1234512345-06' }] });
    });

    it('updateCustomer PATCHes /customers/{id}; references null is sent as null (clears)', async () => {
      const f = mockFetch({ id: 'c1' });
      await client().updateCustomer('c1', { references: null });
      const [url, opts] = f.mock.calls[0];
      expect(url).toBe('http://x/v1/customers/c1');
      expect(opts.method).toBe('PATCH');
      expect(JSON.parse(opts.body)).toEqual({ references: null });
    });

    it('getCustomer, deleteCustomer and upsertCustomerByRef use the documented paths', async () => {
      const f = mockFetch({});
      await client().getCustomer('c 1');
      await client().deleteCustomer('c1');
      await client().upsertCustomerByRef('CRM/9', { name: 'Acme' });
      expect(f.mock.calls[0][0]).toBe('http://x/v1/customers/c%201');
      expect(f.mock.calls[1][0]).toBe('http://x/v1/customers/c1');
      expect(f.mock.calls[1][1].method).toBe('DELETE');
      expect(f.mock.calls[2][0]).toBe('http://x/v1/customers/by-ref/CRM%2F9');
      expect(f.mock.calls[2][1].method).toBe('PUT');
    });

    it('listCustomerReferenceTypes GETs /customer-reference-types with an optional country', async () => {
      const f = mockFetch({ types: [] });
      await client().listCustomerReferenceTypes({ country: 'DE' });
      await client().listCustomerReferenceTypes();
      expect(f.mock.calls[0][0]).toBe('http://x/v1/customer-reference-types?country=DE');
      expect(f.mock.calls[1][0]).toBe('http://x/v1/customer-reference-types');
    });
  });

  describe('invoice detail and actions', () => {
    it('getInvoice GETs /invoices/{id}', async () => {
      const f = mockFetch({ invoice: { id: 'i1' } });
      const result = await client().getInvoice('i1');
      expect(f.mock.calls[0][0]).toBe('http://x/v1/invoices/i1');
      expect(result.invoice.id).toBe('i1');
    });

    it('retryInvoice, deliverInvoice and resendInvoiceNotification POST to their action paths', async () => {
      const f = mockFetch({ ok: true });
      await client().retryInvoice('i1');
      await client().deliverInvoice('i1', { electronicAddress: { value: '991-33333TEST-33', schemeId: '0204' } });
      await client().resendInvoiceNotification('i1');
      expect(f.mock.calls[0][0]).toBe('http://x/v1/invoices/i1/retry');
      expect(f.mock.calls[1][0]).toBe('http://x/v1/invoices/i1/deliver');
      expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ electronicAddress: { value: '991-33333TEST-33', schemeId: '0204' } });
      expect(f.mock.calls[2][0]).toBe('http://x/v1/invoices/i1/resend-notification');
      for (const call of f.mock.calls) expect(call[1].method).toBe('POST');
    });

    it('resendInvoiceNotificationsBatch POSTs { ids }', async () => {
      const f = mockFetch({ results: [] });
      await client().resendInvoiceNotificationsBatch(['a', 'b']);
      expect(f.mock.calls[0][0]).toBe('http://x/v1/invoices/resend-notification/batch');
      expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ ids: ['a', 'b'] });
    });

    it('getInvoiceDocument GETs /documents/{id}?format= and returns the bytes and content type', async () => {
      const f = mockFetch('');
      const result = await client().getInvoiceDocument('i1', 'pdf');
      expect(f.mock.calls[0][0]).toBe('http://x/v1/documents/i1?format=pdf');
      expect(result.contentType).toBe('application/xml');
      expect(result.data.byteLength).toBe(3);
    });

    it('exportInvoices GETs /export with the given params and returns text', async () => {
      const f = mockFetch('a,b\n1,2');
      const text = await client().exportInvoices({ format: 'csv', from: '2026-01-01', limit: 50 });
      expect(f.mock.calls[0][0]).toBe('http://x/v1/export?format=csv&from=2026-01-01&limit=50');
      expect(text).toBe('a,b\n1,2');
    });
  });

  describe('receiving', () => {
    it('receiveInvoiceDocument POSTs /receive with fileBase64', async () => {
      const f = mockFetch({ ok: true, id: 'r1' });
      await client().receiveInvoiceDocument({ fileBase64: 'AAAA', fileName: 'inv.pdf' }, 'ent-1');
      const [url, opts] = f.mock.calls[0];
      expect(url).toBe('http://x/v1/receive');
      expect(opts.headers['x-entity-id']).toBe('ent-1');
      expect(JSON.parse(opts.body)).toEqual({ fileBase64: 'AAAA', fileName: 'inv.pdf' });
    });

    it('getInboundBatch and getInboundEmailAddress hit /receive/bulk/{id} and /de/inbound-address', async () => {
      const f = mockFetch({});
      await client().getInboundBatch('b1');
      await client().getInboundEmailAddress();
      expect(f.mock.calls[0][0]).toBe('http://x/v1/receive/bulk/b1');
      expect(f.mock.calls[1][0]).toBe('http://x/v1/de/inbound-address');
    });
  });

  describe('tax calculation extras', () => {
    it('refundTaxCalculation POSTs /tax/calculate/{id}/refund with amount and idempotencyKey', async () => {
      const f = mockFetch({ ok: true });
      await client().refundTaxCalculation('calc1', { amount: 5, idempotencyKey: 'k1' });
      const [url, opts] = f.mock.calls[0];
      expect(url).toBe('http://x/v1/tax/calculate/calc1/refund');
      expect(JSON.parse(opts.body)).toEqual({ amount: 5, idempotencyKey: 'k1' });
    });

    it('getTaxSettings / updateTaxSettings use GET and PATCH /tax/settings', async () => {
      const f = mockFetch({ ok: true, settings: {} });
      await client().getTaxSettings();
      await client().updateTaxSettings({ vatValidationMode: 'format' });
      expect(f.mock.calls[0][1].method).toBe('GET');
      expect(f.mock.calls[1][0]).toBe('http://x/v1/tax/settings');
      expect(f.mock.calls[1][1].method).toBe('PATCH');
      expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ vatValidationMode: 'format' });
    });

    it('listTaxJurisdictions, listTaxCategories, listValidations hit their paths', async () => {
      const f = mockFetch({});
      await client().listTaxJurisdictions();
      await client().listTaxCategories();
      await client().listValidations({ country: 'IT' });
      expect(f.mock.calls.map(c => c[0])).toEqual([
        'http://x/v1/tax/jurisdictions',
        'http://x/v1/tax/categories',
        'http://x/v1/validations?country=IT',
      ]);
    });

    it('restoreProduct POSTs the required reason; bulkClassifyProducts POSTs { products }', async () => {
      const f = mockFetch({ ok: true });
      await client().restoreProduct('p1', 'deleted by mistake');
      await client().bulkClassifyProducts({ products: [{ productCode: 'A', productName: 'Widget' }] });
      expect(f.mock.calls[0][0]).toBe('http://x/v1/tax/products/p1/restore');
      expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ reason: 'deleted by mistake' });
      expect(f.mock.calls[1][0]).toBe('http://x/v1/tax/products/bulk');
    });

    it('bulkUpsertClientTaxCodes POSTs { clientTaxCodes }; getClientTaxCodeAudit passes code/limit/cursor', async () => {
      const f = mockFetch({ ok: true, entries: [] });
      await client().bulkUpsertClientTaxCodes({ clientTaxCodes: [] });
      await client().getClientTaxCodeAudit({ code: 'A1', limit: 10, cursor: 'c' });
      expect(f.mock.calls[0][0]).toBe('http://x/v1/tax/client-codes/bulk');
      expect(f.mock.calls[1][0]).toBe('http://x/v1/tax/client-codes/audit?code=A1&limit=10&cursor=c');
    });
  });

  describe('exemption certificates', () => {
    it('CRUD uses /tax/exemptions paths and verbs', async () => {
      const f = mockFetch({});
      const c = client();
      await c.listExemptionCertificates({ status: 'ACTIVE', limit: 5 });
      await c.createExemptionCertificate({ certificateRef: 'R1', customerRef: 'C1', certificateType: 'RESALE', effectiveFrom: '2026-01-01' });
      await c.getExemptionCertificate('x1');
      await c.updateExemptionCertificate('x1', { status: 'REVOKED' });
      await c.deleteExemptionCertificate('x1');
      expect(f.mock.calls.map(call => `${call[1].method} ${call[0]}`)).toEqual([
        'GET http://x/v1/tax/exemptions?status=ACTIVE&limit=5',
        'POST http://x/v1/tax/exemptions',
        'GET http://x/v1/tax/exemptions/x1',
        'PATCH http://x/v1/tax/exemptions/x1',
        'DELETE http://x/v1/tax/exemptions/x1',
      ]);
    });

    it('uploadExemptionDocument sends multipart FormData with a document field and no JSON content type', async () => {
      const f = mockFetch({});
      await client().uploadExemptionDocument('x1', new Uint8Array([37, 80, 68, 70]));
      const [url, opts] = f.mock.calls[0];
      expect(url).toBe('http://x/v1/tax/exemptions/x1/document');
      expect(opts.body).toBeInstanceOf(FormData);
      expect((opts.body as FormData).get('document')).toBeInstanceOf(Blob);
      expect(opts.headers['Content-Type']).toBeUndefined();
    });
  });

  describe('obligations, account and lookups', () => {
    it('listTaxObligations / getTaxObligation / updateTaxObligation', async () => {
      const f = mockFetch({});
      const c = client();
      await c.listTaxObligations({ country: 'US', status: 'BREACH' });
      await c.getTaxObligation('o1');
      await c.updateTaxObligation('o1', { registrationStatus: 'REGISTERED' });
      expect(f.mock.calls.map(call => `${call[1].method} ${call[0]}`)).toEqual([
        'GET http://x/v1/tax/obligations?country=US&status=BREACH',
        'GET http://x/v1/tax/obligations/o1',
        'PATCH http://x/v1/tax/obligations/o1',
      ]);
    });

    it('getUsage, getSetupStatus, inviteTeamMember', async () => {
      const f = mockFetch({});
      const c = client();
      await c.getUsage();
      await c.getSetupStatus();
      await c.inviteTeamMember({ email: 'a@b.co', role: 'finance', entityIds: ['e1'] });
      expect(f.mock.calls[0][0]).toBe('http://x/v1/usage');
      expect(f.mock.calls[1][0]).toBe('http://x/v1/setup/status');
      expect(f.mock.calls[2][0]).toBe('http://x/v1/team/invites');
      expect(JSON.parse(f.mock.calls[2][1].body)).toEqual({ email: 'a@b.co', role: 'finance', entityIds: ['e1'] });
    });

    it('lookupCompany, lookupParticipant, listMandates, acknowledgeMandateObligation', async () => {
      const f = mockFetch({});
      const c = client();
      await c.lookupCompany({ country: 'PL', name: 'Acme', city: 'Warsaw' });
      await c.lookupParticipant({ taxId: 'DE123', country: 'DE', selfBilling: true });
      await c.listMandates({ id: 'IT-SDI' });
      await c.acknowledgeMandateObligation('ob1');
      expect(f.mock.calls.map(call => `${call[1].method} ${call[0]}`)).toEqual([
        'GET http://x/v1/lookup?country=PL&name=Acme&city=Warsaw',
        'GET http://x/v1/participants/lookup?taxId=DE123&country=DE&selfBilling=true',
        'GET http://x/v1/mandates?id=IT-SDI',
        'PATCH http://x/v1/mandates/obligations/ob1',
      ]);
      expect(JSON.parse(f.mock.calls[3][1].body)).toEqual({ acknowledged: true });
    });

    it('getRegistrationFieldDefinitions passes country/region/scheme', async () => {
      const f = mockFetch({});
      await client().getRegistrationFieldDefinitions({ country: 'US', region: 'CA' });
      expect(f.mock.calls[0][0]).toBe('http://x/v1/tax/registrations/field-definitions?country=US&region=CA');
    });
  });
});
