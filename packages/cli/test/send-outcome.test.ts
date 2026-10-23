// `clearvo send`: POST /v1/send answers 200 with the outcome in the body. REJECTED / NEEDS_INFO exit non-zero
// (the old behaviour via the HTTP 422), print errors[] and nextStep, and still print the JSON body.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createProgram } from '../src/program';

const originalFetch = global.fetch;
const originalApiKey = process.env.CLEARVO_API_KEY;
const originalBaseUrl = process.env.CLEARVO_BASE_URL;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
let file: string;

beforeEach(() => {
  process.env.CLEARVO_API_KEY = 'csk_live_testkey';
  process.env.CLEARVO_BASE_URL = 'http://x/v1';
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  file = join(mkdtempSync(join(tmpdir(), 'clearvo-send-outcome-')), 'inv.json');
  writeFileSync(file, JSON.stringify({ country: 'IT', invoiceNumber: 'INV-1' }));
});
afterEach(() => {
  global.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.CLEARVO_API_KEY; else process.env.CLEARVO_API_KEY = originalApiKey;
  if (originalBaseUrl === undefined) delete process.env.CLEARVO_BASE_URL; else process.env.CLEARVO_BASE_URL = originalBaseUrl;
  vi.restoreAllMocks();
});

function reply(body: unknown, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body }) as unknown as typeof fetch;
}
const exitThrows = () => vi.spyOn(process, 'exit').mockImplementation(((code?: number): never => { throw new Error(`exit ${code}`); }) as never);
const run = (args: string[] = []) => createProgram().parseAsync(['send', file, ...args], { from: 'user' });
const stderr = () => errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
const stdout = () => logSpy.mock.calls.map((c) => c.join(' ')).join('\n');

const rejected = {
  ok: false, id: 'EI-IT-1', clearanceStatus: 'REJECTED', outcome: 'REJECTED', statusClass: 'DONE_REJECTED', terminal: true,
  nextStep: { actor: 'merchant', message: 'Fix the customer address', fixUrl: 'https://app.clearvo.io/x' },
  error: { code: 'MISSING_CUSTOMER_ADDRESS', message: 'Customer address is required' },
  errors: [{ errorCode: 'MISSING_CUSTOMER_ADDRESS', severity: 'ERROR', path: '/customer/address', message: 'Customer address is required' }],
};

describe('clearvo send outcome', () => {
  it('exits 1 on REJECTED, printing errors[], nextStep and the JSON body', async () => {
    reply(rejected);
    exitThrows();
    await expect(run()).rejects.toThrow('exit 1');
    expect(stdout()).toContain('"outcome":"REJECTED"');
    expect(stderr()).toContain('REJECTED');
    expect(stderr()).toContain('/customer/address MISSING_CUSTOMER_ADDRESS');
    expect(stderr()).toContain('Fix the customer address');
    expect(stderr()).toContain('https://app.clearvo.io/x');
  });

  it('exits 1 on NEEDS_INFO', async () => {
    reply({ ...rejected, clearanceStatus: 'NEEDS_INFO', outcome: 'NEEDS_INFO' });
    exitThrows();
    await expect(run()).rejects.toThrow('exit 1');
  });

  it('exits 1 on an UNROUTABLE NEEDS_INFO and tells the sender to fix the recipient', async () => {
    reply({ ok: false, id: 'EI-U', clearanceStatus: 'UNROUTABLE', outcome: 'NEEDS_INFO', nextStep: { actor: 'merchant', message: 'Recipient not reachable' } });
    exitThrows();
    await expect(run()).rejects.toThrow('exit 1');
    expect(stdout()).toContain('"outcome":"NEEDS_INFO"');
    expect(stderr()).toContain('fix the recipient');
  });

  it('exits 0 on PROCESSING and prints how to poll', async () => {
    reply({ ok: true, id: 'EI-P', clearanceStatus: 'RECEIVED', outcome: 'PROCESSING' });
    const exit = exitThrows();
    await run();
    expect(exit).not.toHaveBeenCalled();
    expect(stderr()).toContain('PROCESSING (EI-P)');
    expect(stderr()).toContain('clearvo status EI-P');
    expect(stderr()).toContain('invoice.status_changed');
  });

  it('exits 0 for UNDELIVERED (HELD) and for UNROUTABLE (NEEDS_INFO) with --no-throw-on-rejected', async () => {
    reply({ ok: true, id: 'EI-D', clearanceStatus: 'UNDELIVERED', outcome: 'HELD' });
    const exit = exitThrows();
    await run();
    reply({ ok: false, id: 'EI-U', clearanceStatus: 'UNROUTABLE', outcome: 'NEEDS_INFO' });
    await run(['--no-throw-on-rejected']);
    expect(exit).not.toHaveBeenCalled();
  });

  it('exits 0 for a stored rejection with --no-throw-on-rejected', async () => {
    reply(rejected);
    const exit = exitThrows();
    await run(['--no-throw-on-rejected']);
    expect(exit).not.toHaveBeenCalled();
    expect(stdout()).toContain('"outcome":"REJECTED"');
  });

  it('exits 0 for CLEARED, HELD, ACCUMULATED and RECEIVED', async () => {
    for (const body of [
      { ok: true, id: 'a', clearanceStatus: 'PENDING', outcome: 'CLEARED' },
      { ok: true, id: 'b', clearanceStatus: 'HELD_AWAITING_AUTHORIZATION', outcome: 'HELD', nextStep: { actor: 'platform', message: 'wait' } },
      { ok: true, id: 'c', clearanceStatus: 'ACCUMULATED', outcome: 'ACCUMULATED' },
      { ok: true, id: 'd', clearanceStatus: 'RECEIVED', warnings: [{ code: 'PROCESSING_DELAYED' }] },
    ]) {
      reply(body);
      const exit = exitThrows();
      await run();
      expect(exit).not.toHaveBeenCalled();
      vi.restoreAllMocks();
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    }
  });

  it('still exits non-zero on an HTTP error (3 for 401)', async () => {
    reply({ error: 'Invalid API key' }, 401);
    exitThrows();
    await expect(run()).rejects.toThrow('exit 3');
    expect(stderr()).toContain('HTTP 401');
  });
});
