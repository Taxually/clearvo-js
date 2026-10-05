// `clearvo obligations` builds GET /tax/obligations with country, status and includePreview. Mocked fetch.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createProgram } from '../src/program';

describe('clearvo obligations', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CLEARVO_API_KEY;
  const originalBaseUrl = process.env.CLEARVO_BASE_URL;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.CLEARVO_API_KEY = 'csk_test_testkey';
    process.env.CLEARVO_BASE_URL = 'http://x/v1';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.CLEARVO_API_KEY; else process.env.CLEARVO_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.CLEARVO_BASE_URL; else process.env.CLEARVO_BASE_URL = originalBaseUrl;
    logSpy.mockRestore();
  });

  it('lists with no filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ obligations: [], total: 0 }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await createProgram().parseAsync(['obligations'], { from: 'user' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/tax/obligations');
  });

  it('passes --country, --status and --include-preview as query params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ obligations: [], total: 0, previewObligations: [], previewTotal: 0 }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await createProgram().parseAsync(['obligations', '--country', 'EU', '--status', 'BREACH', '--include-preview'], { from: 'user' });
    const qs = new URL(fetchMock.mock.calls[0][0] as string).searchParams;
    expect(qs.get('country')).toBe('EU');
    expect(qs.get('status')).toBe('BREACH');
    expect(qs.get('includePreview')).toBe('true');
  });
});
