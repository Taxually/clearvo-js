// Error passthrough: every failure keeps status, code, message (with field errors), hint, details, issues, errors[],
// request id, retry-after and the raw body; a 2xx that is empty or not JSON is not "success carrying {}"; network
// failures and timeouts become ClearvoError; retries only repeat idempotent calls.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ClearvoClient } from '../src/client';
import { ClearvoError } from '../src/types';

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; vi.useRealTimers(); });

function json(body: unknown, status = 400, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
function text(body: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html', ...headers } });
}
function mockSeq(...responses: Array<Response | Error>) {
  const f = vi.fn();
  for (const r of responses) r instanceof Error ? f.mockRejectedValueOnce(r) : f.mockResolvedValueOnce(r);
  global.fetch = f as unknown as typeof fetch;
  return f;
}
const client = (o: Partial<ConstructorParameters<typeof ClearvoClient>[0]> = {}) => new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1', retryBaseDelayMs: 1, ...o });
const fail = async (p: Promise<unknown>) => (await p.then(() => { throw new Error('expected a rejection'); }, (e) => e)) as ClearvoError;

describe('field errors', () => {
  it('puts flatten-style details.fieldErrors in the message and exposes details and fieldErrors', async () => {
    mockSeq(json({ error: 'Invalid request body', details: { formErrors: [], fieldErrors: { country: ['must be 2 characters'], name: ['Required'] } } }));
    const err = await fail(client().listFilings());
    expect(err.message).toBe('Invalid request body: country: must be 2 characters; name: Required');
    expect(err.fieldErrors).toEqual(['country: must be 2 characters', 'name: Required']);
    expect((err.details as { fieldErrors: unknown }).fieldErrors).toEqual({ country: ['must be 2 characters'], name: ['Required'] });
    expect(err.status).toBe(400);
  });

  it('prefers issues[] (full dotted paths) and keeps code, hint, errors[], request id, retry-after and idempotency key', async () => {
    mockSeq(json(
      { error: 'Invalid request body', code: 'VALIDATION_ERROR', hint: 'Fix the highlighted fields', details: { formErrors: [], fieldErrors: { countrySpecific: ['Invalid input'] } },
        issues: [{ path: 'countrySpecific.de.invoiceFormat', message: 'Invalid enum value' }], errors: [{ code: 'X', message: 'm', field: 'f' }] },
      422, { 'x-request-id': 'req_9', 'retry-after': '7', 'x-idempotency-key': 'idem-1' },
    ));
    const err = await fail(client().listFilings());
    expect(err.message).toBe('Invalid request body: countrySpecific.de.invoiceFormat: Invalid enum value');
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.hint).toBe('Fix the highlighted fields');
    expect(err.issues).toEqual([{ path: 'countrySpecific.de.invoiceFormat', message: 'Invalid enum value' }]);
    expect(err.errors).toHaveLength(1);
    expect(err.requestId).toBe('req_9');
    expect(err.retryAfter).toBe(7);
    expect(err.idempotencyKey).toBe('idem-1');
    expect(err.retryable).toBe(false);
  });

  it('caps the message at 25 field errors', async () => {
    const fieldErrors: Record<string, string[]> = {};
    for (let i = 0; i < 30; i++) fieldErrors[`f${i}`] = ['bad'];
    mockSeq(json({ error: 'Invalid request body', details: { formErrors: [], fieldErrors } }));
    const err = await fail(client().listFilings());
    expect(err.message.split('; ')).toHaveLength(26);
    expect(err.message).toContain('and 5 more');
  });

  it('reads {error:{code,message}} and {ok:false,errors:[...]} bodies', async () => {
    mockSeq(json({ error: { code: 'INVALID_TAX_ID', message: 'Tax number is invalid' } }, 422));
    const a = await fail(client().listFilings());
    expect(a.message).toBe('Tax number is invalid');
    expect(a.code).toBe('INVALID_TAX_ID');
    mockSeq(json({ ok: false, errors: [{ code: 'E1', message: 'Row 3 is bad', field: 'row' }] }, 422));
    const b = await fail(client().listFilings());
    expect(b.message).toBe('Row 3 is bad');
    expect(b.errors?.[0]).toMatchObject({ code: 'E1' });
  });
});

