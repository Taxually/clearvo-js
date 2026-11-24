// Coverage for `clearvo ae appointment` and `clearvo ae appointment request`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Command } from 'commander';
import { createProgram } from '../src/program';

function findAppointment(program: Command): Command {
  const ae = program.commands.find((c) => c.name() === 'ae');
  if (!ae) throw new Error('expected a top-level "ae" command');
  const cmd = ae.commands.find((c) => c.name() === 'appointment');
  if (!cmd) throw new Error('expected an "ae appointment" subcommand');
  return cmd;
}

describe('clearvo ae appointment', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CLEARVO_API_KEY;
  const originalBaseUrl = process.env.CLEARVO_BASE_URL;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.CLEARVO_API_KEY = 'csk_live_testkey';
    process.env.CLEARVO_BASE_URL = 'http://x/v1';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.CLEARVO_API_KEY; else process.env.CLEARVO_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.CLEARVO_BASE_URL; else process.env.CLEARVO_BASE_URL = originalBaseUrl;
    logSpy.mockRestore();
  });

  function mock() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'not_appointed', providerName: 'Taxually', instructions: ['Step 1'] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it('reads the appointment with GET and x-entity-id', async () => {
    const fetchMock = mock();
    await findAppointment(createProgram()).parseAsync(['--entity', 'ent-1'], { from: 'user' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/ae/provider-appointment');
    expect(opts.method).toBe('GET');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
  });

  it('request POSTs to /ae/provider-appointment/request', async () => {
    const fetchMock = mock();
    const cmd = findAppointment(createProgram()).commands.find((c) => c.name() === 'request')!;
    await cmd.parseAsync(['--entity', 'ent-1'], { from: 'user' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/ae/provider-appointment/request');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
  });
});
