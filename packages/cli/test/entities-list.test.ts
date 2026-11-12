// `clearvo entities list --tax-number` sends the taxNumber filter.

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
const run = (args: string[]) => createProgram().parseAsync(['entities', ...args], { from: 'user' });

describe('entities list --tax-number', () => {
  it('adds the encoded filter only when given', async () => {
    let m = mockFetch();
    await run(['list']);
    expect(m.mock.calls[0][0]).toBe('http://x/v1/entities');
    m = mockFetch();
    await run(['list', '--tax-number', 'DE 1234-56788']);
    expect(m.mock.calls[0][0]).toBe('http://x/v1/entities?taxNumber=DE%201234-56788');
  });
});
