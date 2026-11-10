// `clearvo coverage` calls GET /v1/coverage.

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

describe('coverage', () => {
  it('GETs /coverage', async () => {
    const m = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, data: { countries: [] } }), text: async () => '{}' });
    global.fetch = m as unknown as typeof fetch;
    await createProgram().parseAsync(['coverage'], { from: 'user' });
    expect(m.mock.calls[0][0]).toBe('http://x/v1/coverage');
    expect((m.mock.calls[0][1] as { method: string }).method).toBe('GET');
  });
});
