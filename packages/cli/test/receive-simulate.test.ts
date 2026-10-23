// `clearvo receive simulate` against mocked HTTP: the request body, including --scenario.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Command } from 'commander';
import { createProgram } from '../src/program';

function sub(program: Command, ...path: string[]): Command {
  let cur = program;
  for (const name of path) {
    const next = cur.commands.find((c) => c.name() === name);
    if (!next) throw new Error(`no command ${path.join(' ')}`);
    cur = next;
  }
  return cur;
}

describe('clearvo receive simulate', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.CLEARVO_API_KEY;
  const originalBase = process.env.CLEARVO_BASE_URL;

  beforeEach(() => {
    process.env.CLEARVO_API_KEY = 'csk_test_k';
    process.env.CLEARVO_BASE_URL = 'http://x/v1';
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.CLEARVO_API_KEY; else process.env.CLEARVO_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.CLEARVO_BASE_URL; else process.env.CLEARVO_BASE_URL = originalBase;
    vi.restoreAllMocks();
  });

  it('posts the scenario with the other options', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await sub(createProgram(), 'receive', 'simulate').parseAsync(['--country', 'nl', '--type', 'credit_note', '--scenario', 'credit_note_for_existing', '--count', '2'], { from: 'user' });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/receive/simulate');
    expect(JSON.parse(opts.body as string)).toEqual({ country: 'NL', type: 'credit_note', scenario: 'credit_note_for_existing', count: 2 });
  });

  it('lists the scenarios in its help', () => {
    const help = sub(createProgram(), 'receive', 'simulate').helpInformation();
    expect(help).toContain('--scenario <id>');
    expect(help).toContain('needs_review_business_rules');
  });
});
