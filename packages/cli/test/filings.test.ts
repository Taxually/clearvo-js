// `clearvo filings ...`: setup, the return lifecycle and the data upload. Drives the real Commander commands from
// createProgram() with a mocked global.fetch (a fresh program per test, see fr-credentials.test.ts for why).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createProgram } from '../src/program';

const originalFetch = global.fetch;
const originalApiKey = process.env.CLEARVO_API_KEY;
const originalBaseUrl = process.env.CLEARVO_BASE_URL;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.CLEARVO_API_KEY = 'csk_live_testkey';
  process.env.CLEARVO_BASE_URL = 'http://x/v1';
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  global.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.CLEARVO_API_KEY; else process.env.CLEARVO_API_KEY = originalApiKey;
  if (originalBaseUrl === undefined) delete process.env.CLEARVO_BASE_URL; else process.env.CLEARVO_BASE_URL = originalBaseUrl;
  logSpy.mockRestore();
  errSpy.mockRestore();
  vi.restoreAllMocks();
});

function mockFetch(body: unknown = { ok: true }, init: { status?: number; text?: string; bytes?: Uint8Array } = {}) {
  const status = init.status ?? 200;
  const m = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => init.text ?? '',
    arrayBuffer: async () => (init.bytes ?? new Uint8Array([1, 2])).buffer,
  });
  global.fetch = m as unknown as typeof fetch;
  return m;
}
const run = (args: string[]) => createProgram().parseAsync(['filings', ...args], { from: 'user' });
const last = (m: ReturnType<typeof mockFetch>) => ({ url: m.mock.calls[0][0] as string, init: m.mock.calls[0][1] as RequestInit & { headers: Record<string, string> } });
const exitThrows = () => vi.spyOn(process, 'exit').mockImplementation(((): never => { throw new Error('process.exit called'); }) as never);

describe('setup', () => {
  it('lists setups and gets one registration', async () => {
    let m = mockFetch();
    await run(['setups']);
    expect(last(m).url).toBe('http://x/v1/filings/setups');
    m = mockFetch();
    await run(['setup', 'get', 'reg-1', '--entity', 'ent-1']);
    expect(last(m).url).toBe('http://x/v1/tax/registrations/reg-1/filing');
    expect(last(m).init.headers['x-entity-id']).toBe('ent-1');
  });

  it('request PUTs the attested frequency and start', async () => {
    const m = mockFetch();
    await run(['setup', 'request', 'reg-1', '--frequency', 'Monthly', '--attest']);
    expect(last(m).init.method).toBe('PUT');
    expect(JSON.parse(last(m).init.body as string)).toEqual({ frequencyCode: 'Monthly', frequencyAttested: true, startChoice: 'asap' });
    const m2 = mockFetch();
    await run(['setup', 'request', 'reg-1', '--frequency', 'Quarterly', '--attest', '--start', 'later', '--start-period', '2027-Q1']);
    expect(JSON.parse(last(m2).init.body as string)).toEqual({ frequencyCode: 'Quarterly', frequencyAttested: true, startChoice: 'later', startPeriodKey: '2027-Q1' });
  });

  it('request refuses to run without --attest, or --start later without a period, and calls nothing', async () => {
    const m = mockFetch();
    exitThrows();
    await expect(run(['setup', 'request', 'reg-1', '--frequency', 'Monthly'])).rejects.toThrow('process.exit called');
    await expect(run(['setup', 'request', 'reg-1', '--frequency', 'Monthly', '--attest', '--start', 'later'])).rejects.toThrow('process.exit called');
    await expect(run(['setup', 'request', 'reg-1', '--frequency', 'Monthly', '--attest', '--start', 'yesterday'])).rejects.toThrow('process.exit called');
    expect(m).not.toHaveBeenCalled();
  });

  it('defer and stop send their own bodies', async () => {
    let m = mockFetch();
    await run(['setup', 'defer', 'reg-1', '--to', '2026-12-01']);
    expect(JSON.parse(last(m).init.body as string)).toEqual({ deferFirstPeriodTo: '2026-12-01' });
    m = mockFetch();
    await run(['setup', 'stop', 'reg-1']);
    expect(JSON.parse(last(m).init.body as string)).toEqual({ stop: true });
  });
});

