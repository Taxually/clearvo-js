import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createProgram } from '../src/program';

const originalFetch = global.fetch;
beforeEach(() => {
  process.env.CLEARVO_API_KEY = 'csk_live_testkey';
  process.env.CLEARVO_BASE_URL = 'http://x/v1';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

function mockFetch() {
  const m = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => 'a,b\n1,2' });
  global.fetch = m as unknown as typeof fetch;
  return m;
}

describe('tax-numbers commands', () => {
  it('checks sends every filter as a query param', async () => {
    const m = mockFetch();
    await createProgram().parseAsync(['tax-numbers', 'checks', '--country', 'DE', '--result', 'valid', '--source', 'live', '--requester', 'taxually', '--from', '2026-01-01', '--to', '2026-02-01', '--q', '12', '--tax-number', 'DE123', '--page', '2', '--page-size', '25'], { from: 'user' });
    expect(m.mock.calls[0][0]).toBe('http://x/v1/tax-numbers/checks?countryCode=DE&result=valid&source=live&requester=taxually&from=2026-01-01&to=2026-02-01&q=12&taxNumber=DE123&page=2&pageSize=25');
  });
  it('checks --export calls the export route without paging and prints the CSV', async () => {
    const m = mockFetch();
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await createProgram().parseAsync(['tax-numbers', 'checks', '--export', '--country', 'FR', '--page', '9'], { from: 'user' });
    expect(m.mock.calls[0][0]).toBe('http://x/v1/tax-numbers/checks/export?countryCode=FR');
    expect(out).toHaveBeenCalledWith('a,b\n1,2');
  });
  it('batch-jobs lists the jobs', async () => {
    const m = mockFetch();
    await createProgram().parseAsync(['tax-numbers', 'batch-jobs', '--page', '2'], { from: 'user' });
    expect(m.mock.calls[0][0]).toBe('http://x/v1/tax-numbers/validate-batch?page=2');
  });
  it('recheck posts the country and number', async () => {
    const m = mockFetch();
    await createProgram().parseAsync(['tax-numbers', 'recheck', 'DE', 'DE123456789'], { from: 'user' });
    expect(m.mock.calls[0][0]).toBe('http://x/v1/tax-numbers/recheck');
    expect((m.mock.calls[0][1] as { method: string }).method).toBe('POST');
    expect(JSON.parse((m.mock.calls[0][1] as { body: string }).body)).toEqual({ countryCode: 'DE', taxNumber: 'DE123456789' });
  });
});
