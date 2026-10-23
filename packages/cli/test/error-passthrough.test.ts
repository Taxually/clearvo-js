// CLI failure feedback: field errors, hint, Retry-After and Request-Id under the error; --json-errors (and JSON when stdout is
// not a terminal); distinct exit codes; non-JSON bodies; empty or non-JSON 2xx; unreadable JSON files; bulk row failures.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createProgram } from '../src/program';

const originalFetch = global.fetch;
const originalKey = process.env.CLEARVO_API_KEY;
const originalBase = process.env.CLEARVO_BASE_URL;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
let dir: string;
let file: string;

beforeEach(() => {
  process.env.CLEARVO_API_KEY = 'csk_test_k';
  process.env.CLEARVO_BASE_URL = 'http://x/v1';
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(((code?: number): never => { throw new Error(`exit ${code}`); }) as never);
  dir = mkdtempSync(join(tmpdir(), 'clearvo-errors-'));
  file = join(dir, 'inv.json');
  writeFileSync(file, JSON.stringify({ country: 'DE', invoiceNumber: 'INV-1' }));
});
afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.CLEARVO_API_KEY; else process.env.CLEARVO_API_KEY = originalKey;
  if (originalBase === undefined) delete process.env.CLEARVO_BASE_URL; else process.env.CLEARVO_BASE_URL = originalBase;
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true, writable: true });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const json = (body: unknown, status = 400, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const html = (body: string, status: number) => new Response(body, { status, headers: { 'content-type': 'text/html' } });
const reply = (r: Response | Error) => {
  const f = vi.fn();
  if (r instanceof Error) f.mockRejectedValue(r); else f.mockResolvedValue(r);
  global.fetch = f as unknown as typeof fetch;
  return f;
};
const run = (...args: string[]) => createProgram().parseAsync(args, { from: 'user' });
const stderr = () => errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
const stdout = () => logSpy.mock.calls.map((c) => c.join(' ')).join('\n');

describe('failure text', () => {
  it('prints field errors, hint, Retry-After and Request-Id under the error, and exits 4 on a 400', async () => {
    reply(json({ error: 'Invalid request body', code: 'VALIDATION_ERROR', hint: 'Fix the fields', details: { formErrors: [], fieldErrors: { country: ['must be 2 characters'] } } },
      400, { 'x-request-id': 'req_42', 'retry-after': '3' }));
    await expect(run('send', file)).rejects.toThrow('exit 4');
    const out = stderr();
    expect(out).toContain('HTTP 400: Invalid request body: country: must be 2 characters');
    expect(out).toContain('Code: VALIDATION_ERROR');
    expect(out).toContain('Hint: Fix the fields');
    expect(out).toContain('  - country: must be 2 characters');
    expect(out).toContain('Retry-After: 3s');
    expect(out).toContain('Request-Id: req_42');
  });

  it('uses the full dotted paths of issues[]', async () => {
    reply(json({ error: 'Invalid request body', details: { fieldErrors: { countrySpecific: ['Invalid input'] } }, issues: [{ path: 'countrySpecific.de.invoiceFormat', message: 'Invalid enum value' }] }, 422));
    await expect(run('send', file)).rejects.toThrow('exit 4');
    expect(stderr()).toContain('  - countrySpecific.de.invoiceFormat: Invalid enum value');
    expect(stderr()).not.toContain('countrySpecific: Invalid input');
  });

  it('a 504 HTML page says the request may have been processed and exits 5', async () => {
    reply(html('<html><body>Gateway Timeout</body></html>', 504));
    await expect(run('send', file)).rejects.toThrow('exit 5');
    expect(stderr()).toContain('gateway timeout or unavailable; the request may have been processed, check status before retrying');
    expect(stderr()).toContain('Gateway Timeout');
  });

  it('a 413 says payload too large', async () => {
    reply(html('Request Entity Too Large', 413));
    await expect(run('send', file)).rejects.toThrow('exit 1');
    expect(stderr()).toContain('payload too large');
  });

  it('exit codes: 401 and 403 are 3, 422 is 4, 500 is 5, 404 is 1', async () => {
    for (const [status, code] of [[401, 3], [403, 3], [422, 4], [500, 5], [404, 1]] as const) {
      reply(json({ error: 'nope' }, status));
      await expect(run('send', file)).rejects.toThrow(`exit ${code}`);
    }
  });

  it('a network failure exits 5 with a readable message', async () => {
    reply(new TypeError('fetch failed'));
    await expect(run('send', file)).rejects.toThrow('exit 5');
    expect(stderr()).toContain('Network error: fetch failed');
  });

  it('a timeout exits 5 and says the operation may have completed', async () => {
    reply(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    await expect(run('send', file)).rejects.toThrow('exit 5');
    expect(stderr()).toContain('may still have completed');
  });

  it('an unknown option is a usage error (exit 2)', async () => {
    await expect(run('send', file, '--no-such-flag')).rejects.toThrow('exit 2');
  });
});

describe('--json-errors', () => {
  it('prints one JSON object on stderr with status, code, message, hint, details, issues, errors and requestId', async () => {
    reply(json({ error: 'Invalid request body', code: 'VALIDATION_ERROR', hint: 'h', details: { formErrors: [], fieldErrors: { a: ['bad'] } }, issues: [{ path: 'a.b', message: 'bad' }], errors: [{ code: 'E', message: 'm' }] }, 422, { 'x-request-id': 'r9' }));
    await expect(run('--json-errors', 'send', file)).rejects.toThrow('exit 4');
    expect(errSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(errSpy.mock.calls[0][0]));
    expect(parsed).toMatchObject({ status: 422, code: 'VALIDATION_ERROR', hint: 'h', requestId: 'r9', issues: [{ path: 'a.b', message: 'bad' }], errors: [{ code: 'E', message: 'm' }] });
    expect(parsed.message).toContain('a.b: bad');
    expect(parsed.details).toEqual({ formErrors: [], fieldErrors: { a: ['bad'] } });
  });

  it('is automatic when stdout is not a terminal', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: undefined, configurable: true, writable: true });
    reply(json({ error: 'nope' }, 403));
    await expect(run('send', file)).rejects.toThrow('exit 3');
    expect(JSON.parse(String(errSpy.mock.calls[0][0]))).toMatchObject({ status: 403, message: 'nope' });
  });

  it('keeps rawBody for a non-JSON gateway page', async () => {
    reply(html('<html>bad gateway</html>', 502));
    await expect(run('--json-errors', 'send', file)).rejects.toThrow('exit 5');
    const parsed = JSON.parse(String(errSpy.mock.calls[0][0]));
    expect(parsed.status).toBe(502);
    expect(parsed.rawBody).toBe('<html>bad gateway</html>');
  });
});

