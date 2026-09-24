// Coverage for `clearvo fr credentials set --tax-number` and
// `clearvo fr credentials get` argument parsing (docs/features/
// fr-credentials-api). Drives the real Commander commands defined in
// packages/cli/src/program.ts (via createProgram()) with a mocked
// global.fetch.
//
// Builds a FRESH program with createProgram() per test rather than reusing
// the module's shared `program` singleton — Commander does not reset a
// previously-parsed option's value when parseAsync() is called again on the
// same Command instance without that option, so reusing one instance across
// tests leaks e.g. --entity from an earlier case into a later one that omits
// it (confirmed empirically). This is Commander's own documented testing
// guidance ("use a new Command for each parse" when parsing more than once
// in a process), not specific to this CLI's own code.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Command } from 'commander';
import { createProgram } from '../src/program';

function findFrCredentialsCommand(program: Command, name: 'set' | 'get'): Command {
  const fr = program.commands.find((c) => c.name() === 'fr');
  if (!fr) throw new Error('expected a top-level "fr" command');
  const credentials = fr.commands.find((c) => c.name() === 'credentials');
  if (!credentials) throw new Error('expected an "fr credentials" subcommand');
  const cmd = credentials.commands.find((c) => c.name() === name);
  if (!cmd) throw new Error(`expected an "fr credentials ${name}" subcommand`);
  return cmd;
}

describe('clearvo fr credentials', () => {
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

  it('registers "set" with a required --tax-number option and an optional --entity option', () => {
    const set = findFrCredentialsCommand(createProgram(), 'set');
    const optionNames = set.options.map((o) => o.long);
    expect(optionNames).toContain('--tax-number');
    expect(optionNames).toContain('--entity');
    const taxNumberOpt = set.options.find((o) => o.long === '--tax-number')!;
    expect(taxNumberOpt.mandatory).toBe(true);
    const entityOpt = set.options.find((o) => o.long === '--entity')!;
    expect(entityOpt.mandatory).toBe(false);
  });

  it('registers "get" with only an optional --entity option (no --tax-number)', () => {
    const get = findFrCredentialsCommand(createProgram(), 'get');
    const optionNames = get.options.map((o) => o.long);
    expect(optionNames).not.toContain('--tax-number');
    expect(optionNames).toContain('--entity');
    const entityOpt = get.options.find((o) => o.long === '--entity')!;
    expect(entityOpt.mandatory).toBe(false);
  });

  it('"set --tax-number <n> --entity <id>" POSTs {taxNumber} to /fr/credentials with x-entity-id, not in the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, entityId: 'ent-1', taxNumber: 'FR34501692511', credentialStatus: 'pending_activation' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findFrCredentialsCommand(createProgram(), 'set').parseAsync(
      ['--tax-number', 'FR34501692511', '--entity', 'ent-1'],
      { from: 'user' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/fr/credentials');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    expect(opts.headers['x-api-key']).toBe('csk_live_testkey');
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({ taxNumber: 'FR34501692511' });
  });

  it('"set --tax-number <n>" (no --entity) omits the x-entity-id header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, entityId: 'ent-1', taxNumber: 'FR34501692511', credentialStatus: 'sandbox' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findFrCredentialsCommand(createProgram(), 'set').parseAsync(['--tax-number', 'FR34501692511'], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['x-entity-id']).toBeUndefined();
  });

  it('"set" without --tax-number exits without calling the API', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('process.exit called');
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(findFrCredentialsCommand(createProgram(), 'set').parseAsync([], { from: 'user' })).rejects.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('"get --entity <id>" issues a GET to /fr/credentials with x-entity-id and no body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, entityId: 'ent-1', taxNumber: null, credentialStatus: 'not_registered' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findFrCredentialsCommand(createProgram(), 'get').parseAsync(['--entity', 'ent-1'], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/fr/credentials');
    expect(opts.method).toBe('GET');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    expect(opts.body).toBeUndefined();
  });

  it('"get" (no --entity) omits the x-entity-id header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, entityId: 'ent-1', taxNumber: null, credentialStatus: 'not_registered' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findFrCredentialsCommand(createProgram(), 'get').parseAsync([], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['x-entity-id']).toBeUndefined();
  });

  it('"get --pretty" pretty-prints the JSON result', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, entityId: 'ent-1', taxNumber: null, credentialStatus: 'not_registered' }),
    }) as unknown as typeof fetch;

    await findFrCredentialsCommand(createProgram(), 'get').parseAsync(['--pretty'], { from: 'user' });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('\n');
  });
});
