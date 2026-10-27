// Bank accounts: explicit default (isDefault) on create and update.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';
import { ClearvoError } from '../src/types';

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function mock(body: unknown, status = 200) {
  const m = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  global.fetch = m as unknown as typeof fetch;
  return m;
}
const client = () => new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
const acct = { id: 'ba_1', currency: null, isDefault: true, iban: 'DE89370400440532013000', createdAt: 'x', updatedAt: 'x' };

describe('bank account default', () => {
  it('createBankAccount sends isDefault and returns it on the account', async () => {
    const m = mock({ bankAccount: acct }, 201);
    const out = await client().createBankAccount({ iban: acct.iban, isDefault: true });
    expect(JSON.parse(m.mock.calls[0][1].body)).toEqual({ iban: acct.iban, isDefault: true });
    expect(out.isDefault).toBe(true);
  });

  it('updateBankAccount sends isDefault: true', async () => {
    const m = mock(acct);
    await client().updateBankAccount('ba_1', { isDefault: true });
    expect(m.mock.calls[0][1].method).toBe('PATCH');
    expect(JSON.parse(m.mock.calls[0][1].body)).toEqual({ isDefault: true });
  });

  it('isDefault: false is a type error and the API refuses it with 422', async () => {
    // @ts-expect-error only true is accepted
    const bad: import('../src/types').UpdateBankAccountInput = { isDefault: false };
    mock({ error: { code: 'DEFAULT_BANK_ACCOUNT_REQUIRED', message: 'x' } }, 422);
    await expect(client().updateBankAccount('ba_1', bad)).rejects.toBeInstanceOf(ClearvoError);
  });
});
