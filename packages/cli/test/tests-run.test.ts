// `clearvo tests run|status|cases` against mocked HTTP: request shapes, --wait polling, and exit code 1 on a failed run.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Command } from 'commander';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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

const res = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const run = (status: string, extra: Record<string, unknown> = {}) => ({
  runId: 'r1', name: 'CI', status, summary: { passed: 1, failed: status === 'failed' ? 1 : 0, waiting: 0, notRun: 0, notApplicable: 0, autoVerified: 1, selfAttested: 0, required: 2, requiredPassed: 1 },
  cases: status === 'failed' ? [{ title: 'Duplicate handled', outcome: 'failed', reason: 'A second document was created' }] : [],
  disclaimer: 'Simulated scenarios only.', ...extra,
});

describe('clearvo tests', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.CLEARVO_API_KEY;
  const originalBase = process.env.CLEARVO_BASE_URL;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.CLEARVO_API_KEY = 'csk_test_k';
    process.env.CLEARVO_BASE_URL = 'http://x/v1';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number): never => {
      throw new Error(`exit ${code}`);
    }) as never);
  });
  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.CLEARVO_API_KEY; else process.env.CLEARVO_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.CLEARVO_BASE_URL; else process.env.CLEARVO_BASE_URL = originalBase;
    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('run without --wait POSTs /test-runs with tags, cases, name and idempotency key, then returns', async () => {
    const f = vi.fn().mockResolvedValue(res({ runId: 'r1', status: 'running' }, 202));
    global.fetch = f as unknown as typeof fetch;
    await sub(createProgram(), 'tests', 'run').parseAsync(
      ['--name', 'CI', '--tag', 'automatic', '--tag', 'guided', '--case', 'a', '--deadline-minutes', '5', '--idempotency-key', 'k1'], { from: 'user' });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://x/v1/test-runs');
    expect(init.method).toBe('POST');
    expect(init.headers['x-idempotency-key']).toBe('k1');
    expect(JSON.parse(init.body)).toEqual({ name: 'CI', tags: ['automatic', 'guided'], caseIds: ['a'], deadlineMinutes: 5 });
  });

  it('--wait polls until the status is not queued or running, then prints the summary and exits 0 on passed', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res({ runId: 'r1', status: 'running' }, 202))
      .mockResolvedValueOnce(res(run('queued')))
      .mockResolvedValueOnce(res(run('running')))
      .mockResolvedValueOnce(res(run('passed')));
    global.fetch = f as unknown as typeof fetch;
    await sub(createProgram(), 'tests', 'run').parseAsync(['--wait', '--interval', '0'], { from: 'user' });
    expect(f).toHaveBeenCalledTimes(4);
    expect(f.mock.calls[1][0]).toBe('http://x/v1/test-runs/r1');
    expect(f.mock.calls[1][1].method).toBe('GET');
    expect(exitSpy).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.flat().join('\n')).toContain('PASSED');
  });

  it('--wait exits 1 when the run failed and names the failing test', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res({ runId: 'r1', status: 'running' }, 202))
      .mockResolvedValueOnce(res(run('failed')));
    global.fetch = f as unknown as typeof fetch;
    await expect(sub(createProgram(), 'tests', 'run').parseAsync(['--wait', '--interval', '0'], { from: 'user' })).rejects.toThrow('exit 1');
    expect(logSpy.mock.calls.flat().join('\n')).toContain('FAILED: Duplicate handled');
  });

  it('--wait stops polling on waiting (a run that needs your integration to act) and exits 0', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res({ runId: 'r1', status: 'running' }, 202))
      .mockResolvedValueOnce(res(run('waiting')));
    global.fetch = f as unknown as typeof fetch;
    await sub(createProgram(), 'tests', 'run').parseAsync(['--wait', '--interval', '0', '--json'], { from: 'user' });
    expect(f).toHaveBeenCalledTimes(2);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('status <id> GETs the run; a failed run read with status does not change the exit code', async () => {
    const f = vi.fn().mockResolvedValue(res(run('failed')));
    global.fetch = f as unknown as typeof fetch;
    await sub(createProgram(), 'tests', 'status').parseAsync(['r1'], { from: 'user' });
    expect(f.mock.calls[0][0]).toBe('http://x/v1/test-runs/r1');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('cases list GETs /test-cases', async () => {
    const f = vi.fn().mockResolvedValue(res({ cases: [] }));
    global.fetch = f as unknown as typeof fetch;
    await sub(createProgram(), 'tests', 'cases', 'list').parseAsync([], { from: 'user' });
    expect(f.mock.calls[0][0]).toBe('http://x/v1/test-cases');
  });

  it('cases create POSTs title, steps, expected and the parsed check', async () => {
    const f = vi.fn().mockResolvedValue(res({ id: 'c1' }, 201));
    global.fetch = f as unknown as typeof fetch;
    await sub(createProgram(), 'tests', 'cases', 'create').parseAsync(
      ['--title', 'T', '--step', 'one', '--step', 'two', '--expected', 'ok', '--check', '{"kind":"no_duplicate_created","params":{}}'], { from: 'user' });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://x/v1/test-cases');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ title: 'T', steps: ['one', 'two'], expected: 'ok', check: { kind: 'no_duplicate_created', params: {} } });
  });

  it('cases create with invalid --check JSON exits without calling the API', async () => {
    const f = vi.fn();
    global.fetch = f as unknown as typeof fetch;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(sub(createProgram(), 'tests', 'cases', 'create').parseAsync(
      ['--title', 'T', '--step', 'one', '--expected', 'ok', '--check', '{bad'], { from: 'user' })).rejects.toThrow('exit 1');
    expect(f).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('cases archive DELETEs /test-cases/{id}', async () => {
    const f = vi.fn().mockResolvedValue(res({ id: 'c1', archived: true }));
    global.fetch = f as unknown as typeof fetch;
    await sub(createProgram(), 'tests', 'cases', 'archive').parseAsync(['c1'], { from: 'user' });
    expect(f.mock.calls[0][0]).toBe('http://x/v1/test-cases/c1');
    expect(f.mock.calls[0][1].method).toBe('DELETE');
  });

  it('export GETs /test-runs/{id}/export with the id encoded and prints the record', async () => {
    const record = { format: 'test-run-record', version: 1, cases: [] };
    const f = vi.fn().mockResolvedValue(res(record));
    global.fetch = f as unknown as typeof fetch;
    await sub(createProgram(), 'tests', 'export').parseAsync(['a/b'], { from: 'user' });
    expect(f.mock.calls[0][0]).toBe('http://x/v1/test-runs/a%2Fb/export');
    expect(f.mock.calls[0][1].method).toBe('GET');
    expect(JSON.parse(logSpy.mock.calls.flat().join('\n'))).toEqual(record);
  });

  it('export --out writes the record to the file and prints only the path', async () => {
    const record = { format: 'test-run-record', version: 1, cases: [] };
    global.fetch = vi.fn().mockResolvedValue(res(record)) as unknown as typeof fetch;
    const file = join(mkdtempSync(join(tmpdir(), 'clearvo-export-')), 'record.json');
    await sub(createProgram(), 'tests', 'export').parseAsync(['r1', '--out', file], { from: 'user' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(record);
    expect(logSpy.mock.calls.flat().join('\n')).toBe(file);
  });
});