describe('2xx bodies', () => {
  it('an empty 204 prints { ok: true, status } and exits 0', async () => {
    reply(new Response(null, { status: 204 }));
    await run('bulk-upload-status', 'b1');
    expect(JSON.parse(stdout())).toEqual({ ok: true, status: 204 });
  });

  it('a 2xx that is not JSON is an error, not {}', async () => {
    reply(html('<html>login</html>', 200));
    await expect(run('bulk-upload-status', 'b1')).rejects.toThrow('exit 5');
    expect(stderr()).toContain('Unexpected non-JSON response');
    expect(stdout()).toBe('');
  });
});

describe('files', () => {
  it('an invalid JSON input file is reported by name and exits 2 without calling the API', async () => {
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{not json');
    const f = reply(json({}, 200));
    await expect(run('send', bad)).rejects.toThrow('exit 2');
    expect(stderr()).toContain(`Invalid JSON in ${bad}:`);
    expect(f).not.toHaveBeenCalled();
  });

  it('rules datasets export shares the error path (code, hint, request id) instead of printing raw HTML', async () => {
    reply(json({ error: 'Dataset not found', code: 'DATASET_NOT_FOUND', hint: 'List datasets first' }, 404, { 'x-request-id': 'r5' }));
    await expect(run('rules', 'datasets', 'export', 'd1')).rejects.toThrow('exit 1');
    expect(stderr()).toContain('Code: DATASET_NOT_FOUND');
    expect(stderr()).toContain('Hint: List datasets first');
    expect(stderr()).toContain('Request-Id: r5');
  });

  it('rules datasets export of a gateway page is not raw HTML', async () => {
    reply(html('<html><h1>504</h1></html>', 504));
    await expect(run('rules', 'datasets', 'export', 'd1')).rejects.toThrow('exit 5');
    expect(stderr()).toContain('gateway timeout or unavailable');
  });
});

describe('send and bulk outcomes', () => {
  const csv = () => { const p = join(dir, 'rows.csv'); writeFileSync(p, 'a,b\n1,2\n'); return p; };

  it('send exits 1 on any ok:false body, even with an outcome the CLI does not know', async () => {
    reply(json({ ok: false, outcome: 'SETUP_NEEDED', id: 'X1', error: { code: 'SETUP_NEEDED', message: 'Finish setup' } }, 200));
    await expect(run('send', file)).rejects.toThrow('exit 1');
    expect(stderr()).toContain('SETUP_NEEDED');
  });

  it('send-bulk exits 1 when a row ERRORED or NEEDS_INFO and lists them', async () => {
    reply(json({ ok: true, batchId: 'b1', status: 'COMPLETED', completedInline: true, summary: { total: 3 }, rows: [
      { rowNumber: 1, outcome: 'ACCEPTED' },
      { rowNumber: 2, outcome: 'ERRORED', invoiceNumber: 'INV-2', errorMessage: 'Bad date' },
      { rowNumber: 3, outcome: 'NEEDS_INFO', errorMessage: 'Missing buyer' },
    ], rowsTruncated: false, continuation: null }, 200));
    await expect(run('send-bulk', csv())).rejects.toThrow('exit 1');
    expect(stdout()).toContain('"batchId":"b1"');
    expect(stderr()).toContain('2 rows did not succeed');
    expect(stderr()).toContain('row 2 ERRORED (INV-2): Bad date');
    expect(stderr()).toContain('row 3 NEEDS_INFO: Missing buyer');
  });

  it('send-bulk-async prints the Poll line for a 202 envelope and exits 0', async () => {
    reply(json({ ok: true, batchId: 'b7', status: 'UPLOADED', completedInline: false, pollUrl: '/v1/send/bulk/b7', rowsUrl: '/v1/send/bulk/b7/rows' }, 202));
    await run('send-bulk-async', csv());
    expect(stderr()).toContain('Poll: clearvo bulk-upload-status b7');
  });

  it('send-bulk with a clean 200 exits 0 and does not print Poll', async () => {
    reply(json({ ok: true, batchId: 'b2', status: 'COMPLETED', completedInline: true, summary: { total: 1 }, rows: [{ rowNumber: 1, outcome: 'ACCEPTED' }], rowsTruncated: false, continuation: null }, 200));
    await run('send-bulk', csv());
    expect(stderr()).toBe('');
  });

  it('send-bulk has no client-side row cap any more', async () => {
    const p = join(dir, 'big.csv');
    writeFileSync(p, ['h'].concat(Array.from({ length: 700 }, (_, i) => `r${i}`)).join('\n'));
    const f = reply(json({ ok: true, batchId: 'b3', status: 'UPLOADED', completedInline: false, pollUrl: 'p', rowsUrl: 'r' }, 202));
    await run('send-bulk', p);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('tests run --wait', () => {
  const runBody = (status: string) => ({ runId: 'r1', name: 'CI', status, summary: {}, cases: [] });

  it('retries a transient poll failure instead of abandoning the run', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json({ runId: 'r1', status: 'running' }, 202))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(json({ error: 'busy' }, 503))
      .mockResolvedValueOnce(json(runBody('passed'), 200));
    global.fetch = f as unknown as typeof fetch;
    await run('tests', 'run', '--wait', '--interval', '0');
    expect(f).toHaveBeenCalledTimes(4);
    expect(stdout()).toContain('PASSED');
  });

  it('gives up after 3 retries of the same poll and exits with the failure code', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ runId: 'r1', status: 'running' }, 202)).mockResolvedValue(json({ error: 'busy' }, 503));
    global.fetch = f as unknown as typeof fetch;
    await expect(run('tests', 'run', '--wait', '--interval', '0')).rejects.toThrow('exit 5');
    expect(f).toHaveBeenCalledTimes(5); // start + 1 poll + 3 retries
  });

  it('does not retry a poll that fails with a 401', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ runId: 'r1', status: 'running' }, 202)).mockResolvedValue(json({ error: 'bad key' }, 401));
    global.fetch = f as unknown as typeof fetch;
    await expect(run('tests', 'run', '--wait', '--interval', '0')).rejects.toThrow('exit 3');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('stops at --max-wait', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ runId: 'r1', status: 'running' }, 202)).mockResolvedValue(json(runBody('running'), 200));
    global.fetch = f as unknown as typeof fetch;
    await expect(run('tests', 'run', '--wait', '--interval', '0', '--max-wait', '0')).rejects.toThrow('exit 5');
    expect(stderr()).toContain('Timed out');
    expect(stderr()).toContain('clearvo tests status r1');
  });
});
