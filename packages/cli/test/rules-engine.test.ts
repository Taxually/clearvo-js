// Coverage for `clearvo rules ...` / `clearvo adjustments ...` argument
// parsing and fetch behaviour (B7 propagation, docs/features/rules-engine/
// discovery.md). Drives the real Commander commands defined in
// packages/cli/src/program.ts (via createProgram()) with a mocked
// global.fetch — same "fresh program per test" convention as
// fr-credentials.test.ts (Commander does not reset a previously-parsed
// option's value across parseAsync() calls on the same Command instance).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Command } from 'commander';
import { createProgram } from '../src/program';

function findCommand(program: Command, path: string[]): Command {
  let current = program;
  for (const name of path) {
    const next = current.commands.find((c) => c.name() === name);
    if (!next) throw new Error(`expected a "${path.join(' ')}" command (missing "${name}")`);
    current = next;
  }
  return current;
}

describe('clearvo rules / adjustments CLI', () => {
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

  it('"rules schema" GETs /rules-engine/schema', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, schema: { schemaVersion: '1' } }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findCommand(createProgram(), ['rules', 'schema']).parseAsync([], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/schema');
    expect(opts.method).toBe('GET');
  });

  it('"rules list --domain ap --record-type calculation --entity ent-1" GETs with query params and x-entity-id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, rules: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findCommand(createProgram(), ['rules', 'list']).parseAsync(
      ['--domain', 'ap', '--record-type', 'calculation', '--entity', 'ent-1'],
      { from: 'user' },
    );

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules?domain=ap&recordType=calculation');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
  });

  it('"rules create" POSTs /rules-engine/rules with parsed --conditions/--actions JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, rule: { id: 'r1' }, created: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findCommand(createProgram(), ['rules', 'create']).parseAsync(
      [
        '--domain', 'ap', '--rule-kind', 'NORMALIZATION', '--code', 'X1', '--name', 'Test rule',
        '--conditions', '[{"property":"customerCountry","operator":"eq","value":"DE"}]',
        '--actions', '[{"property":"taxCategory","value":"digital_service"}]',
      ],
      { from: 'user' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({
      domain: 'ap', ruleKind: 'NORMALIZATION', code: 'X1', name: 'Test rule',
      conditions: [{ property: 'customerCountry', operator: 'eq', value: 'DE' }],
      actions: [{ property: 'taxCategory', value: 'digital_service' }],
    });
  });

  it('"rules create" exits without calling the API when --conditions is invalid JSON', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('process.exit called');
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      findCommand(createProgram(), ['rules', 'create']).parseAsync(
        ['--domain', 'ap', '--rule-kind', 'NORMALIZATION', '--code', 'X1', '--name', 'Test', '--conditions', 'not-json'],
        { from: 'user' },
      ),
    ).rejects.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('"rules update <id> --version 3 --enabled" PATCHes with { version, enabled: true }', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, rule: { id: 'r1', version: 4 } }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findCommand(createProgram(), ['rules', 'update']).parseAsync(['r1', '--version', '3', '--enabled'], { from: 'user' });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules/r1');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body as string)).toEqual({ version: 3, enabled: true });
  });

  it('"rules activate <id>" POSTs /rules-engine/rules/{id}/activate with an empty body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, rule: { id: 'r1', status: 'ACTIVE' } }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findCommand(createProgram(), ['rules', 'activate']).parseAsync(['r1'], { from: 'user' });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules/r1/activate');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({});
  });

  it('"rules simulate" without an id and without --draft exits without calling the API', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('process.exit called');
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(findCommand(createProgram(), ['rules', 'simulate']).parseAsync([], { from: 'user' })).rejects.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('"rules simulate <id> --sample-size 10" POSTs /rules-engine/rules/{id}/simulate', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, matchedCount: 1, sampleSize: 10, sample: [], conflicts: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findCommand(createProgram(), ['rules', 'simulate']).parseAsync(['r1', '--sample-size', '10'], { from: 'user' });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules/r1/simulate');
    expect(JSON.parse(opts.body as string)).toEqual({ sampleSize: 10 });
  });

  it('"rules simulate --draft <json>" (no id) POSTs /rules-engine/rules/simulate', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, matchedCount: 0, sampleSize: 50, sample: [], conflicts: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findCommand(createProgram(), ['rules', 'simulate']).parseAsync(
      ['--draft', '{"domain":"ap","ruleKind":"ENRICHMENT","conditions":[],"actions":[]}'],
      { from: 'user' },
    );

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules/simulate');
    const body = JSON.parse(opts.body as string);
    expect(body.draft).toEqual({ domain: 'ap', ruleKind: 'ENRICHMENT', conditions: [], actions: [] });
  });

  it('"rules datasets create" POSTs with keyColumns split from a comma-separated string', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, dataset: { id: 'd1' }, created: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findCommand(createProgram(), ['rules', 'datasets', 'create']).parseAsync(
      ['--dataset-key', 'gl_accounts', '--name', 'GL accounts', '--key-columns', 'glAccount,country'],
      { from: 'user' },
    );

    const [, opts] = fetchMock.mock.calls[0];
    expect(JSON.parse(opts.body as string)).toEqual({ datasetKey: 'gl_accounts', name: 'GL accounts', keyColumns: ['glAccount', 'country'] });
  });

  it('"rules datasets rows upsert <id> --row-data <json>" POSTs the parsed rowData', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, row: { id: 'row1' }, created: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findCommand(createProgram(), ['rules', 'datasets', 'rows', 'upsert']).parseAsync(
      ['d1', '--row-data', '{"glAccount":"4000","country":"DE"}', '--verified'],
      { from: 'user' },
    );

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/datasets/d1/rows');
    expect(JSON.parse(opts.body as string)).toEqual({ rowData: { glAccount: '4000', country: 'DE' }, verified: true });
  });

  it('"rules datasets rows delete <id> <rowKey>" DELETEs, URL-encoding the row key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findCommand(createProgram(), ['rules', 'datasets', 'rows', 'delete']).parseAsync(['d1', '4000/DE'], { from: 'user' });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/datasets/d1/rows/4000%2FDE');
    expect(opts.method).toBe('DELETE');
  });

  it('"rules datasets export <id>" prints raw CSV text, not JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'glAccount,country\n4000,DE\n' });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findCommand(createProgram(), ['rules', 'datasets', 'export']).parseAsync(['d1'], { from: 'user' });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/datasets/d1/export');
    expect(opts.method).toBe('GET');
    expect(logSpy).toHaveBeenCalledWith('glAccount,country\n4000,DE\n');
  });

  it('"rules mappings list --source-system xero" GETs with sourceSystem as a query param', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, rules: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findCommand(createProgram(), ['rules', 'mappings', 'list']).parseAsync(['--source-system', 'xero'], { from: 'user' });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/mappings?sourceSystem=xero');
  });

  it('"rules mappings reset --source-system xero" POSTs /rules-engine/mappings/reset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, rules: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findCommand(createProgram(), ['rules', 'mappings', 'reset']).parseAsync(['--source-system', 'xero'], { from: 'user' });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/mappings/reset?sourceSystem=xero');
    expect(opts.method).toBe('POST');
  });

  it('"rules trace --record-type calculation --record-id c1" GETs /rules-engine/trace with query params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, recordType: 'calculation', recordId: 'c1', entries: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findCommand(createProgram(), ['rules', 'trace']).parseAsync(['--record-type', 'calculation', '--record-id', 'c1'], { from: 'user' });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/trace?recordType=calculation&recordId=c1');
  });

  it('"adjustments propose <id> --mode FORCED_INPUT --original-value <json> --reason <r>" POSTs the expected body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, adjustmentId: 'adj1' }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findCommand(createProgram(), ['adjustments', 'propose']).parseAsync(
      [
        'calc1', '--mode', 'FORCED_INPUT',
        '--original-value', '{"taxCategory":null}',
        '--reason', 'Miscategorized at checkout',
        '--forced-inputs', '{"taxCategory":"digital_service"}',
        '--entity', 'ent-1',
      ],
      { from: 'user' },
    );

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/tax/calculate/calc1/adjustments');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({
      mode: 'FORCED_INPUT',
      originalValue: { taxCategory: null },
      reason: 'Miscategorized at checkout',
      forcedInputs: { taxCategory: 'digital_service' },
    });
  });

  it('"adjustments list <id> --status DRAFT" GETs with a status query param', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, adjustments: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findCommand(createProgram(), ['adjustments', 'list']).parseAsync(['calc1', '--status', 'DRAFT'], { from: 'user' });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/tax/calculate/calc1/adjustments?status=DRAFT');
  });

  it('"adjustments options <id>" GETs /tax/calculate/{id}/adjustment-options', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ modes: ['FORCED_INPUT', 'POST_CALCULATION_OVERRIDE'], targetTypes: [], forcedInputProperties: { header: [], line: [] }, overrideColumns: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findCommand(createProgram(), ['adjustments', 'options']).parseAsync(['calc1'], { from: 'user' });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/tax/calculate/calc1/adjustment-options');
    expect(opts.method).toBe('GET');
  });
});