describe('returns lifecycle', () => {
  it('lists with filters and gets one', async () => {
    let m = mockFetch();
    await run(['list', '--view', 'upcoming', '--jurisdiction', 'US_CA', '--limit', '5']);
    expect(last(m).url).toBe('http://x/v1/filings?view=upcoming&jurisdictionId=US_CA&limit=5');
    m = mockFetch();
    await run(['get', 'fil_1']);
    expect(last(m).url).toBe('http://x/v1/filings/fil_1');
  });

  it.each(['approve', 'undo', 'pause', 'resume'])('%s POSTs the snapshotVersion', async (action) => {
    const m = mockFetch();
    await run([action, 'fil_1', '--snapshot-version', '4']);
    expect(last(m).url).toBe(`http://x/v1/filings/fil_1/${action}`);
    expect(last(m).init.method).toBe('POST');
    expect(JSON.parse(last(m).init.body as string)).toEqual({ snapshotVersion: 4 });
  });

  it('approve needs the snapshot version and rejects a bad one', async () => {
    const m = mockFetch();
    exitThrows();
    await expect(run(['approve', 'fil_1'])).rejects.toThrow();
    await expect(run(['approve', 'fil_1', '--snapshot-version', 'abc'])).rejects.toThrow('process.exit called');
    expect(m).not.toHaveBeenCalled();
  });

  it('skip, prepayment and change requests', async () => {
    let m = mockFetch();
    await run(['skip', 'fil_1', '--snapshot-version', '2', '--reason', 'Closed']);
    expect(JSON.parse(last(m).init.body as string)).toEqual({ snapshotVersion: 2, reason: 'Closed' });
    m = mockFetch();
    await run(['prepayment', 'fil_1', '--snapshot-version', '2', '--amount', '12.5']);
    expect(JSON.parse(last(m).init.body as string)).toEqual({ snapshotVersion: 2, amount: 12.5 });
    m = mockFetch();
    await run(['change-requests', 'list', 'fil_1']);
    expect(last(m).url).toBe('http://x/v1/filings/fil_1/change-requests');
    m = mockFetch();
    await run(['change-requests', 'create', 'fil_1', '--message', 'Fix the county']);
    expect(JSON.parse(last(m).init.body as string)).toEqual({ message: 'Fix the county' });
  });

  it('downloads the csv to stdout or a file and the proof to a file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clearvo-filings-'));
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never);
    let m = mockFetch(undefined, { text: 'a,b\nTOTAL,1\n' });
    await run(['csv', 'fil_1']);
    expect(last(m).url).toBe('http://x/v1/filings/fil_1/csv');
    expect(write).toHaveBeenCalledWith('a,b\nTOTAL,1\n');
    m = mockFetch(undefined, { text: 'x' });
    await run(['csv', 'fil_1', '--transactions', '--out', join(dir, 't.csv')]);
    expect(last(m).url).toBe('http://x/v1/filings/fil_1/transactions.csv');
    expect(readFileSync(join(dir, 't.csv'), 'utf8')).toBe('x');
    m = mockFetch(undefined, { bytes: new Uint8Array([37, 80, 68, 70]) });
    await run(['proof', 'fil_1', '--out', join(dir, 'p.pdf')]);
    expect([...readFileSync(join(dir, 'p.pdf'))]).toEqual([37, 80, 68, 70]);
  });

  it('builds a sandbox filing and reads the bank account', async () => {
    let m = mockFetch();
    await run(['sandbox-generate', '--registration', 'reg-1', '--period', '2026-09']);
    expect(JSON.parse(last(m).init.body as string)).toEqual({ registrationId: 'reg-1', periodKey: '2026-09' });
    m = mockFetch();
    await run(['bank-account']);
    expect(last(m).url).toBe('http://x/v1/filings/bank-account');
  });
});