describe('normalised v1 error bodies', () => {
  const invalidTax = { ok: false, error: 'INVALID_TAX_NUMBER', code: 'INVALID_TAX_NUMBER', field: 'taxNumber', detail: 'DE123 is not a valid German VAT number', hint: 'Check the number', message: 'DE123 is not a valid German VAT number', retryable: false };

  it('INVALID_TAX_NUMBER: the headline is the sentence, not the bare code; field, hint, code and retryable come through', async () => {
    mockSeq(json(invalidTax, 422));
    const err = await fail(client().listFilings());
    expect(err.message).toBe('DE123 is not a valid German VAT number');
    expect(err.code).toBe('INVALID_TAX_NUMBER');
    expect(err.field).toBe('taxNumber');
    expect(err.hint).toBe('Check the number');
    expect(err.retryable).toBe(false);
  });

  it('without message the sentence in detail still beats a bare code in error', async () => {
    const { message: _m, ...noMessage } = invalidTax;
    mockSeq(json(noMessage, 422));
    expect((await fail(client().listFilings())).message).toBe('DE123 is not a valid German VAT number');
  });

  it('a bare code with no message or detail is kept as it is', async () => {
    mockSeq(json({ error: 'INVALID_TAX_NUMBER' }, 422));
    const err = await fail(client().listFilings());
    expect(err.message).toBe('INVALID_TAX_NUMBER');
  });

  it('an older body without message, code or retryable still reads as before, with the status-based retryable', async () => {
    mockSeq(json({ error: 'Not found' }, 404));
    const a = await fail(client().listFilings());
    expect(a.message).toBe('Not found');
    expect(a.code).toBeUndefined();
    expect(a.retryable).toBe(false);
    mockSeq(json({ error: 'busy' }, 503));
    expect((await fail(client().listFilings())).retryable).toBe(true);
  });

  it('top-level code wins over error.code, and the body retryable wins over the status', async () => {
    mockSeq(json({ ok: false, code: 'TOP', message: 'Top message', error: { code: 'INNER', message: 'Inner message' }, retryable: true }, 400));
    const err = await fail(client().listFilings());
    expect(err.code).toBe('TOP');
    expect(err.message).toBe('Top message');
    expect(err.retryable).toBe(true);
  });
});

describe('non-JSON and odd bodies', () => {
  it('a 504 HTML page says the request may have been processed and keeps rawBody (500 chars)', async () => {
    mockSeq(text(`<html>${'x'.repeat(2000)}</html>`, 504));
    const err = await fail(client().listFilings());
    expect(err.status).toBe(504);
    expect(err.message).toContain('gateway timeout or unavailable; the request may have been processed, check status before retrying');
    expect(err.rawBody).toHaveLength(500);
    expect(err.retryable).toBe(true);
  });

  it('a 413 says payload too large', async () => {
    mockSeq(text('Request Entity Too Large', 413));
    const err = await fail(client().listFilings());
    expect(err.message).toBe('HTTP 413: payload too large');
    expect(err.rawBody).toBe('Request Entity Too Large');
  });

  it('a JSON body that is literally null does not mask the status', async () => {
    mockSeq(json(null, 500));
    const err = await fail(client().listFilings());
    expect(err).toBeInstanceOf(ClearvoError);
    expect(err.status).toBe(500);
    expect(err.message).toBe('HTTP 500');
  });

  it('file downloads use the same error path (hint, code, request id)', async () => {
    mockSeq(json({ error: 'NOT_FOUND', message: 'No such file', hint: 'List the files first' }, 404, { 'x-request-id': 'r1' }));
    const err = await fail(client().downloadFilingDocument('f', 'd'));
    expect(err.message).toBe('No such file');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.hint).toBe('List the files first');
    expect(err.requestId).toBe('r1');
  });
});

