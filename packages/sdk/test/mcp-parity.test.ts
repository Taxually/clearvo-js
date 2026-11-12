// Coverage for the SDK twins of the hosted-MCP parity tools: URL, method, body and entity header of each.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function setup() {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
  global.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, c: new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' }) };
}

type Case = [string, (c: ClearvoClient) => Promise<unknown>, string, string, unknown?, string?];
const cases: Case[] = [
  ['listTaxCategories', (c) => c.listTaxCategories(), 'GET', '/tax/categories'],
  ['listTaxCategories deprecated', (c) => c.listTaxCategories({ includeDeprecated: true }), 'GET', '/tax/categories?include=deprecated'],
  ['getUsage', (c) => c.getUsage(), 'GET', '/usage'],
  ['removeEntityLogo', (c) => c.removeEntityLogo('e/1'), 'DELETE', '/entities/e%2F1/logo'],
  ['pollRoInbound', (c) => c.pollRoInbound('ent_1'), 'POST', '/ro/inbound/poll', {}, 'ent_1'],
  ['triggerBrPoll nfe', (c) => c.triggerBrPoll('ent_1'), 'POST', '/br/inbound/poll', {}, 'ent_1'],
  ['triggerBrPoll nfse', (c) => c.triggerBrPoll(undefined, 'nfse'), 'POST', '/br/nfse/inbound/poll', {}],
  ['receiveInvoiceDocument', (c) => c.receiveInvoiceDocument({ documentBase64: 'QQ==', fileName: 'a.pdf', contentType: 'application/pdf', country: 'DE', entityId: 'ent_1' }), 'POST', '/receive', { fileBase64: 'QQ==', fileName: 'a.pdf', contentType: 'application/pdf', country: 'DE' }, 'ent_1'],
  ['getInboundBatch', (c) => c.getInboundBatch('b/1', 'ent_1'), 'GET', '/receive/bulk/b%2F1', undefined, 'ent_1'],
  ['getInboundEmailAddress', (c) => c.getInboundEmailAddress(), 'GET', '/de/inbound-address'],
  ['getBulkUploadColumns', (c) => c.getBulkUploadColumns(), 'GET', '/send/bulk/columns'],
  ['listBulkUploadRows', (c) => c.listBulkUploadRows('b1', { outcome: 'error', page: 2, limit: 10, entityId: 'ent_1' }), 'GET', '/send/bulk/b1/rows?outcome=error&page=2&limit=10', undefined, 'ent_1'],
  ['confirmBulkUpload', (c) => c.confirmBulkUpload('b1', { snapshotVersion: 3, dryRun: true, entityId: 'ent_1' }), 'POST', '/send/bulk/b1/confirm', { snapshotVersion: 3, dryRun: true }, 'ent_1'],
  ['discardBulkUpload', (c) => c.discardBulkUpload('b1'), 'POST', '/send/bulk/b1/discard', {}],
  ['excludeBulkUploadRow', (c) => c.excludeBulkUploadRow('b1', 7), 'POST', '/send/bulk/b1/rows/7/exclude', {}],
  ['retryBulkUpload', (c) => c.retryBulkUpload('b1', { dryRun: true }), 'POST', '/send/bulk/b1/retry', { dryRun: true }],
  ['revokeInvoiceHostedPage', (c) => c.revokeInvoiceHostedPage('inv/1', 'ent_1'), 'DELETE', '/invoices/inv%2F1/hosted-page', undefined, 'ent_1'],
  ['updateRulePropertyDefinition', (c) => c.updateRulePropertyDefinition('p1', { label: 'L', deprecate: true }, 'ent_1'), 'PATCH', '/rules-engine/properties/p1', { label: 'L', deprecate: true }, 'ent_1'],
];

describe('MCP parity SDK methods', () => {
  it.each(cases)('%s', async (_n, call, method, path, body, entity) => {
    const { fetchMock, c } = setup();
    await call(c);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://x/v1${path}`);
    expect(init.method).toBe(method);
    if (body !== undefined) expect(JSON.parse(init.body)).toEqual(body);
    if (entity) expect(init.headers['x-entity-id']).toBe(entity);
  });

  it('uploadEntityLogo posts multipart with the file', async () => {
    const { fetchMock, c } = setup();
    await c.uploadEntityLogo('ent_1', { image: new Uint8Array([137, 80, 78, 71]), contentType: 'image/png' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/entities/ent_1/logo');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(Blob);
  });

  it('confirmReportingBatch and excludeFromReportingBatch accept the new optional fields', async () => {
    const { fetchMock, c } = setup();
    await c.confirmReportingBatch('r1', { snapshotVersion: 1, dryRun: true });
    await c.excludeFromReportingBatch('r1', { communicationId: 'c1' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ snapshotVersion: 1, dryRun: true });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ communicationId: 'c1' });
  });
});
