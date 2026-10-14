// Filings: setups, the return lifecycle and the data upload under /v1/filings/*.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';
import { ClearvoError } from '../src/types';

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function mock(body: unknown = { ok: true }, init: { status?: number; contentType?: string; text?: string; bytes?: Uint8Array } = {}) {
  const status = init.status ?? 200;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? init.contentType ?? 'application/json' : null) },
    json: async () => body,
    text: async () => init.text ?? '',
    arrayBuffer: async () => (init.bytes ?? new Uint8Array([1, 2, 3])).buffer,
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}
const client = () => new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
const call = (m: ReturnType<typeof mock>) => ({ url: m.mock.calls[0][0] as string, init: m.mock.calls[0][1] as RequestInit & { headers: Record<string, string> } });

describe('setups', () => {
  it('lists setups and reads/updates one registration', async () => {
    let m = mock();
    await client().listFilingSetups();
    expect(call(m).url).toBe('http://x/v1/filings/setups');
    expect(call(m).init.method).toBe('GET');

    m = mock();
    await client().getRegistrationFilingSetup('reg 1', 'ent-1');
    expect(call(m).url).toBe('http://x/v1/tax/registrations/reg%201/filing');
    expect(call(m).init.headers['x-entity-id']).toBe('ent-1');

    m = mock();
    await client().updateRegistrationFilingSetup('reg-1', { frequencyCode: 'Monthly', frequencyAttested: true, startChoice: 'asap' });
    expect(call(m).init.method).toBe('PUT');
    expect(JSON.parse(call(m).init.body as string)).toEqual({ frequencyCode: 'Monthly', frequencyAttested: true, startChoice: 'asap' });
    expect(call(m).init.headers['x-entity-id']).toBeUndefined();
  });

  it('reads the bank account', async () => {
    const m = mock();
    await client().getFilingBankAccount();
    expect(call(m).url).toBe('http://x/v1/filings/bank-account');
  });
});

describe('returns lifecycle', () => {
  it('lists filings with only the given filters and sends entityId as a header', async () => {
    const m = mock();
    await client().listFilings({ view: 'upcoming', limit: 10, entityId: 'ent-1' });
    expect(call(m).url).toBe('http://x/v1/filings?view=upcoming&limit=10');
    expect(call(m).init.headers['x-entity-id']).toBe('ent-1');
    const m2 = mock();
    await client().listFilings();
    expect(call(m2).url).toBe('http://x/v1/filings');
  });

  it('gets a filing', async () => {
    const m = mock();
    await client().getFiling('fil_1');
    expect(call(m).url).toBe('http://x/v1/filings/fil_1');
  });

  it.each([
    ['approveFiling', 'approve'],
    ['undoFilingApproval', 'undo'],
    ['pauseFiling', 'pause'],
    ['resumeFiling', 'resume'],
  ] as const)('%s POSTs snapshotVersion to /%s', async (method, path) => {
    const m = mock();
    await client()[method]('fil_1', 3);
    expect(call(m).url).toBe(`http://x/v1/filings/fil_1/${path}`);
    expect(call(m).init.method).toBe('POST');
    expect(JSON.parse(call(m).init.body as string)).toEqual({ snapshotVersion: 3 });
  });

  it('skips, records a prepayment and handles change requests', async () => {
    let m = mock();
    await client().skipFiling('fil_1', { snapshotVersion: 2, reason: 'Closed the business' });
    expect(call(m).url).toBe('http://x/v1/filings/fil_1/skip');
    expect(JSON.parse(call(m).init.body as string)).toEqual({ snapshotVersion: 2, reason: 'Closed the business' });

    m = mock();
    await client().setFilingPrepayment('fil_1', { snapshotVersion: 2, amount: 10 });
    expect(call(m).url).toBe('http://x/v1/filings/fil_1/prepayment');

    m = mock();
    await client().listFilingChangeRequests('fil_1');
    expect(call(m).url).toBe('http://x/v1/filings/fil_1/change-requests');
    expect(call(m).init.method).toBe('GET');

    m = mock();
    await client().requestFilingChange('fil_1', 'Please correct the county');
    expect(call(m).init.method).toBe('POST');
    expect(JSON.parse(call(m).init.body as string)).toEqual({ message: 'Please correct the county' });
  });

  it('downloads the CSVs as text and the proof as bytes', async () => {
    let m = mock(undefined, { text: 'a,b\nTOTAL,1', contentType: 'text/csv' });
    expect(await client().getFilingSummaryCsv('fil_1')).toBe('a,b\nTOTAL,1');
    expect(call(m).url).toBe('http://x/v1/filings/fil_1/csv');
    m = mock(undefined, { text: 'x', contentType: 'text/csv' });
    await client().getFilingTransactionsCsv('fil_1');
    expect(call(m).url).toBe('http://x/v1/filings/fil_1/transactions.csv');
    m = mock(undefined, { contentType: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) });
    const proof = await client().getFilingProof('fil_1');
    expect(proof.contentType).toBe('application/pdf');
    expect(proof.data.byteLength).toBe(4);
  });

  it('builds a sandbox filing', async () => {
    const m = mock();
    await client().generateSandboxFiling({ registrationId: 'r1', periodKey: '2026-09', entityId: 'e1' });
    expect(call(m).url).toBe('http://x/v1/filings/sandbox/generate');
    expect(JSON.parse(call(m).init.body as string)).toEqual({ registrationId: 'r1', periodKey: '2026-09' });
    expect(call(m).init.headers['x-entity-id']).toBe('e1');
  });
});

