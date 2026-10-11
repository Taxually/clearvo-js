// `clearvo calculate <file>` passes the flat AP line fields through untouched, and a
// BUILT_IN_PROPERTY_AS_CUSTOM rejection prints its Code. Mocked fetch, fresh program per test.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { createProgram } from '../src/program';

function findCommand(program: Command, path: string[]): Command {
  let current = program;
  for (const name of path) {
    const next = current.commands.find((c) => c.name() === name);
    if (!next) throw new Error(`missing command "${name}"`);
    current = next;
  }
  return current;
}

function writeBody(body: unknown): string {
  const file = join(mkdtempSync(join(tmpdir(), 'clearvo-cli-ap-')), 'calc.json');
  writeFileSync(file, JSON.stringify(body));
  return file;
}

describe('clearvo calculate with AP line fields', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CLEARVO_API_KEY;
  const originalBaseUrl = process.env.CLEARVO_BASE_URL;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.CLEARVO_API_KEY = 'csk_live_testkey';
    process.env.CLEARVO_BASE_URL = 'http://x/v1';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.CLEARVO_API_KEY; else process.env.CLEARVO_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.CLEARVO_BASE_URL; else process.env.CLEARVO_BASE_URL = originalBaseUrl;
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('sends glAccount/costCenter/intendedUse/accountAssignment as flat line fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ lineItems: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const body = {
      currency: 'EUR',
      lineItems: [{ id: '1', amount: 100, glAccount: '4000', costCenter: 'CC-7', intendedUse: 'resale', accountAssignment: 'K' }],
    };

    await findCommand(createProgram(), ['calculate']).parseAsync([writeBody(body), '--direction', 'purchase'], { from: 'user' });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/tax/calculate');
    expect(JSON.parse(opts.body as string)).toEqual({ ...body, transactionDirection: 'purchase' });
  });

  it('prints the Code line when a built-in field is sent under customProperties', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'built_in_property_as_custom', code: 'BUILT_IN_PROPERTY_AS_CUSTOM', hint: "use 'lineItems[0].glAccount'" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(
      findCommand(createProgram(), ['calculate']).parseAsync(
        [writeBody({ currency: 'EUR', lineItems: [{ id: '1', amount: 1, customProperties: { glAccount: '4000' } }] })],
        { from: 'user' },
      ),
    ).rejects.toThrow('exit');

    expect(String(errSpy.mock.calls[0][0])).toContain('HTTP 400: built_in_property_as_custom');
    expect(String(errSpy.mock.calls[0][0])).toContain('Code: BUILT_IN_PROPERTY_AS_CUSTOM');
    exitSpy.mockRestore();
  });
});
