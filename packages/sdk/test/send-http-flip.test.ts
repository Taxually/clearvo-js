// POST /v1/send answers 200 for every stored document: the outcome is in the body. throwOnRejected (default true,
// for one SDK major) keeps the old throw on REJECTED / NEEDS_INFO; 4xx / 5xx always throw.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient, ClearvoError, isRejected } from '../src/index';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function reply(status: number, body: unknown) {
  const m = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
  global.fetch = m as unknown as typeof fetch;
  return m;
}

const input = { country: 'IT', invoiceNumber: 'INV-1' } as never;

const rejected = {
  ok: false,
  id: 'EI-IT-1',
  referenceId: 'EI-IT-1',
  clearanceStatus: 'REJECTED',
  outcome: 'REJECTED',
  statusClass: 'DONE_REJECTED',
  terminal: true,
  nextStep: { actor: 'merchant', message: 'Fix the customer address', fixUrl: 'https://app.clearvo.io/x' },
  error: { code: 'MISSING_CUSTOMER_ADDRESS', message: 'Customer address is required', fixUrl: 'https://app.clearvo.io/x', isMerchantResolvable: true, retryable: false },
  errors: [{ errorCode: 'MISSING_CUSTOMER_ADDRESS', severity: 'ERROR', path: '/customer/address', message: 'Customer address is required' }],
};
const needsInfo = { ...rejected, clearanceStatus: 'NEEDS_INFO', outcome: 'NEEDS_INFO', statusClass: 'WAIT_MERCHANT', terminal: false };
const cleared = { ok: true, id: 'EI-IT-2', referenceId: 'EI-IT-2', status: 'PENDING', clearanceStatus: 'PENDING', outcome: 'CLEARED', statusClass: 'IN_FLIGHT', terminal: false, nextStep: null };

describe('submitInvoice with a 200 body', () => {
  it('throws ClearvoError on REJECTED by default, with the body, code and errors', async () => {
    reply(200, rejected);
    const client = new ClearvoClient({ apiKey: 'k', baseUrl: 'http://x/v1' });
    const err = await client.submitInvoice(input).catch((e) => e);
    expect(err).toBeInstanceOf(ClearvoError);
    expect(err.status).toBe(422);
    expect(err.code).toBe('MISSING_CUSTOMER_ADDRESS');
    expect(err.message).toBe('Customer address is required');
    expect(err.errors).toHaveLength(1);
    expect(err.body.outcome).toBe('REJECTED');
    expect(err.body.id).toBe('EI-IT-1');
  });

  it('throws on NEEDS_INFO by default', async () => {
    reply(200, needsInfo);
    const client = new ClearvoClient({ apiKey: 'k', baseUrl: 'http://x/v1' });
    await expect(client.submitInvoice(input)).rejects.toBeInstanceOf(ClearvoError);
  });

  it('returns the body for REJECTED when throwOnRejected is false (client option)', async () => {
    reply(200, rejected);
    const client = new ClearvoClient({ apiKey: 'k', baseUrl: 'http://x/v1', throwOnRejected: false });
    const out = await client.submitInvoice(input);
    expect(out.outcome).toBe('REJECTED');
    expect(out.ok).toBe(false);
    expect(out.clearanceStatus).toBe('REJECTED');
    expect(out.errors?.[0].errorCode).toBe('MISSING_CUSTOMER_ADDRESS');
    expect(out.error?.fixUrl).toBe('https://app.clearvo.io/x');
    expect(isRejected(out)).toBe(true);
  });

  it('a per-call option overrides the client option', async () => {
    reply(200, rejected);
    const lenient = new ClearvoClient({ apiKey: 'k', baseUrl: 'http://x/v1', throwOnRejected: false });
    await expect(lenient.submitInvoice(input, undefined, { throwOnRejected: true })).rejects.toBeInstanceOf(ClearvoError);
    reply(200, rejected);
    const strict = new ClearvoClient({ apiKey: 'k', baseUrl: 'http://x/v1' });
    const out = await strict.submitInvoice(input, undefined, { throwOnRejected: false });
    expect(out.outcome).toBe('REJECTED');
  });

  it('does not throw for accepted, held, accumulated, RECEIVED-with-warning and NO_OBLIGATION outcomes', async () => {
    const client = new ClearvoClient({ apiKey: 'k', baseUrl: 'http://x/v1' });
    for (const body of [
      cleared,
      { ok: true, id: 'a', clearanceStatus: 'HELD_AWAITING_AUTHORIZATION', outcome: 'HELD', statusClass: 'WAIT_PLATFORM', terminal: false },
      { ok: true, id: 'b', clearanceStatus: 'ACCUMULATED', outcome: 'ACCUMULATED', batchId: 'b1' },
      { ok: true, id: 'c', clearanceStatus: 'RECEIVED', warnings: [{ code: 'PROCESSING_DELAYED', message: 'retrying' }] },
      { ok: true, id: 'd', clearanceStatus: 'NOT_SUPPORTED', outcome: 'NO_OBLIGATION', terminal: true },
    ]) {
      reply(200, body);
      const out = await client.submitInvoice(input);
      expect(isRejected(out)).toBe(false);
      expect(out.id).toBe((body as { id: string }).id);
    }
  });

  it('ACCUMULATED answered 200 and the legacy 202 both return the body', async () => {
    const client = new ClearvoClient({ apiKey: 'k', baseUrl: 'http://x/v1' });
    for (const status of [200, 202]) {
      reply(status, { ok: true, id: 'b', clearanceStatus: 'ACCUMULATED', outcome: 'ACCUMULATED', batchId: 'b1' });
      const out = await client.submitInvoice(input);
      expect(out.outcome).toBe('ACCUMULATED');
    }
  });

  it('a dry-run rejection (200, ok:false, dryRun:true) throws by default', async () => {
    reply(200, { ...rejected, dryRun: true, id: undefined });
    const client = new ClearvoClient({ apiKey: 'k', baseUrl: 'http://x/v1' });
    await expect(client.submitInvoice({ ...(input as object), dryRun: true } as never)).rejects.toBeInstanceOf(ClearvoError);
  });

  it('falls back to clearanceStatus when outcome is absent', async () => {
    reply(200, { ok: false, clearanceStatus: 'REJECTED', error: { code: 'X', message: 'bad' } });
    const client = new ClearvoClient({ apiKey: 'k', baseUrl: 'http://x/v1', throwOnRejected: false });
    expect(isRejected(await client.submitInvoice(input))).toBe(true);
  });
});

describe('submitInvoice keeps throwing for 4xx and 5xx', () => {
  it.each([
    [400, { error: 'country is required' }],
    [401, { error: 'Invalid API key' }],
    [403, { error: 'solution_not_enabled' }],
    [409, { error: { code: 'IDEMPOTENT_BODY_MISMATCH', message: 'edited resend' } }],
    [429, { error: 'rate limited' }],
    [503, { error: { code: 'INGEST_UNAVAILABLE', message: 'retry with the same body' } }],
  ])('%i throws ClearvoError even with throwOnRejected false', async (status, body) => {
    reply(status, body);
    const client = new ClearvoClient({ apiKey: 'k', baseUrl: 'http://x/v1', throwOnRejected: false });
    const err = await client.submitInvoice(input).catch((e) => e);
    expect(err).toBeInstanceOf(ClearvoError);
    expect(err.status).toBe(status);
  });
});