describe('data upload', () => {
  it('lists months and reads one', async () => {
    let m = mock();
    await client().listFilingUploadMonths();
    expect(call(m).url).toBe('http://x/v1/filings/upload/months');
    m = mock();
    await client().getFilingUploadMonth('2026-09');
    expect(call(m).url).toBe('http://x/v1/filings/upload/months/2026-09');
  });

  it('uploads a file as multipart form data in the field "file" with no JSON content type', async () => {
    const m = mock({ ok: true, file: { id: 'f1' } }, { status: 201 });
    await client().uploadFilingDataFile('2026-09', { fileName: 'sales.csv', content: 'a,b\n1,2\n' });
    const { url, init } = call(m);
    expect(url).toBe('http://x/v1/filings/upload/months/2026-09/files');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers['Content-Type']).toBeUndefined();
    const part = (init.body as FormData).get('file') as File;
    expect(part.name).toBe('sales.csv');
    expect(part.type).toBe('text/csv');
    expect(await part.text()).toBe('a,b\n1,2\n');
  });

  it('types a spreadsheet by its extension', async () => {
    const m = mock();
    await client().uploadFilingDataFile('2026-09', { fileName: 'sales.xlsx', content: new Uint8Array([1, 2]) });
    expect(((call(m).init.body as FormData).get('file') as File).type).toContain('spreadsheetml');
  });

  it('deletes a file', async () => {
    const m = mock();
    await client().deleteFilingDataFile('2026-09', 'f/1');
    expect(call(m).url).toBe('http://x/v1/filings/upload/months/2026-09/files/f%2F1');
    expect(call(m).init.method).toBe('DELETE');
  });

  it('processes a month with the declaration only', async () => {
    const m = mock({ ok: true }, { status: 202 });
    await client().processFilingUploadMonth('2026-09', { declarationAccepted: true, declarationVersion: '2026-10-13.1' });
    expect(call(m).url).toBe('http://x/v1/filings/upload/months/2026-09/process');
    expect(JSON.parse(call(m).init.body as string)).toEqual({ declarationAccepted: true, declarationVersion: '2026-10-13.1' });
  });

  it('has no method to close a month', () => {
    expect((client() as unknown as Record<string, unknown>).closeFilingUploadMonth).toBeUndefined();
  });

  it('fetches the error report', async () => {
    const m = mock();
    await client().getFilingUploadErrorReport('2026-09', 'f1');
    expect(call(m).url).toBe('http://x/v1/filings/upload/months/2026-09/files/f1/error-report');
  });

  it('gets the template as json, csv or xlsx', async () => {
    let m = mock({ version: 1, columns: [] });
    expect(await client().getFilingUploadTemplate()).toEqual({ version: 1, columns: [] });
    expect(call(m).url).toBe('http://x/v1/filings/upload/template?format=json');
    m = mock(undefined, { text: 'transaction id,line id', contentType: 'text/csv' });
    expect(await client().getFilingUploadTemplate('csv')).toBe('transaction id,line id');
    expect(call(m).url).toBe('http://x/v1/filings/upload/template?format=csv');
    m = mock(undefined, { bytes: new Uint8Array([80, 75]) });
    const buf = await client().getFilingUploadTemplate('xlsx');
    expect(buf.byteLength).toBe(2);
    expect(call(m).url).toBe('http://x/v1/filings/upload/template?format=xlsx');
  });
});

