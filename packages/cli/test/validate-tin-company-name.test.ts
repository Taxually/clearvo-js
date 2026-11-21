// `clearvo validate-tin --company-name` and `validate-tin-batch` (JSON and CSV with a company name column).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createProgram, parseTaxNumberCsv } from '../src/program';

const originalFetch = global.fetch;
beforeEach(() => {
  process.env.CLEARVO_API_KEY = 'csk_live_testkey';
  process.env.CLEARVO_BASE_URL = 'http://x/v1';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

function mockFetch() {
  const m = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' });
  global.fetch = m as unknown as typeof fetch;
  return m;
}
const body = (m: ReturnType<typeof vi.fn>) => JSON.parse((m.mock.calls[0][1] as { body: string }).body);

describe('validate-tin', () => {
  it('sends companyName with --company-name', async () => {
    const m = mockFetch();
    await createProgram().parseAsync(['validate-tin', '--country', 'RO', '--number', 'RO123', '--company-name', 'Acme SRL'], { from: 'user' });
    expect(body(m)).toEqual({ countryCode: 'RO', taxNumber: 'RO123', companyName: 'Acme SRL' });
  });
  it('omits companyName when not given', async () => {
    const m = mockFetch();
    await createProgram().parseAsync(['validate-tin', '--country', 'RO', '--number', 'RO123'], { from: 'user' });
    expect(body(m)).toEqual({ countryCode: 'RO', taxNumber: 'RO123' });
  });
});

describe('validate-tin-batch', () => {
  it('reads a CSV with a company name column', async () => {
    const m = mockFetch();
    const f = join(mkdtempSync(join(tmpdir(), 'tin-')), 'in.csv');
    writeFileSync(f, 'countryCode,taxNumber,companyName\nRO,RO123,"Acme, SRL"\nCZ,CZ456,\n');
    await createProgram().parseAsync(['validate-tin-batch', f], { from: 'user' });
    expect(body(m).items).toEqual([
      { countryCode: 'RO', taxNumber: 'RO123', companyName: 'Acme, SRL' },
      { countryCode: 'CZ', taxNumber: 'CZ456' },
    ]);
  });
  it('passes JSON items through', async () => {
    const m = mockFetch();
    const f = join(mkdtempSync(join(tmpdir(), 'tin-')), 'in.json');
    writeFileSync(f, JSON.stringify([{ countryCode: 'GR', taxNumber: 'EL1', companyName: 'X' }]));
    await createProgram().parseAsync(['validate-tin-batch', f], { from: 'user' });
    expect(body(m).items[0].companyName).toBe('X');
  });
  it('rejects a CSV without the required columns', () => {
    expect(() => parseTaxNumberCsv('a,b\n1,2')).toThrow(/country column/);
  });
});

describe('validate-tin-batch large batches', () => {
  const file = () => { const f = join(mkdtempSync(join(tmpdir(), 'tin-')), 'in.json'); writeFileSync(f, JSON.stringify(Array(25).fill({ countryCode: 'DE', taxNumber: 'DE1' }))); return f; };
  const res = (status: number, json: unknown) => ({ ok: true, status, json: async () => json, text: async () => JSON.stringify(json) });

  it('sends formatOnly and prints a sync result once', async () => {
    const m = mockFetch();
    await createProgram().parseAsync(['validate-tin-batch', file(), '--format-only'], { from: 'user' });
    expect(body(m).formatOnly).toBe(true);
    expect(m).toHaveBeenCalledTimes(1);
  });
  it('waits for a background job, prints progress on stderr and the finished job on stdout', async () => {
    const m = vi.fn()
      .mockResolvedValueOnce(res(202, { jobId: 'j1', total: 25, status: 'pending' }))
      .mockResolvedValueOnce(res(200, { jobId: 'j1', status: 'processing', total: 25, completed: 10, passed: 10, failed: 0, results: [] }))
      .mockResolvedValueOnce(res(200, { jobId: 'j1', status: 'completed', total: 25, completed: 25, passed: 24, failed: 1, results: [] }));
    global.fetch = m as unknown as typeof fetch;
    await createProgram().parseAsync(['validate-tin-batch', file(), '--interval', '0.001'], { from: 'user' });
    expect(m).toHaveBeenCalledTimes(3);
    expect(String(m.mock.calls[2][0])).toContain('/tax-numbers/validate-batch/j1');
    expect((console.error as unknown as ReturnType<typeof vi.fn>).mock.calls.flat().join('\n')).toContain('10 of 25');
    expect(JSON.parse(String((console.log as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).status).toBe('completed');
  });
  it('--no-wait prints the accepted job without polling', async () => {
    const m = vi.fn().mockResolvedValueOnce(res(202, { jobId: 'j1', total: 25, status: 'pending' }));
    global.fetch = m as unknown as typeof fetch;
    await createProgram().parseAsync(['validate-tin-batch', file(), '--no-wait'], { from: 'user' });
    expect(m).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((console.log as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).jobId).toBe('j1');
  });
  it('validate-tin-batch-job reads the job', async () => {
    const m = mockFetch();
    await createProgram().parseAsync(['validate-tin-batch-job', 'j1'], { from: 'user' });
    expect(String(m.mock.calls[0][0])).toBe('http://x/v1/tax-numbers/validate-batch/j1');
  });
});
