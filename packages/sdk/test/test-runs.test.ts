// ClearvoClient integration-test methods: POST/GET /test-runs and /test-cases (sandbox only), mocked HTTP.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';

describe('ClearvoClient integration tests', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mock(body: unknown, status = 200) {
    const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }
  const client = () => new ClearvoClient({ apiKey: 'csk_test_x', baseUrl: 'http://x/v1' });
  type Call = [string, { method: string; body?: string; headers: Record<string, string> }];

  it('startTestRun posts the body to /test-runs and sends the idempotency key as a header, not in the body', async () => {
    const started = { runId: 'r1', name: 'CI', status: 'running', startedAt: 't', deadlineAt: 't2', links: { self: '/v1/test-runs/r1' } };
    const f = mock(started, 202);
    const out = await client().startTestRun({ name: 'CI', tags: ['automatic'], deadlineMinutes: 5, idempotencyKey: 'k-1' });
    expect(out).toEqual(started);
    const [url, init] = f.mock.calls[0] as Call;
    expect(url).toBe('http://x/v1/test-runs');
    expect(init.method).toBe('POST');
    expect(init.headers['x-idempotency-key']).toBe('k-1');
    expect(JSON.parse(init.body!)).toEqual({ name: 'CI', tags: ['automatic'], deadlineMinutes: 5 });
  });

  it('startTestRun with no input posts an empty body and no idempotency header', async () => {
    const f = mock({ runId: 'r1' }, 202);
    await client().startTestRun();
    const [, init] = f.mock.calls[0] as Call;
    expect(JSON.parse(init.body!)).toEqual({});
    expect(init.headers['x-idempotency-key']).toBeUndefined();
  });

  it('getTestRun reads /test-runs/{id} with the id encoded', async () => {
    const run = { runId: 'a/b', status: 'passed' };
    const f = mock(run);
    expect(await client().getTestRun('a/b')).toEqual(run);
    const [url, init] = f.mock.calls[0] as Call;
    expect(url).toBe('http://x/v1/test-runs/a%2Fb');
    expect(init.method).toBe('GET');
  });

  it('skipTestCase and unskipTestCase PUT the boolean body to /test-cases/{id}/skip with the id encoded', async () => {
    const f = mock({ caseId: 'a/b', skipped: true });
    expect(await client().skipTestCase('a/b')).toEqual({ caseId: 'a/b', skipped: true });
    await client().unskipTestCase('a/b');
    const [url, init] = f.mock.calls[0] as Call;
    expect(url).toBe('http://x/v1/test-cases/a%2Fb/skip');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body!)).toEqual({ skipped: true });
    expect(JSON.parse((f.mock.calls[1] as Call)[1].body!)).toEqual({ skipped: false });
  });

  it('exportTestRun reads /test-runs/{id}/export with the id encoded', async () => {
    const record = { format: 'test-run-record', version: 1, run: { runId: 'a/b' }, cases: [] };
    const f = mock(record);
    expect(await client().exportTestRun('a/b')).toEqual(record);
    const [url, init] = f.mock.calls[0] as Call;
    expect(url).toBe('http://x/v1/test-runs/a%2Fb/export');
    expect(init.method).toBe('GET');
  });

  it('listTestRuns and listTestCases are GETs', async () => {
    const f = mock({ runs: [], cases: [] });
    await client().listTestRuns();
    await client().listTestCases();
    expect((f.mock.calls[0] as Call)[0]).toBe('http://x/v1/test-runs');
    expect((f.mock.calls[1] as Call)[0]).toBe('http://x/v1/test-cases');
    expect((f.mock.calls[1] as Call)[1].method).toBe('GET');
  });

  it('createTestCase posts the case to /test-cases', async () => {
    const input = { title: 'T', steps: ['do'], expected: 'ok', check: { kind: 'no_duplicate_created', params: {} } };
    const f = mock({ id: 'c1', verifiability: 'auto', verifiabilityLabel: 'Checked automatically' }, 201);
    const out = await client().createTestCase(input);
    expect(out.id).toBe('c1');
    const [url, init] = f.mock.calls[0] as Call;
    expect(url).toBe('http://x/v1/test-cases');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body!)).toEqual(input);
  });

  it('updateTestCase PATCHes /test-cases/{id}', async () => {
    const f = mock({ id: 'c1', verifiability: 'attest_only', verifiabilityLabel: 'You mark it done' });
    await client().updateTestCase('c1', { title: 'New' });
    const [url, init] = f.mock.calls[0] as Call;
    expect(url).toBe('http://x/v1/test-cases/c1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body!)).toEqual({ title: 'New' });
  });

  it('archiveTestCase DELETEs /test-cases/{id}', async () => {
    const f = mock({ id: 'c1', archived: true });
    expect(await client().archiveTestCase('c1')).toEqual({ id: 'c1', archived: true });
    const [url, init] = f.mock.calls[0] as Call;
    expect(url).toBe('http://x/v1/test-cases/c1');
    expect(init.method).toBe('DELETE');
  });

  it('getTestCaseCatalogue reads /test-cases/catalogue', async () => {
    const f = mock({ checks: [], appliesWhen: { directions: [], countries: [] }, limits: {} });
    await client().getTestCaseCatalogue();
    expect((f.mock.calls[0] as Call)[0]).toBe('http://x/v1/test-cases/catalogue');
  });

  it('surfaces an API error as a thrown ClearvoError (RUN_IN_PROGRESS)', async () => {
    mock({ error: 'A run is already in progress', code: 'RUN_IN_PROGRESS' }, 409);
    await expect(client().startTestRun()).rejects.toMatchObject({ status: 409 });
  });
});
