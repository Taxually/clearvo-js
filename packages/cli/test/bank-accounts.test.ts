// `clearvo bank-accounts create|update --default` sends isDefault: true.

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
const run = (args: string[]) => createProgram().parseAsync(['bank-accounts', ...args], { from: 'user' });
const bodyOf = (m: ReturnType<typeof mockFetch>) => JSON.parse(m.mock.calls[0][1].body);

describe('bank-accounts --default', () => {
  it('create sends isDefault true only when --default is given', async () => {
    let m = mockFetch();
    await run(['create', '--iban', 'DE89370400440532013000', '--default']);
    expect(bodyOf(m)).toEqual({ iban: 'DE89370400440532013000', isDefault: true });
    m = mockFetch();
    await run(['create', '--iban', 'DE89370400440532013000']);
    expect(bodyOf(m)).toEqual({ iban: 'DE89370400440532013000' });
  });

  it('update --default sends isDefault true', async () => {
    const m = mockFetch();
    await run(['update', 'ba_1', '--default']);
    expect(m.mock.calls[0][1].method).toBe('PATCH');
    expect(bodyOf(m)).toEqual({ isDefault: true });
  });
});
