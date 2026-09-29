// Coverage for B7 propagation (docs/features/rules-engine/discovery.md,
// focus-eng-lead.md §1.N.4) — SDK twins of every /v1/rules-engine/*
// operation (docs/openapi/rules-engine.yaml on the backend) plus the AP
// manual-adjustments surface. Each test asserts the exact path/method/body
// the SDK method sends against a mocked fetch, mirroring this repo's
// existing fr-credentials.test.ts/fr-business-status-inbound-poll.test.ts
// convention.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';

function mockFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('ClearvoClient rules engine', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('getRulesEngineSchema GETs /rules-engine/schema', async () => {
    const fetchMock = mockFetch({ ok: true, schema: { schemaVersion: '1', domains: ['ap', 'ar'] } });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const result = await client.getRulesEngineSchema();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/schema');
    expect(opts.method).toBe('GET');
    expect(result.schema.schemaVersion).toBe('1');
  });

  it('listRules GETs /rules-engine/rules with domain/recordType query params and x-entity-id header', async () => {
    const fetchMock = mockFetch({ ok: true, rules: [] });
    const client = new ClearvoClient({ apiKey: 'csk_live_acct_x', baseUrl: 'http://x/v1' });
    await client.listRules({ domain: 'ap', recordType: 'calculation', entityId: 'ent-1' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules?domain=ap&recordType=calculation');
    expect(opts.method).toBe('GET');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
  });

  it('listRules omits the query string and x-entity-id header when no params are given', async () => {
    const fetchMock = mockFetch({ ok: true, rules: [] });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.listRules();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules');
    expect(opts.headers['x-entity-id']).toBeUndefined();
  });

  it('listRules GETs with direction/conditionProperty/conditionValue query params', async () => {
    const fetchMock = mockFetch({ ok: true, rules: [] });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.listRules({ direction: 'sale', conditionProperty: 'customerCountry', conditionValue: 'DE' });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules?direction=sale&conditionProperty=customerCountry&conditionValue=DE');
  });

  it('listRules sends includeDefaults as the literal string "1", not "true", and passes defaults/defaultsCount through', async () => {
    const fetchMock = mockFetch({ ok: true, rules: [], defaults: [{ id: 'd1' }], defaultsCount: 1 });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const result = await client.listRules({ includeDefaults: true });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules?includeDefaults=1');
    expect(result.defaultsCount).toBe(1);
  });

  it('listRules omits includeDefaults from the query string when false', async () => {
    const fetchMock = mockFetch({ ok: true, rules: [] });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.listRules({ includeDefaults: false });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules');
  });

  it('getRule GETs /rules-engine/rules/{id}, URL-encoding the id', async () => {
    const fetchMock = mockFetch({ ok: true, rule: { id: 'r/1' } });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.getRule('r/1');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules/r%2F1');
  });

  it('createRule POSTs /rules-engine/rules with the body, forwarding entityId as a header not a body field', async () => {
    const fetchMock = mockFetch({ ok: true, rule: { id: 'r1' }, created: true }, 201);
    const client = new ClearvoClient({ apiKey: 'csk_live_acct_x', baseUrl: 'http://x/v1' });
    const result = await client.createRule({
      domain: 'ap', ruleKind: 'NORMALIZATION', code: 'X1', name: 'Test rule', entityId: 'ent-1',
    });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({ domain: 'ap', ruleKind: 'NORMALIZATION', code: 'X1', name: 'Test rule' });
    expect(body).not.toHaveProperty('entityId');
    expect(result.created).toBe(true);
  });

  it('updateRule PATCHes /rules-engine/rules/{id} with version required in the body', async () => {
    const fetchMock = mockFetch({ ok: true, rule: { id: 'r1', version: 2 } });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.updateRule('r1', { version: 1, enabled: false });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules/r1');
    expect(opts.method).toBe('PATCH');
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({ version: 1, enabled: false });
  });

  it('activateRule POSTs /rules-engine/rules/{id}/activate with an empty body', async () => {
    const fetchMock = mockFetch({ ok: true, rule: { id: 'r1', status: 'ACTIVE' } });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.activateRule('r1');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules/r1/activate');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({});
  });

  it('moveRule POSTs /rules-engine/rules/{id}/move with { sortOrder }', async () => {
    const fetchMock = mockFetch({ ok: true, rule: { id: 'r1', sortOrder: 5 } });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.moveRule('r1', 5);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules/r1/move');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({ sortOrder: 5 });
  });

  it('suppressRule POSTs /rules-engine/rules/{id}/suppress with a reason, forwarding entityId as a header not a body field', async () => {
    const fetchMock = mockFetch({ ok: true, suppressed: true });
    const client = new ClearvoClient({ apiKey: 'csk_live_acct_x', baseUrl: 'http://x/v1' });
    const result = await client.suppressRule('r1', { reason: 'Not applicable to our supply chain', entityId: 'ent-1' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules/r1/suppress');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({ reason: 'Not applicable to our supply chain' });
    expect(body).not.toHaveProperty('entityId');
    expect(result.suppressed).toBe(true);
  });

  it('suppressRule POSTs an empty body when no reason is given', async () => {
    const fetchMock = mockFetch({ ok: true, suppressed: true });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.suppressRule('r1');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules/r1/suppress');
    expect(JSON.parse(opts.body as string)).toEqual({});
  });

  it('unsuppressRule DELETEs /rules-engine/rules/{id}/suppress', async () => {
    const fetchMock = mockFetch({ ok: true, suppressed: false });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const result = await client.unsuppressRule('r1', 'ent-1');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules/r1/suppress');
    expect(opts.method).toBe('DELETE');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    expect(result.suppressed).toBe(false);
  });

  it('listRuleVersions GETs /rules-engine/rules/{id}/versions', async () => {
    const fetchMock = mockFetch({ ok: true, versions: [] });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.listRuleVersions('r1');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules/r1/versions');
    expect(opts.method).toBe('GET');
  });

  it('simulateRule POSTs /rules-engine/rules/{id}/simulate with sampleSize in the body', async () => {
    const fetchMock = mockFetch({ ok: true, matchedCount: 3, sampleSize: 50, sample: [], conflicts: [] });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const result = await client.simulateRule('r1', { sampleSize: 10 });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules/r1/simulate');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({ sampleSize: 10 });
    expect(result.matchedCount).toBe(3);
  });

  it('simulateDraftRule POSTs /rules-engine/rules/simulate (no rule id) with draft in the body', async () => {
    const fetchMock = mockFetch({ ok: true, matchedCount: 0, sampleSize: 50, sample: [], conflicts: [] });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.simulateDraftRule({ draft: { domain: 'ap', ruleKind: 'ENRICHMENT', conditions: [], actions: [] } });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/rules/simulate');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    expect(body.draft).toEqual({ domain: 'ap', ruleKind: 'ENRICHMENT', conditions: [], actions: [] });
  });

  it('listRulePropertyDefinitions GETs /rules-engine/properties', async () => {
    const fetchMock = mockFetch({ ok: true, definitions: [] });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.listRulePropertyDefinitions();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/properties');
    expect(opts.method).toBe('GET');
  });

  it('createRulePropertyDefinition POSTs /rules-engine/properties with the body', async () => {
    const fetchMock = mockFetch({ ok: true, definition: { id: 'p1' } }, 201);
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.createRulePropertyDefinition({ propertyKey: 'glAccount', label: 'GL account', dataType: 'string' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/properties');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({ propertyKey: 'glAccount', label: 'GL account', dataType: 'string' });
  });

  it('listRuleTemplates GETs /rules-engine/templates with query params', async () => {
    const fetchMock = mockFetch({ ok: true, templates: [] });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.listRuleTemplates({ domain: 'ap' });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/templates?domain=ap');
  });

  it('getRuleTemplate GETs /rules-engine/templates/{id}', async () => {
    const fetchMock = mockFetch({ ok: true, template: { id: 't1' } });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.getRuleTemplate('t1');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/templates/t1');
  });

  it('instantiateRuleTemplate PUTs /rules-engine/templates/{id} with { params } only', async () => {
    const fetchMock = mockFetch({ ok: true, rule: { id: 'r1' }, created: true }, 201);
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.instantiateRuleTemplate('t1', { params: { threshold: 10 }, entityId: 'ent-1' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/templates/t1');
    expect(opts.method).toBe('PUT');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    expect(JSON.parse(opts.body as string)).toEqual({ params: { threshold: 10 } });
  });

  it('listRulesEngineDatasets GETs /rules-engine/datasets', async () => {
    const fetchMock = mockFetch({ ok: true, datasets: [] });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.listRulesEngineDatasets();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/datasets');
  });

  it('createRulesEngineDataset POSTs /rules-engine/datasets with the body', async () => {
    const fetchMock = mockFetch({ ok: true, dataset: { id: 'd1' }, created: true }, 201);
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.createRulesEngineDataset({ datasetKey: 'gl_accounts', name: 'GL accounts', keyColumns: ['glAccount', 'country'] });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/datasets');
    expect(JSON.parse(opts.body as string)).toEqual({ datasetKey: 'gl_accounts', name: 'GL accounts', keyColumns: ['glAccount', 'country'] });
  });

  it('getRulesEngineDataset GETs /rules-engine/datasets/{id}', async () => {
    const fetchMock = mockFetch({ ok: true, dataset: { id: 'd1' } });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.getRulesEngineDataset('d1');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/datasets/d1');
  });

  it('listRulesEngineDatasetRows GETs /rules-engine/datasets/{id}/rows with page/limit query params', async () => {
    const fetchMock = mockFetch({ ok: true, rows: [], total: 0, page: 2, limit: 10 });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.listRulesEngineDatasetRows('d1', { page: 2, limit: 10 });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/datasets/d1/rows?page=2&limit=10');
  });

  it('upsertRulesEngineDatasetRow POSTs /rules-engine/datasets/{id}/rows with rowData', async () => {
    const fetchMock = mockFetch({ ok: true, row: { id: 'row1' }, created: true }, 201);
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.upsertRulesEngineDatasetRow('d1', { rowData: { glAccount: '4000', country: 'DE' }, source: 'ERP export' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/datasets/d1/rows');
    expect(JSON.parse(opts.body as string)).toEqual({ rowData: { glAccount: '4000', country: 'DE' }, source: 'ERP export' });
  });

  it('deleteRulesEngineDatasetRow DELETEs /rules-engine/datasets/{id}/rows/{rowKey}, URL-encoding the row key', async () => {
    const fetchMock = mockFetch({ ok: true });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.deleteRulesEngineDatasetRow('d1', '4000/DE');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/datasets/d1/rows/4000%2FDE');
    expect(opts.method).toBe('DELETE');
  });

  it('importRulesEngineDataset POSTs /rules-engine/datasets/{id}/import with csv/dryRun', async () => {
    const fetchMock = mockFetch({ ok: true, dryRun: true, adds: [], changes: [], deletes: [] });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const result = await client.importRulesEngineDataset('d1', { csv: 'glAccount,country\n4000,DE\n' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/datasets/d1/import');
    expect(JSON.parse(opts.body as string)).toEqual({ csv: 'glAccount,country\n4000,DE\n' });
    expect(result.dryRun).toBe(true);
  });

  it('exportRulesEngineDataset GETs /rules-engine/datasets/{id}/export and returns raw text, not JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'glAccount,country\n4000,DE\n' });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const csv = await client.exportRulesEngineDataset('d1');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/datasets/d1/export');
    expect(opts.method).toBe('GET');
    expect(csv).toBe('glAccount,country\n4000,DE\n');
  });

  it('listFieldMappings GETs /rules-engine/mappings with sourceSystem as a required query param', async () => {
    const fetchMock = mockFetch({ ok: true, rules: [] });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.listFieldMappings({ sourceSystem: 'xero' });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/mappings?sourceSystem=xero');
  });

  it('getFieldMapping GETs /rules-engine/mappings/{id}', async () => {
    const fetchMock = mockFetch({ ok: true, mapping: { id: 'm1' } });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.getFieldMapping('m1');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/mappings/m1');
  });

  it('updateFieldMapping PATCHes /rules-engine/mappings/{id}', async () => {
    const fetchMock = mockFetch({ ok: true, mapping: { id: 'm1', enabled: false } });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.updateFieldMapping('m1', { enabled: false });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/mappings/m1');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body as string)).toEqual({ enabled: false });
  });

  it('resetFieldMappings POSTs /rules-engine/mappings/reset?sourceSystem=...', async () => {
    const fetchMock = mockFetch({ ok: true, rules: [] });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.resetFieldMappings('xero');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/mappings/reset?sourceSystem=xero');
    expect(opts.method).toBe('POST');
  });

  it('getRulesTrace GETs /rules-engine/trace with recordType/recordId query params', async () => {
    const fetchMock = mockFetch({ ok: true, recordType: 'calculation', recordId: 'c1', entries: [] });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.getRulesTrace({ recordType: 'calculation', recordId: 'c1' });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/trace?recordType=calculation&recordId=c1');
  });

  it('listPlatformRuleChanges GETs /rules-engine/platform-changes with an optional limit', async () => {
    const fetchMock = mockFetch({ ok: true, changes: [] });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.listPlatformRuleChanges({ limit: 25 });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/platform-changes?limit=25');
  });

  it('listPlatformRuleChanges omits the query string when no limit is given', async () => {
    const fetchMock = mockFetch({ ok: true, changes: [] });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.listPlatformRuleChanges();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/rules-engine/platform-changes');
  });
});

describe('ClearvoClient manual adjustments', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('proposeManualAdjustment POSTs /tax/calculate/{id}/adjustments with the body, calculationId never duplicated into it', async () => {
    const fetchMock = mockFetch({ ok: true, adjustmentId: 'adj1' }, 201);
    const client = new ClearvoClient({ apiKey: 'csk_live_acct_x', baseUrl: 'http://x/v1' });
    const result = await client.proposeManualAdjustment('calc1', {
      mode: 'FORCED_INPUT',
      forcedInputs: { taxCategory: 'digital_service' },
      originalValue: { taxCategory: null },
      reason: 'Miscategorized at checkout',
      entityId: 'ent-1',
    });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/tax/calculate/calc1/adjustments');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({
      mode: 'FORCED_INPUT',
      forcedInputs: { taxCategory: 'digital_service' },
      originalValue: { taxCategory: null },
      reason: 'Miscategorized at checkout',
    });
    expect(body).not.toHaveProperty('entityId');
    expect(result.adjustmentId).toBe('adj1');
  });

  it('listManualAdjustments GETs /tax/calculate/{id}/adjustments with an optional status query param', async () => {
    const fetchMock = mockFetch({ ok: true, adjustments: [] });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.listManualAdjustments('calc1', { status: 'DRAFT' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/tax/calculate/calc1/adjustments?status=DRAFT');
    expect(opts.method).toBe('GET');
  });

  it('listManualAdjustments omits the query string when no status is given', async () => {
    const fetchMock = mockFetch({ ok: true, adjustments: [] });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    await client.listManualAdjustments('calc1');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/tax/calculate/calc1/adjustments');
  });

  it('getManualAdjustmentOptions GETs /tax/calculate/{id}/adjustment-options', async () => {
    const fetchMock = mockFetch({ modes: ['FORCED_INPUT', 'POST_CALCULATION_OVERRIDE'], targetTypes: [], forcedInputProperties: { header: [], line: [] }, overrideColumns: [] });
    const client = new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
    const result = await client.getManualAdjustmentOptions('calc1');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/tax/calculate/calc1/adjustment-options');
    expect(opts.method).toBe('GET');
    expect(result.modes).toEqual(['FORCED_INPUT', 'POST_CALCULATION_OVERRIDE']);
  });
});
