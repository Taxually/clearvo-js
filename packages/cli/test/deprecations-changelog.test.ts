// `clearvo deprecations list`, `clearvo changelog list` (public routes, no API key needed) and the stderr deprecation warning.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createProgram, deprecationWarning } from '../src/program';

const originalFetch = global.fetch;
let logs: string[];
let errors: string[];
beforeEach(() => {
  process.env.CLEARVO_API_KEY = 'csk_live_testkey';
  process.env.CLEARVO_BASE_URL = 'http://x/v1';
  delete process.env.CLEARVO_NO_DEPRECATION_WARNINGS;
  logs = []; errors = [];
  vi.spyOn(console, 'log').mockImplementation((m: unknown) => { logs.push(String(m)); });
  vi.spyOn(console, 'error').mockImplementation((m: unknown) => { errors.push(String(m)); });
});
afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

const ok = (body: unknown, headers: Record<string, string> = {}) => ({ ok: true, status: 200, headers: new Headers(headers), json: async () => body, text: async () => '{}' });

describe('deprecations list', () => {
  it('GETs /deprecations and prints the JSON', async () => {
    const m = vi.fn().mockResolvedValue(ok({ ok: true, data: [] }));
    global.fetch = m as unknown as typeof fetch;
    await createProgram().parseAsync(['deprecations', 'list'], { from: 'user' });
    expect(m.mock.calls[0][0]).toBe('http://x/v1/deprecations');
    expect(logs[0]).toBe('{"ok":true,"data":[]}');
  });
  it('works without an API key (sends none)', async () => {
    delete process.env.CLEARVO_API_KEY;
    process.env.HOME = '/nonexistent-home-for-test';
    const m = vi.fn().mockResolvedValue(ok({ ok: true, data: [] }));
    global.fetch = m as unknown as typeof fetch;
    await createProgram().parseAsync(['deprecations', 'list'], { from: 'user' });
    expect((m.mock.calls[0][1] as { headers: Record<string, string> }).headers['x-api-key']).toBeUndefined();
  });
});

describe('changelog list', () => {
  it('passes --limit and --cursor', async () => {
    const m = vi.fn().mockResolvedValue(ok({ ok: true, data: [], nextCursor: null }));
    global.fetch = m as unknown as typeof fetch;
    await createProgram().parseAsync(['changelog', 'list', '--limit', '5', '--cursor', 'abc'], { from: 'user' });
    expect(m.mock.calls[0][0]).toBe('http://x/v1/changelog?limit=5&cursor=abc');
  });
  it('--all follows nextCursor', async () => {
    const m = vi.fn()
      .mockResolvedValueOnce(ok({ ok: true, data: [{ id: 'a' }], nextCursor: 'c1' }))
      .mockResolvedValueOnce(ok({ ok: true, data: [{ id: 'b' }], nextCursor: null }));
    global.fetch = m as unknown as typeof fetch;
    await createProgram().parseAsync(['changelog', 'list', '--all'], { from: 'user' });
    expect(m.mock.calls[1][0]).toBe('http://x/v1/changelog?cursor=c1');
    expect(JSON.parse(logs[0]).data.map((e: { id: string }) => e.id)).toEqual(['a', 'b']);
  });
});

describe('deprecation warning', () => {
  const headers = { Deprecation: '@1767225600', Sunset: 'Wed, 01 Apr 2026 00:00:00 GMT', Link: '</v1/deprecations>; rel="deprecation", </v1/new>; rel="successor-version"' };
  it('is built from the headers', () => {
    const w = deprecationWarning(new Headers(headers), 'GET', '/entities/E123', 'http://x/v1');
    expect(w?.surface).toBe('GET /v1/entities/{id}');
    expect(w?.message).toContain('2026-04-01');
    expect(w?.message).toContain('http://x/v1/new');
  });
  it('prints once per surface to stderr, not stdout', async () => {
    const m = vi.fn().mockResolvedValue(ok({ ok: true, data: { countries: [] } }, headers));
    global.fetch = m as unknown as typeof fetch;
    const program = createProgram();
    await program.parseAsync(['coverage'], { from: 'user' });
    await program.parseAsync(['coverage'], { from: 'user' });
    expect(errors.filter(e => e.includes('GET /v1/coverage'))).toHaveLength(1);
    expect(logs.every(l => !l.includes('deprecated'))).toBe(true);
  });
  it('can be silenced', async () => {
    process.env.CLEARVO_NO_DEPRECATION_WARNINGS = '1';
    global.fetch = vi.fn().mockResolvedValue(ok({ ok: true }, headers)) as unknown as typeof fetch;
    await createProgram().parseAsync(['coverage'], { from: 'user' });
    expect(errors).toHaveLength(0);
  });
});
