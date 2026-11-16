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