describe('upload', () => {
  it('lists months and reads one', async () => {
    let m = mockFetch();
    await run(['upload', 'months']);
    expect(last(m).url).toBe('http://x/v1/filings/upload/months');
    m = mockFetch();
    await run(['upload', 'month', '2026-09']);
    expect(last(m).url).toBe('http://x/v1/filings/upload/months/2026-09');
  });

  it('adds a file as multipart in the field "file"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clearvo-filings-'));
    const file = join(dir, 'sales.csv');
    writeFileSync(file, 'a,b\n1,2\n');
    const m = mockFetch({ ok: true, file: { id: 'f1' } }, { status: 201 });
    await run(['upload', 'add', '2026-09', file]);
    const { url, init } = last(m);
    expect(url).toBe('http://x/v1/filings/upload/months/2026-09/files');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers['Content-Type']).toBeUndefined();
    const part = (init.body as FormData).get('file') as File;
    expect(part.name).toBe('sales.csv');
    expect(part.type).toBe('text/csv');
    expect(await part.text()).toBe('a,b\n1,2\n');
  });

  it('refuses a wrong extension or an empty file before calling the API', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clearvo-filings-'));
    writeFileSync(join(dir, 'a.txt'), 'x');
    writeFileSync(join(dir, 'empty.csv'), '');
    const m = mockFetch();
    exitThrows();
    await expect(run(['upload', 'add', '2026-09', join(dir, 'a.txt')])).rejects.toThrow('process.exit called');
    await expect(run(['upload', 'add', '2026-09', join(dir, 'empty.csv')])).rejects.toThrow('process.exit called');
    expect(m).not.toHaveBeenCalled();
  });

  it('deletes a file and fetches an error report', async () => {
    let m = mockFetch();
    await run(['upload', 'delete', '2026-09', 'f1']);
    expect(last(m).init.method).toBe('DELETE');
    expect(last(m).url).toBe('http://x/v1/filings/upload/months/2026-09/files/f1');
    m = mockFetch();
    await run(['upload', 'error-report', '2026-09', 'f1']);
    expect(last(m).url).toBe('http://x/v1/filings/upload/months/2026-09/files/f1/error-report');
  });

  it('process sends the accepted declaration and its version, and the acknowledgement when asked', async () => {
    const m = mockFetch({ ok: true }, { status: 202 });
    await run(['upload', 'process', '2026-09', '--accept-declaration', '--declaration-version', '2026-10-11.1']);
    expect(last(m).url).toBe('http://x/v1/filings/upload/months/2026-09/process');
    expect(JSON.parse(last(m).init.body as string)).toEqual({ declarationAccepted: true, declarationVersion: '2026-10-11.1' });
    const m2 = mockFetch({ ok: true }, { status: 202 });
    await run(['upload', 'process', '2026-09', '--accept-declaration', '--declaration-version', 'v', '--acknowledge-rejected']);
    expect(JSON.parse(last(m2).init.body as string)).toEqual({ declarationAccepted: true, declarationVersion: 'v', acknowledgeRejectedRows: true });
  });

  it('process never sends without --accept-declaration', async () => {
    const m = mockFetch();
    exitThrows();
    await expect(run(['upload', 'process', '2026-09', '--declaration-version', 'v'])).rejects.toThrow('process.exit called');
    expect(m).not.toHaveBeenCalled();
  });

  it('gets the template in each format', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never);
    let m = mockFetch(undefined, { text: 'transaction id,line id' });
    await run(['upload', 'template']);
    expect(last(m).url).toBe('http://x/v1/filings/upload/template?format=csv');
    expect(write).toHaveBeenCalledWith('transaction id,line id');
    m = mockFetch(undefined, { text: '{}' });
    await run(['upload', 'template', '--format', 'json']);
    expect(last(m).url).toBe('http://x/v1/filings/upload/template?format=json');
    mockFetch(undefined, { bytes: new Uint8Array([80, 75]) });
    exitThrows();
    await expect(run(['upload', 'template', '--format', 'xlsx'])).rejects.toThrow('process.exit called');
  });
});

describe('errors', () => {
  it('prints the sentence and the stable code of a Filings error', async () => {
    mockFetch({ error: 'DECLARATION_VERSION_MISMATCH', message: 'The declaration has changed.' }, { status: 422 });
    exitThrows();
    await expect(run(['upload', 'process', '2026-09', '--accept-declaration', '--declaration-version', 'old'])).rejects.toThrow('process.exit called');
    const printed = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('HTTP 422: The declaration has changed.');
    expect(printed).toContain('Code: DECLARATION_VERSION_MISMATCH');
  });

  it('prints a failed download like any other error', async () => {
    mockFetch({ error: 'PROOF_NOT_AVAILABLE' }, { status: 404 });
    exitThrows();
    await expect(run(['proof', 'fil_1', '--out', '/dev/null'])).rejects.toThrow('process.exit called');
    expect(errSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('HTTP 404: PROOF_NOT_AVAILABLE');
  });
});