describe('2xx bodies', () => {
  it('an empty 204 returns { ok: true, status }', async () => {
    mockSeq(new Response(null, { status: 204 }));
    expect(await client().deleteProduct('p')).toEqual({ ok: true, status: 204 });
  });

  it('an empty 201 returns { ok: true, status } instead of a bare SyntaxError', async () => {
    mockSeq(new Response('', { status: 201 }));
    expect(await client().listFilings()).toEqual({ ok: true, status: 201 });
  });

  it('a 2xx with a non-JSON body throws ClearvoError with rawBody', async () => {
    mockSeq(text('<html>proxy login</html>', 200));
    const err = await fail(client().listFilings());
    expect(err.status).toBe(200);
    expect(err.message).toBe('Unexpected non-JSON response');
    expect(err.rawBody).toBe('<html>proxy login</html>');
  });

  it('a JSON null 2xx body is not a bare null', async () => {
    mockSeq(json(null, 200));
    expect(await client().listFilings()).toEqual({ ok: true, status: 200 });
  });
});

describe('network behaviour', () => {
  it('wraps a network failure in ClearvoError(0, NETWORK_ERROR) keeping the cause', async () => {
    const cause = new TypeError('fetch failed');
    mockSeq(cause);
    const err = await fail(client().listFilings());
    expect(err.status).toBe(0);
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.message).toContain('fetch failed');
    expect((err as { cause?: unknown }).cause).toBe(cause);
    expect(err.retryable).toBe(true);
  });

  it('turns an aborted request into ClearvoError(0, TIMEOUT) and passes an AbortSignal to fetch', async () => {
    const f = mockSeq(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    const err = await fail(client({ timeoutMs: 50 }).listFilings());
    expect(err.status).toBe(0);
    expect(err.code).toBe('TIMEOUT');
    expect(err.message).toContain('may still have completed');
    expect((f.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('the default timeout passed to AbortSignal.timeout is 140000 ms; timeoutMs and a per-call timeoutMs override it', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    mockSeq(json({ ok: true }, 200), json({ ok: true }, 200), json({ id: '1', ok: true, outcome: 'CLEARED' }, 200));
    await client().listFilings();
    expect(spy).toHaveBeenLastCalledWith(140000);
    await client({ timeoutMs: 5000 }).listFilings();
    expect(spy).toHaveBeenLastCalledWith(5000);
    await client().submitInvoice({} as never, undefined, { timeoutMs: 200000 });
    expect(spy).toHaveBeenLastCalledWith(200000);
    spy.mockRestore();
  });

  const hang = (_u: unknown, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)));

  it('a short timeoutMs really aborts a fetch that never answers', async () => {
    global.fetch = vi.fn(hang) as unknown as typeof fetch;
    const err = await fail(client({ timeoutMs: 20 }).listFilings());
    expect(err.status).toBe(0);
    expect(err.code).toBe('TIMEOUT');
  });

  it('works without AbortSignal.timeout (older runtimes) through an AbortController fallback', async () => {
    const original = (AbortSignal as unknown as { timeout?: unknown }).timeout;
    (AbortSignal as unknown as { timeout?: unknown }).timeout = undefined;
    try {
      global.fetch = vi.fn(hang) as unknown as typeof fetch;
      const err = await fail(client({ timeoutMs: 20 }).listFilings());
      expect(err.code).toBe('TIMEOUT');
    } finally {
      (AbortSignal as unknown as { timeout?: unknown }).timeout = original;
    }
  });

  it('a 2xx whose body cannot be read is NETWORK_ERROR, not an empty success; an unreadable error body keeps the status', async () => {
    const broken = (status: number) => new Response(new ReadableStream({ start(c) { c.error(new TypeError('terminated')); } }), { status });
    mockSeq(broken(200));
    const err = await fail(client().listFilings());
    expect(err.status).toBe(0);
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.message).toContain('terminated');
    mockSeq(broken(503));
    const e2 = await fail(client().listFilings());
    expect(e2.status).toBe(503);
  });

  it('an aborted body read on a 2xx is TIMEOUT', async () => {
    const aborted = new Response(new ReadableStream({ start(c) { c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })); } }), { status: 200 });
    mockSeq(aborted);
    expect((await fail(client().listFilings())).code).toBe('TIMEOUT');
  });

  it('does not retry by default', async () => {
    const f = mockSeq(json({ error: 'busy' }, 503), json({ ok: true }, 200));
    await fail(client().listFilings());
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('with maxRetries retries a GET on 503, 429 and a network error', async () => {
    const f = mockSeq(json({ error: 'busy' }, 503), new TypeError('fetch failed'), json({ error: 'slow down' }, 429, { 'retry-after': '0' }), json({ ok: true }, 200));
    expect(await client({ maxRetries: 3 }).listFilings()).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(4);
  });

  it('retries a write only when it carries an idempotency key', async () => {
    const withKey = mockSeq(json({ error: 'busy' }, 503), json({ id: '1', ok: true, outcome: 'CLEARED' }, 200));
    await client({ maxRetries: 2 }).submitInvoice({} as never, 'k-1');
    expect(withKey).toHaveBeenCalledTimes(2);

    const noKey = mockSeq(json({ error: 'busy' }, 503), json({ ok: true }, 200));
    const err = await fail(client({ maxRetries: 2 }).submitInvoice({} as never));
    expect(err.status).toBe(503);
    expect(noKey).toHaveBeenCalledTimes(1);

    const del = mockSeq(new TypeError('fetch failed'), new Response(null, { status: 204 }));
    await fail(client({ maxRetries: 2 }).deleteProduct('p'));
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('never retries a 400 or a 504', async () => {
    const f = mockSeq(json({ error: 'bad' }, 400), json({ ok: true }, 200));
    await fail(client({ maxRetries: 3 }).listFilings());
    expect(f).toHaveBeenCalledTimes(1);
    const g = mockSeq(text('gateway', 504), json({ ok: true }, 200));
    await fail(client({ maxRetries: 3 }).listFilings());
    expect(g).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxRetries and throws the last error', async () => {
    const f = mockSeq(json({ error: 'busy' }, 503), json({ error: 'busy' }, 503), json({ error: 'busy again' }, 503));
    const err = await fail(client({ maxRetries: 2 }).listFilings());
    expect(f).toHaveBeenCalledTimes(3);
    expect(err.message).toBe('busy again');
  });
});

describe('bulk CSV', () => {
  it('sends a big CSV without a client-side size check, with submissionMode and Prefer', async () => {
    const f = mockSeq(json({ ok: true, batchId: 'b1', status: 'UPLOADED', completedInline: false, reviewRequired: false, pollUrl: '/v1/send/bulk/b1', rowsUrl: '/v1/send/bulk/b1/rows' }, 202));
    const csv = ['h'].concat(Array.from({ length: 1000 }, (_, i) => `r${i}`)).join('\n');
    const res = await client().submitInvoicesBulk({ csvContent: csv, submissionMode: 'batch_review', wait: 0 });
    expect(res.completedInline).toBe(false);
    const init = f.mock.calls[0][1] as RequestInit & { headers: Record<string, string> };
    expect(init.headers['Prefer']).toBe('respond-async');
    expect((init.body as FormData).get('submissionMode')).toBe('batch_review');
  });
});

describe('copies stay in sync', () => {
  it('the CLI and MCP error-format.ts are identical to the SDK one', () => {
    const sdk = readFileSync(join(__dirname, '../src/error-format.ts'), 'utf8');
    expect(readFileSync(join(__dirname, '../../cli/src/error-format.ts'), 'utf8')).toBe(sdk);
    expect(readFileSync(join(__dirname, '../../mcp/src/error-format.ts'), 'utf8')).toBe(sdk);
  });
});