describe('errors', () => {
  it('surfaces the stable code and the sentence of a Filings error', async () => {
    mock({ error: 'DECLARATION_VERSION_MISMATCH', message: 'The declaration has changed.', currentVersion: 'v2' }, { status: 422 });
    const err = await client().processFilingUploadMonth('2026-09', { declarationAccepted: true, declarationVersion: 'v1' }).catch((e) => e);
    expect(err).toBeInstanceOf(ClearvoError);
    expect(err.status).toBe(422);
    expect(err.code).toBe('DECLARATION_VERSION_MISMATCH');
    expect(err.message).toBe('The declaration has changed.');
  });

  it('exposes the extra body fields of an upload refusal on ClearvoError.body', async () => {
    mock({ error: 'FILE_ALREADY_ADDED', message: 'Already added.', existingId: 'f9', reason: 'same_name' }, { status: 409 });
    const dup = await client().uploadFilingDataFile('2026-09', { fileName: 'a.csv', content: 'a,b\n1,2\n' }).catch((e) => e);
    expect(dup.code).toBe('FILE_ALREADY_ADDED');
    expect(dup.body.existingId).toBe('f9');
    expect(dup.body.reason).toBe('same_name');

    mock({ error: 'FILE_ERRORS', message: 'One or more files have errors.', filesWithErrors: 2 }, { status: 409 });
    const fe = await client().processFilingUploadMonth('2026-09', { declarationAccepted: true, declarationVersion: 'v' }).catch((e) => e);
    expect(fe.code).toBe('FILE_ERRORS');
    expect(fe.body.filesWithErrors).toBe(2);

    mock({ error: 'SYSTEM_FILE_ERRORS', message: 'A file we prepared for you has errors.', filesWithErrors: 1, contactUrl: 'https://example.test/contact' }, { status: 409 });
    const sfe = await client().processFilingUploadMonth('2026-09', { declarationAccepted: true, declarationVersion: 'v' }).catch((e) => e);
    expect(sfe.code).toBe('SYSTEM_FILE_ERRORS');
    expect(sfe.body.contactUrl).toBe('https://example.test/contact');

    mock({ error: 'DECLARATION_VERSION_MISMATCH', message: 'Changed.', currentVersion: 'v2', declaration: { version: 'v2', text: 'T' } }, { status: 422 });
    const mm = await client().processFilingUploadMonth('2026-09', { declarationAccepted: true, declarationVersion: 'v1' }).catch((e) => e);
    expect(mm.body.currentVersion).toBe('v2');
    expect(mm.body.declaration).toEqual({ version: 'v2', text: 'T' });
  });

  it('keeps a plain string error as before', async () => {
    mock({ error: 'Not found' }, { status: 404 });
    const err = await client().getFiling('x').catch((e) => e);
    expect(err.message).toBe('Not found');
    expect(err.code).toBeUndefined();
  });

  it('throws on a failed download', async () => {
    mock({ error: 'PROOF_NOT_AVAILABLE' }, { status: 404 });
    const err = await client().getFilingProof('fil_1').catch((e) => e);
    expect(err).toBeInstanceOf(ClearvoError);
    expect(err.status).toBe(404);
  });
});
