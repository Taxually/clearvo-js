// Coverage for `clearvo br credentials set/get`, `clearvo br inbound poll`,
// `clearvo br sync-status`, and `clearvo br settings update` argument parsing
// (Brazil NF-e receiving, Phase 1 + 1.5 — mirrors fr-credentials.test.ts /
// fr-business-status-inbound-poll.test.ts's shape and fresh-program-per-test
// convention: Commander does not reset a previously-parsed option across
// repeated parseAsync() calls on one instance).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Command } from 'commander';
import { createProgram } from '../src/program';

function findBrCommand(program: Command, path: string[]): Command {
  let cur: Command | undefined = program.commands.find((c) => c.name() === 'br');
  if (!cur) throw new Error('expected a top-level "br" command');
  for (const name of path) {
    cur = cur.commands.find((c) => c.name() === name);
    if (!cur) throw new Error(`expected a "br ${path.join(' ')}" subcommand (missing at "${name}")`);
  }
  return cur;
}

describe('clearvo br credentials', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CLEARVO_API_KEY;
  const originalBaseUrl = process.env.CLEARVO_BASE_URL;
  const pfxPath = join(tmpdir(), 'clearvo-cli-test-ecnpj.pfx');

  beforeEach(() => {
    process.env.CLEARVO_API_KEY = 'csk_live_testkey';
    process.env.CLEARVO_BASE_URL = 'http://x/v1';
    writeFileSync(pfxPath, Buffer.from([0x01, 0x02, 0x03, 0x04]));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.CLEARVO_API_KEY; else process.env.CLEARVO_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.CLEARVO_BASE_URL; else process.env.CLEARVO_BASE_URL = originalBaseUrl;
    try { unlinkSync(pfxPath); } catch { /* already gone */ }
  });

  it('registers "set" with required --pfx-file/--password/--consent and optional --auto-ciencia/--entity', () => {
    const set = findBrCommand(createProgram(), ['credentials', 'set']);
    const optionNames = set.options.map((o) => o.long);
    expect(optionNames).toContain('--pfx-file');
    expect(optionNames).toContain('--password');
    expect(optionNames).toContain('--consent');
    expect(optionNames).toContain('--auto-ciencia');
    expect(optionNames).toContain('--entity');
    expect(set.options.find((o) => o.long === '--pfx-file')!.mandatory).toBe(true);
    expect(set.options.find((o) => o.long === '--password')!.mandatory).toBe(true);
    expect(set.options.find((o) => o.long === '--consent')!.mandatory).toBe(true);
    expect(set.options.find((o) => o.long === '--auto-ciencia')!.mandatory).toBe(false);
  });

  it('"set --pfx-file <f> --password <p> --consent --entity <id>" reads the file, base64-encodes it, and POSTs to /br/credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, entityId: 'ent-1', cnpj: '12345678000199' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findBrCommand(createProgram(), ['credentials', 'set']).parseAsync(
      ['--pfx-file', pfxPath, '--password', 'secret', '--consent', '--entity', 'ent-1'],
      { from: 'user' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/br/credentials');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    const body = JSON.parse(opts.body as string);
    expect(body.pfxBase64).toBe(Buffer.from([0x01, 0x02, 0x03, 0x04]).toString('base64'));
    expect(body.password).toBe('secret');
    expect(body.consent).toBe(true);
    expect(body.autoCiencia).toBeUndefined();
  });

  it('"set ... --auto-ciencia false" forwards autoCiencia: false', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findBrCommand(createProgram(), ['credentials', 'set']).parseAsync(
      ['--pfx-file', pfxPath, '--password', 'secret', '--consent', '--auto-ciencia', 'false'],
      { from: 'user' },
    );

    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.autoCiencia).toBe(false);
  });

  it('"set" without --consent exits without calling the API', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('process.exit called');
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      findBrCommand(createProgram(), ['credentials', 'set']).parseAsync(
        ['--pfx-file', pfxPath, '--password', 'secret'],
        { from: 'user' },
      ),
    ).rejects.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('"get --entity <id>" issues a GET to /br/credentials with x-entity-id and no body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, entityId: 'ent-1' }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findBrCommand(createProgram(), ['credentials', 'get']).parseAsync(['--entity', 'ent-1'], { from: 'user' });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/br/credentials');
    expect(opts.method).toBe('GET');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    expect(opts.body).toBeUndefined();
  });
});

describe('clearvo br inbound poll / sync-status / settings update', () => {
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

  it('"br inbound poll --entity <id>" POSTs an empty body to /br/inbound/poll with x-entity-id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, entitiesPolled: 1, results: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findBrCommand(createProgram(), ['inbound', 'poll']).parseAsync(['--entity', 'ent-1'], { from: 'user' });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/br/inbound/poll');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    expect(JSON.parse(opts.body as string)).toEqual({});
  });

  it('"br sync-status --entity <id>" issues a GET to /br/sync-status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entityId: 'ent-1', status: 'ok' }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findBrCommand(createProgram(), ['sync-status']).parseAsync(['--entity', 'ent-1'], { from: 'user' });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/br/sync-status');
    expect(opts.method).toBe('GET');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
  });

  it('"br settings update --auto-ciencia false --entity <id>" PATCHes /br/settings with { autoCiencia: false }', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, autoCiencia: false }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findBrCommand(createProgram(), ['settings', 'update']).parseAsync(
      ['--auto-ciencia', 'false', '--entity', 'ent-1'],
      { from: 'user' },
    );

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/br/settings');
    expect(opts.method).toBe('PATCH');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    expect(JSON.parse(opts.body as string)).toEqual({ autoCiencia: false });
  });

  it('"br settings update" with neither --auto-ciencia nor --acknowledge-consent exits without calling the API', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('process.exit called');
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(findBrCommand(createProgram(), ['settings', 'update']).parseAsync([], { from: 'user' })).rejects.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // br-nfse-nacional B11 — NFS-e's own poll surface, documentFamily, and acknowledgeConsent.
  it('"br inbound poll --entity <id> --document-family nfse" POSTs to /br/nfse/inbound/poll', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, entitiesPolled: 1, results: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findBrCommand(createProgram(), ['inbound', 'poll']).parseAsync(
      ['--entity', 'ent-1', '--document-family', 'nfse'],
      { from: 'user' },
    );

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/br/nfse/inbound/poll');
  });

  it('"br inbound poll" with no --document-family still POSTs to the NF-e (SEFAZ) route, unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, entitiesPolled: 1, results: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findBrCommand(createProgram(), ['inbound', 'poll']).parseAsync([], { from: 'user' });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/br/inbound/poll');
  });

  it('"br sync-status --document-family nfse" forwards it as a query param', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entityId: 'ent-1', status: 'ok', documentFamily: 'nfse' }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findBrCommand(createProgram(), ['sync-status']).parseAsync(['--document-family', 'nfse'], { from: 'user' });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/br/sync-status?documentFamily=nfse');
  });

  it('"br settings update --acknowledge-consent" alone (no --auto-ciencia) PATCHes /br/settings with { acknowledgeConsent: true }', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, entityId: 'ent-1' }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findBrCommand(createProgram(), ['settings', 'update']).parseAsync(
      ['--acknowledge-consent', '--entity', 'ent-1'],
      { from: 'user' },
    );

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/br/settings');
    expect(JSON.parse(opts.body as string)).toEqual({ acknowledgeConsent: true });
  });
});
