// Coverage for `clearvo fr connect-link` — POST /v1/fr/platform-connect-link. Drives the real Commander command
// (via createProgram()) with a mocked global.fetch; a fresh program per test (see fr-credentials.test.ts for why).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Command } from 'commander';
import { createProgram } from '../src/program';

function findConnectLinkCommand(program: Command): Command {
  const fr = program.commands.find((c) => c.name() === 'fr');
  if (!fr) throw new Error('expected a top-level "fr" command');
  const cmd = fr.commands.find((c) => c.name() === 'connect-link');
  if (!cmd) throw new Error('expected an "fr connect-link" subcommand');
  return cmd;
}

describe('clearvo fr connect-link', () => {
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

  it('requires --return-url and offers optional --login-hint, --capability and --entity', () => {
    const cmd = findConnectLinkCommand(createProgram());
    const returnUrl = cmd.options.find((o) => o.long === '--return-url')!;
    expect(returnUrl.mandatory).toBe(true);
    for (const flag of ['--login-hint', '--capability', '--entity']) {
      const opt = cmd.options.find((o) => o.long === flag);
      expect(opt, flag).toBeTruthy();
      expect(opt!.mandatory).toBe(false);
    }
  });

  it('POSTs returnUrl, loginHint and requestedCapability to /fr/platform-connect-link with x-entity-id in the header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, connectUrl: 'https://connect.example/start/abc' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findConnectLinkCommand(createProgram()).parseAsync(
      ['--return-url', 'https://app.example.com/return', '--login-hint', 'director@customer.example', '--capability', 'receive', '--entity', 'ent-1'],
      { from: 'user' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/fr/platform-connect-link');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    expect(JSON.parse(opts.body as string)).toEqual({
      returnUrl: 'https://app.example.com/return',
      loginHint: 'director@customer.example',
      requestedCapability: 'receive',
    });
  });

  it('sends only returnUrl and no x-entity-id header when the optional flags are omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, connectUrl: 'https://connect.example/start/abc' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findConnectLinkCommand(createProgram()).parseAsync(['--return-url', 'https://app.example.com/return'], { from: 'user' });

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['x-entity-id']).toBeUndefined();
    expect(JSON.parse(opts.body as string)).toEqual({ returnUrl: 'https://app.example.com/return' });
  });
});
