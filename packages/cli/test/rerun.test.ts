// `clearvo rerun <id>`: POST /v1/invoices/{id}/rerun.

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

describe('rerun', () => {
  it('posts an empty body, then dryRun with the entity header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await createProgram().parseAsync(['rerun', 'inv/1'], { from: 'user' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/invoices/inv%2F1/rerun');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({});

    await createProgram().parseAsync(['rerun', 'inv-2', '--dry-run', '--entity', 'ent_1'], { from: 'user' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ dryRun: true });
    expect(fetchMock.mock.calls[1][1].headers['x-entity-id']).toBe('ent_1');
  });

  it('exits non-zero on a 409', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: 'NOT_RERUNNABLE', error: 'no' }) }) as unknown as typeof fetch;
    const exit = vi.spyOn(process, 'exit').mockImplementation(((c?: number): never => { throw new Error(`exit ${c}`); }) as never);
    await expect(createProgram().parseAsync(['rerun', 'x'], { from: 'user' })).rejects.toThrow('exit 1');
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('rerun-many', () => {
  const page = (n: number, done: boolean, cursor: string | null) => ({
    ok: true, status: 200,
    json: async () => ({ ok: true, results: [{ invoiceId: `i${n}`, ok: true, outcome: 'rerun' }], summary: { requested: 1, rerun: 1, skipped: 0, failed: 0 }, done, nextCursor: cursor, remaining: 0 }),
  });

  it('follows nextCursor until done and sums the summary', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(page(1, false, 'k:a')).mockResolvedValueOnce(page(2, true, null));
    global.fetch = fetchMock as unknown as typeof fetch;
    await createProgram().parseAsync(['rerun-many', '--status', 'WAITING_FOR_YOU', '--country', 'DE'], { from: 'user' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/invoices/rerun');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ filter: { status: 'WAITING_FOR_YOU', country: 'DE' } });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ filter: { status: 'WAITING_FOR_YOU', country: 'DE' }, cursor: 'k:a' });
    const printed = JSON.parse((console.log as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]);
    expect(printed.summary).toEqual({ requested: 2, rerun: 2, skipped: 0, failed: 0 });
  });

  it('--dry-run makes one call with dryRun and ids', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, matched: 2 }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await createProgram().parseAsync(['rerun-many', 'a', 'b', '--dry-run', '--entity', 'ent_1'], { from: 'user' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ ids: ['a', 'b'], dryRun: true });
    expect(fetchMock.mock.calls[0][1].headers['x-entity-id']).toBe('ent_1');
  });

  it('refuses ids together with filter flags, and neither', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((c?: number): never => { throw new Error(`exit ${c}`); }) as never);
    await expect(createProgram().parseAsync(['rerun-many', 'a', '--status', 'X'], { from: 'user' })).rejects.toThrow('exit 1');
    await expect(createProgram().parseAsync(['rerun-many'], { from: 'user' })).rejects.toThrow('exit 1');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
