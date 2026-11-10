// `clearvo retry-with-master-data <id>`: POST /v1/invoices/{id}/retry-with-master-data.

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

describe('retry-with-master-data', () => {
  it('posts an empty body, then dryRun with the entity header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await createProgram().parseAsync(['retry-with-master-data', 'inv/1'], { from: 'user' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/invoices/inv%2F1/retry-with-master-data');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({});

    await createProgram().parseAsync(['retry-with-master-data', 'inv-2', '--dry-run', '--entity', 'ent_1'], { from: 'user' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ dryRun: true });
    expect(fetchMock.mock.calls[1][1].headers['x-entity-id']).toBe('ent_1');
  });

  it('exits non-zero on a 409', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: 'NOT_ELIGIBLE', error: 'no' }) }) as unknown as typeof fetch;
    const exit = vi.spyOn(process, 'exit').mockImplementation(((c?: number): never => { throw new Error(`exit ${c}`); }) as never);
    await expect(createProgram().parseAsync(['retry-with-master-data', 'x'], { from: 'user' })).rejects.toThrow('exit 1');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
