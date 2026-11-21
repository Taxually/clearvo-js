import { describe, it, expect, vi, afterEach } from 'vitest';
import { ClearvoClient } from '../src/client';

const ok = (status: number, json: unknown) => ({ ok: true, status, json: async () => json });
function setup(...responses: unknown[]) {
  const m = vi.fn();
  for (const r of responses) m.mockResolvedValueOnce(r);
  global.fetch = m as unknown as typeof fetch;
  return { c: new ClearvoClient({ apiKey: 'csk_test_x', baseUrl: 'http://x/v1' }), m };
}
const sentBody = (m: ReturnType<typeof vi.fn>, n = 0) => JSON.parse((m.mock.calls[n][1] as { body: string }).body);
const job = (status: string, completed: number) => ({ jobId: 'j1', status, total: 25, completed, passed: completed, failed: 0, results: [] });
afterEach(() => { vi.useRealTimers(); });

describe('validateTaxNumbersBatch', () => {
  it('sends formatOnly only when given and returns the sync result unchanged', async () => {
    const result = { results: [], total: 1, valid: 1, invalid: 0, errors: 0, sandbox: true };
    const { c, m } = setup(ok(200, result), ok(200, result));
    expect(await c.validateTaxNumbersBatch([{ countryCode: 'DE', taxNumber: 'DE1' }])).toEqual(result);
    expect(sentBody(m)).toEqual({ items: [{ countryCode: 'DE', taxNumber: 'DE1' }] });
    await c.validateTaxNumbersBatch([{ countryCode: 'DE', taxNumber: 'DE1' }], { formatOnly: true });
    expect(sentBody(m, 1).formatOnly).toBe(true);
  });
  it('returns the accepted job for a 202', async () => {
    const { c } = setup(ok(202, { jobId: 'j1', total: 25, status: 'pending' }));
    const r = await c.validateTaxNumbersBatch(Array(25).fill({ countryCode: 'DE', taxNumber: 'DE1' }));
    expect('jobId' in r && r.jobId).toBe('j1');
  });
});

describe('getTaxNumberBatchJob', () => {
  it('GETs the job route with an encoded id', async () => {
    const { c, m } = setup(ok(200, job('processing', 5)));
    await c.getTaxNumberBatchJob('a/b');
    expect(m.mock.calls[0][0]).toBe('http://x/v1/tax-numbers/validate-batch/a%2Fb');
    expect((m.mock.calls[0][1] as { method: string }).method).toBe('GET');
  });
});

describe('validateTaxNumbersBatchAndWait', () => {
  it('resolves immediately with a sync result and never polls', async () => {
    const result = { results: [], total: 1, valid: 1, invalid: 0, errors: 0, sandbox: true };
    const { c, m } = setup(ok(200, result));
    expect(await c.validateTaxNumbersBatchAndWait([{ countryCode: 'DE', taxNumber: 'DE1' }])).toEqual(result);
    expect(m).toHaveBeenCalledTimes(1);
  });
  it('polls a background job to completion and reports progress', async () => {
    const { c, m } = setup(ok(202, { jobId: 'j1', total: 25, status: 'pending' }), ok(200, job('processing', 10)), ok(200, job('completed', 25)));
    const seen: number[] = [];
    const r = await c.validateTaxNumbersBatchAndWait(Array(25).fill({ countryCode: 'DE', taxNumber: 'DE1' }), { pollIntervalMs: 1, onProgress: j => seen.push(j.completed) });
    expect(r).toMatchObject({ jobId: 'j1', status: 'completed' });
    expect(seen).toEqual([10, 25]);
    expect(m).toHaveBeenCalledTimes(3);
  });
  it('throws when the job fails', async () => {
    const { c } = setup(ok(202, { jobId: 'j1', total: 25, status: 'pending' }), ok(200, job('failed', 3)));
    await expect(c.validateTaxNumbersBatchAndWait(Array(25).fill({ countryCode: 'DE', taxNumber: 'DE1' }), { pollIntervalMs: 1 })).rejects.toThrow(/j1 failed/);
  });
  it('throws on timeout and names the job', async () => {
    const { c } = setup(ok(202, { jobId: 'j1', total: 25, status: 'pending' }), ok(200, job('processing', 3)));
    await expect(c.validateTaxNumbersBatchAndWait(Array(25).fill({ countryCode: 'DE', taxNumber: 'DE1' }), { pollIntervalMs: 50, timeoutMs: 10 })).rejects.toThrow(/j1 was still processing/);
  });
});
