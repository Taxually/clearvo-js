// listDeprecations / listChangelog / iterateChangelog (GET /v1/deprecations, /v1/changelog) and the client-side
// deprecation awareness (Deprecation / Sunset / Link response headers).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient, parseDeprecationHeaders } from '../src/index';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function res(body: unknown, headers: Record<string, string> = {}, status = 200) {
  return { ok: status < 400, status, headers: new Headers(headers), json: async () => body };
}
function mockFetch(...responses: unknown[]) {
  const m = vi.fn();
  for (const r of responses) m.mockResolvedValueOnce(r);
  global.fetch = m as unknown as typeof fetch;
  return m;
}
const client = (opts = {}) => new ClearvoClient({ apiKey: 'csk_test_x', baseUrl: 'http://x/v1', ...opts });

const DEPRECATED = {
  Deprecation: '@1767225600',
  Sunset: 'Wed, 01 Apr 2026 00:00:00 GMT',
  Link: '</v1/deprecations>; rel="deprecation", </v1/new/path>; rel="successor-version"',
};

describe('listDeprecations', () => {
  it('GETs /deprecations', async () => {
    const body = { ok: true, data: [{ id: 'd1', kind: 'endpoint', surface: 'GET /v1/old/{id}', replacement: '/v1/new', deprecatedAt: '2026-01-01', sunsetAt: '2026-04-01', sandboxFrom: null, notice: 'n', emergency: false, emergencyReason: null, daysLeft: 12 }] };
    const m = mockFetch(res(body));
    const out = await client().listDeprecations();
    expect(m.mock.calls[0][0]).toBe('http://x/v1/deprecations');
    expect(m.mock.calls[0][1].method).toBe('GET');
    expect(out.data[0].daysLeft).toBe(12);
  });
});

describe('listChangelog', () => {
  it('sends limit and cursor', async () => {
    const m = mockFetch(res({ ok: true, data: [], nextCursor: null }));
    await client().listChangelog({ limit: 5, cursor: 'abc' });
    expect(m.mock.calls[0][0]).toBe('http://x/v1/changelog?limit=5&cursor=abc');
  });
  it('sends no query by default', async () => {
    const m = mockFetch(res({ ok: true, data: [], nextCursor: null }));
    await client().listChangelog();
    expect(m.mock.calls[0][0]).toBe('http://x/v1/changelog');
  });
  it('iterateChangelog follows nextCursor until null', async () => {
    const e = (id: string) => ({ id, title: id, summary: 's', category: 'improvement', publishedAt: '2026-01-01T00:00:00Z' });
    const m = mockFetch(res({ ok: true, data: [e('a'), e('b')], nextCursor: 'c1' }), res({ ok: true, data: [e('c')], nextCursor: null }));
    const ids: string[] = [];
    for await (const entry of client().iterateChangelog({ limit: 2 })) ids.push(entry.id);
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(m.mock.calls[1][0]).toBe('http://x/v1/changelog?limit=2&cursor=c1');
  });
});

describe('deprecation awareness', () => {
  it('parses the headers', () => {
    const info = parseDeprecationHeaders(new Headers(DEPRECATED), 'get', '/invoices/EI-DE-123/fix?x=1', 'http://api.test/v1');
    expect(info).toEqual({
      surface: 'GET /v1/invoices/{id}/fix',
      deprecatedAt: '2026-01-01T00:00:00.000Z',
      sunsetAt: '2026-04-01T00:00:00.000Z',
      replacement: 'http://api.test/v1/new/path',
      noticeUrl: 'http://api.test/v1/deprecations',
    });
  });
  it('returns null without the headers', () => {
    expect(parseDeprecationHeaders(new Headers(), 'GET', '/x')).toBeNull();
  });
  it('warns once per surface with surface, sunset and replacement', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch(res({}, DEPRECATED), res({}, DEPRECATED), res({}, DEPRECATED));
    const c = client();
    await c.listCountryCoverage();
    await c.listCountryCoverage();
    expect(warn).toHaveBeenCalledTimes(1);
    const text = String(warn.mock.calls[0][0]);
    expect(text).toContain('GET /v1/coverage');
    expect(text).toContain('2026-04-01');
    expect(text).toContain('/v1/new/path');
    await c.getEntity('abc1');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(c.getDeprecations()).toHaveLength(2);
  });
  it('calls onDeprecation instead of console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: string[] = [];
    mockFetch(res({}, DEPRECATED));
    await client({ onDeprecation: (i: { surface: string }) => seen.push(i.surface) }).listCountryCoverage();
    expect(seen).toEqual(['GET /v1/coverage']);
    expect(warn).not.toHaveBeenCalled();
  });
  it('is silent with onDeprecation false but still records', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch(res({}, DEPRECATED));
    const c = client({ onDeprecation: false });
    await c.listCountryCoverage();
    expect(warn).not.toHaveBeenCalled();
    expect(c.getDeprecations()).toHaveLength(1);
  });
  it('does not warn without the headers, and a throwing callback never fails the call', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch(res({ ok: true }), res({ ok: true }, DEPRECATED));
    const c = client({ onDeprecation: () => { throw new Error('boom'); } });
    await c.listCountryCoverage();
    await expect(c.listCountryCoverage()).resolves.toBeTruthy();
    expect(warn).not.toHaveBeenCalled();
  });
});
