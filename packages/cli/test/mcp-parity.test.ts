// CLI twins of the hosted-MCP parity tools: URL, method, body and entity header of each command.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createProgram } from '../src/program';

const originalFetch = global.fetch;
const originalApiKey = process.env.CLEARVO_API_KEY;
const originalBaseUrl = process.env.CLEARVO_BASE_URL;

beforeEach(() => {
  process.env.CLEARVO_API_KEY = 'csk_live_testkey';
  process.env.CLEARVO_BASE_URL = 'http://x/v1';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  global.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.CLEARVO_API_KEY; else process.env.CLEARVO_API_KEY = originalApiKey;
  if (originalBaseUrl === undefined) delete process.env.CLEARVO_BASE_URL; else process.env.CLEARVO_BASE_URL = originalBaseUrl;
  vi.restoreAllMocks();
});

const cases: Array<[string[], string, string, unknown?]> = [
  [['usage'], 'GET', '/usage'],
  [['tax-categories', '--include-deprecated'], 'GET', '/tax/categories?include=deprecated'],
  [['entities', 'logo', 'remove', 'e1'], 'DELETE', '/entities/e1/logo'],
  [['ro', 'poll', '--entity', 'ent_1'], 'POST', '/ro/inbound/poll', {}],
  [['br', 'inbound', 'poll', '--document-family', 'nfse'], 'POST', '/br/nfse/inbound/poll', {}],
  [['br', 'inbound', 'poll'], 'POST', '/br/inbound/poll', {}],
  [['receive', 'batch', 'b1'], 'GET', '/receive/bulk/b1'],
  [['receive', 'inbound-address'], 'GET', '/de/inbound-address'],
  [['bulk-upload-columns'], 'GET', '/send/bulk/columns'],
  [['bulk-upload-rows', 'b1', '--outcome', 'error', '--page', '2'], 'GET', '/send/bulk/b1/rows?outcome=error&page=2'],
  [['bulk-upload-confirm', 'b1', '--snapshot-version', '3', '--dry-run'], 'POST', '/send/bulk/b1/confirm', { snapshotVersion: 3, dryRun: true }],
  [['bulk-upload-discard', 'b1'], 'POST', '/send/bulk/b1/discard', {}],
  [['bulk-upload-exclude-row', 'b1', '7'], 'POST', '/send/bulk/b1/rows/7/exclude', {}],
  [['bulk-upload-retry', 'b1', '--dry-run'], 'POST', '/send/bulk/b1/retry', { dryRun: true }],
  [['invoices', 'revoke-hosted-page', 'inv1'], 'DELETE', '/invoices/inv1/hosted-page'],
  [['reporting-batches', 'confirm', 'r1', '--snapshot-version', '2'], 'POST', '/reporting-batches/r1/confirm', { snapshotVersion: 2 }],
  [['reporting-batches', 'exclude', 'r1', '--communication-id', 'c1', '--reason', 'x'], 'POST', '/reporting-batches/r1/exclude', { communicationId: 'c1', reason: 'x' }],
  [['rules', 'properties', 'update', 'p1', '--label', 'L', '--deprecate', 'true'], 'PATCH', '/rules-engine/properties/p1', { label: 'L', deprecate: true }],
];

describe('MCP parity CLI commands', () => {
  it.each(cases)('%j', async (argv, method, path, body) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await createProgram().parseAsync(argv, { from: 'user' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://x/v1${path}`);
    expect(init.method).toBe(method);
    if (body !== undefined) expect(JSON.parse(init.body)).toEqual(body);
  });

  it('receive document base64-encodes the file', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const file = join(mkdtempSync(join(tmpdir(), 'clearvo-cli-')), 'inv.xml');
    writeFileSync(file, 'A');
    await createProgram().parseAsync(['receive', 'document', file, '--country', 'de'], { from: 'user' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ fileBase64: 'QQ==', fileName: 'inv.xml', contentType: 'application/xml', country: 'DE' });
  });

  it('entities logo upload sends multipart', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const file = join(mkdtempSync(join(tmpdir(), 'clearvo-cli-')), 'logo.png');
    writeFileSync(file, Buffer.from([137, 80, 78, 71]));
    await createProgram().parseAsync(['entities', 'logo', 'upload', 'e1', file], { from: 'user' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/entities/e1/logo');
    expect(fetchMock.mock.calls[0][1].body).toBeInstanceOf(FormData);
  });
});
