// Coverage for `clearvo business-status <id>` and `clearvo fr inbound poll`
// argument parsing (code review 2026-09-22, fr-credentials-api: these two
// backend endpoints pre-dated `fr credentials set`/`get` but never got
// MCP/SDK/CLI parity). Drives the real Commander commands defined in
// packages/cli/src/program.ts (via createProgram()) with a mocked
// global.fetch — same fresh-program-per-test convention as
// fr-credentials.test.ts (Commander does not reset a previously-parsed
// option across repeated parseAsync() calls on one instance).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Command } from 'commander';
import { createProgram } from '../src/program';

function findBusinessStatusCommand(program: Command): Command {
  const cmd = program.commands.find((c) => c.name() === 'business-status');
  if (!cmd) throw new Error('expected a top-level "business-status" command');
  return cmd;
}

function findFrInboundPollCommand(program: Command): Command {
  const fr = program.commands.find((c) => c.name() === 'fr');
  if (!fr) throw new Error('expected a top-level "fr" command');
  const inbound = fr.commands.find((c) => c.name() === 'inbound');
  if (!inbound) throw new Error('expected an "fr inbound" subcommand');
  const poll = inbound.commands.find((c) => c.name() === 'poll');
  if (!poll) throw new Error('expected an "fr inbound poll" subcommand');
  return poll;
}

describe('clearvo business-status', () => {
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

  it('registers a required --status option and optional --reason/--message/--entity options', () => {
    const cmd = findBusinessStatusCommand(createProgram());
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain('--status');
    expect(optionNames).toContain('--reason');
    expect(optionNames).toContain('--message');
    expect(optionNames).toContain('--entity');
    expect(cmd.options.find((o) => o.long === '--status')!.mandatory).toBe(true);
    expect(cmd.options.find((o) => o.long === '--reason')!.mandatory).toBe(false);
  });

  it('"<id> --status APPROVED" PATCHes /invoices/{id}/business-status with { status } only', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, businessStatus: 'APPROVED', updatedAt: '2026-09-22T00:00:00.000Z' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findBusinessStatusCommand(createProgram()).parseAsync(['inv-1', '--status', 'APPROVED'], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/invoices/inv-1/business-status');
    expect(opts.method).toBe('PATCH');
    expect(opts.headers['x-api-key']).toBe('csk_live_testkey');
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({ status: 'APPROVED' });
  });

  it('"<id> --status DISPUTED --reason <r> --message <m> --entity <id>" forwards rejectionDetail and the x-entity-id header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findBusinessStatusCommand(createProgram()).parseAsync(
      ['inv-1', '--status', 'DISPUTED', '--reason', 'wrong amount', '--message', 'total is off', '--entity', 'ent-1'],
      { from: 'user' },
    );

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({ status: 'DISPUTED', rejectionDetail: { reason: 'wrong amount', message: 'total is off' } });
  });

  it('without --status exits without calling the API', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('process.exit called');
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(findBusinessStatusCommand(createProgram()).parseAsync(['inv-1'], { from: 'user' })).rejects.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('"--pretty" pretty-prints the JSON result', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, businessStatus: 'APPROVED' }) }) as unknown as typeof fetch;

    await findBusinessStatusCommand(createProgram()).parseAsync(['inv-1', '--status', 'APPROVED', '--pretty'], { from: 'user' });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('\n');
  });
});

describe('clearvo fr inbound poll', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CLEARVO_API_KEY;
  const originalBaseUrl = process.env.CLEARVO_BASE_URL;

  beforeEach(() => {
    process.env.CLEARVO_API_KEY = 'csk_live_testkey';
    process.env.CLEARVO_BASE_URL = 'http://x/v1';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.CLEARVO_API_KEY; else process.env.CLEARVO_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.CLEARVO_BASE_URL; else process.env.CLEARVO_BASE_URL = originalBaseUrl;
  });

  it('registers only an optional --entity option', () => {
    const cmd = findFrInboundPollCommand(createProgram());
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain('--entity');
    expect(cmd.options.find((o) => o.long === '--entity')!.mandatory).toBe(false);
  });

  it('"--entity <id>" POSTs an empty body to /fr/inbound/poll with the x-entity-id header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, results: [], totalNewInvoices: 0 }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findFrInboundPollCommand(createProgram()).parseAsync(['--entity', 'ent-1'], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/fr/inbound/poll');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    expect(JSON.parse(opts.body as string)).toEqual({});
  });

  it('(no --entity) omits the x-entity-id header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, results: [], totalNewInvoices: 0 }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findFrInboundPollCommand(createProgram()).parseAsync([], { from: 'user' });

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['x-entity-id']).toBeUndefined();
  });
});
