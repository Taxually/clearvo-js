// `clearvo tax-number-history <file> [--as-of] [--include-checks]` posts to /tax-numbers/check-history.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const bodyOf = (m: ReturnType<typeof mockFetch>) => JSON.parse(m.mock.calls[0][1].body);
const file = () => {
  const f = join(mkdtempSync(join(tmpdir(), 'tnh-')), 'items.json');
  writeFileSync(f, JSON.stringify([{ taxNumber: 'DE123456789' }]));
  return f;
};

describe('tax-number-history', () => {
  it('sends items only by default', async () => {
    const m = mockFetch();
    await createProgram().parseAsync(['tax-number-history', file()], { from: 'user' });
    expect(m.mock.calls[0][0]).toBe('http://x/v1/tax-numbers/check-history');
    expect(m.mock.calls[0][1].method).toBe('POST');
    expect(bodyOf(m)).toEqual({ items: [{ taxNumber: 'DE123456789' }] });
  });

  it('sends asOf and includeChecks when given', async () => {
    const m = mockFetch();
    await createProgram().parseAsync(['tax-number-history', file(), '--as-of', '2026-03-31', '--include-checks'], { from: 'user' });
    expect(bodyOf(m)).toEqual({ items: [{ taxNumber: 'DE123456789' }], asOf: '2026-03-31', includeChecks: true });
  });
});
