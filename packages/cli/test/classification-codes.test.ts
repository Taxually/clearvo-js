// `clearvo products create/update --classification-code system:code` (repeatable)
// builds the API's classificationCodes array. Mocked fetch, fresh program per test.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('clearvo products --classification-code', () => {
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

  it('create sends repeated flags as classificationCodes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'p1' }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findCommand(createProgram(), ['products', 'create']).parseAsync(
      ['--name', 'Shirt', '--classification-code', 'stripe:txcd_10103001', '--classification-code', 'shopify:aa-1-13'],
      { from: 'user' },
    );

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/products');
    expect(JSON.parse(opts.body as string)).toEqual({
      name: 'Shirt',
      classificationCodes: [
        { system: 'stripe', code: 'txcd_10103001' },
        { system: 'shopify', code: 'aa-1-13' },
      ],
    });
  });

  it('update sends classificationCodes via PATCH', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'p1' }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findCommand(createProgram(), ['products', 'update']).parseAsync(
      ['p1', '--classification-code', 'hs:610910'],
      { from: 'user' },
    );

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/products/p1');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body as string)).toEqual({ classificationCodes: [{ system: 'hs', code: '610910' }] });
  });

  it('rejects a malformed value without calling the API', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('process.exit called');
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      findCommand(createProgram(), ['products', 'create']).parseAsync(
        ['--name', 'Shirt', '--classification-code', 'Stripe:txcd_1'],
        { from: 'user' },
      ),
    ).rejects.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
