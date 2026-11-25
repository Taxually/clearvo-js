// `clearvo void-invoice | void-invoices | void-bulk-upload | void-reporting-batch`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

const run = async (args: string[]) => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
  global.fetch = fetchMock as unknown as typeof fetch;
  await createProgram().parseAsync(args, { from: 'user' });
  return fetchMock.mock.calls[0] as [string, { method: string; body: string; headers: Record<string, string> }];
};

describe('void commands', () => {
  it('void-invoice posts the reason and entity header', async () => {
    const [url, init] = await run(['void-invoice', 'inv/1', '--reason', 'duplicate', '--entity', 'ent_1']);
    expect(url).toBe('http://x/v1/invoices/inv%2F1/void');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ reason: 'duplicate' });
    expect(init.headers['x-entity-id']).toBe('ent_1');
  });

  it('void-invoice without a reason posts an empty body', async () => {
    const [, init] = await run(['void-invoice', 'inv_1']);
    expect(JSON.parse(init.body)).toEqual({});
  });

  it('void-invoices posts every id to the bulk route', async () => {
    const [url, init] = await run(['void-invoices', 'a', 'b', 'c', '--reason', 'test']);
    expect(url).toBe('http://x/v1/invoices/void');
    expect(JSON.parse(init.body)).toEqual({ ids: ['a', 'b', 'c'], reason: 'test' });
  });

  it('void-bulk-upload posts to the upload batch route', async () => {
    const [url] = await run(['void-bulk-upload', 'batch_1']);
    expect(url).toBe('http://x/v1/send/bulk/batch_1/void');
  });

  it('void-reporting-batch posts to the reporting batch route', async () => {
    const [url] = await run(['void-reporting-batch', 'rb_1']);
    expect(url).toBe('http://x/v1/reporting-batches/rb_1/void');
  });

  it('exits non-zero on a 409', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: { code: 'CANNOT_VOID_COMPLETED', message: 'no' } }) }) as unknown as typeof fetch;
    const exit = vi.spyOn(process, 'exit').mockImplementation(((c?: number): never => { throw new Error(`exit ${c}`); }) as never);
    await expect(createProgram().parseAsync(['void-invoice', 'x'], { from: 'user' })).rejects.toThrow('exit 1');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
