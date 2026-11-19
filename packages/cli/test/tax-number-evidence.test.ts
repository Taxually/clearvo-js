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
  const m = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' });
  global.fetch = m as unknown as typeof fetch;
  return m;
}

describe('tax number evidence commands', () => {
  it('tax-number-lookups sends filters as query params', async () => {
    const m = mockFetch();
    await createProgram().parseAsync(['tax-number-lookups', '--country', 'DE', '--valid', 'true', '--limit', '5'], { from: 'user' });
    expect(m.mock.calls[0][0]).toBe('http://x/v1/tax-numbers/lookups?countryCode=DE&valid=true&limit=5');
  });
  it('tax-number-history posts repeated --number with asOf and includeChecks', async () => {
    const m = mockFetch();
    await createProgram().parseAsync(['tax-number-history', '--number', 'DE1', '--number', 'FR2', '--as-of', '2026-03-31', '--include-checks'], { from: 'user' });
    expect(m.mock.calls[0][0]).toBe('http://x/v1/tax-numbers/check-history');
    expect(JSON.parse((m.mock.calls[0][1] as { body: string }).body)).toEqual({ items: [{ taxNumber: 'DE1' }, { taxNumber: 'FR2' }], asOf: '2026-03-31', includeChecks: true });
  });
});
