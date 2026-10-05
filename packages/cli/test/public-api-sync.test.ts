// Coverage for the CLI commands added by the public-API sync: `clearvo api` (generic escape hatch),
// invoices, customers, entities update, receive, tax settings, obligations, reporting batches,
// team invites, usage and the JSON-payload country credentials. Drives the real Commander commands
// from createProgram() with a mocked global.fetch, same harness as rules-engine.test.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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

describe('clearvo public API sync commands', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CLEARVO_API_KEY;
  const originalBaseUrl = process.env.CLEARVO_BASE_URL;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.CLEARVO_API_KEY = 'csk_live_testkey';
    process.env.CLEARVO_BASE_URL = 'http://x/v1';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.CLEARVO_API_KEY; else process.env.CLEARVO_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.CLEARVO_BASE_URL; else process.env.CLEARVO_BASE_URL = originalBaseUrl;
    logSpy.mockRestore();
  });

  const run = (path: string[], args: string[] = []) => findCommand(createProgram(), path).parseAsync(args, { from: 'user' });
  const lastCall = () => fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, { method: string; headers: Record<string, string>; body?: string }];

  it('"status" shows --country as a required option', () => {
    const status = findCommand(createProgram(), ['status']);
    const country = status.options.find((o) => o.long === '--country');
    expect(country?.required).toBe(true);
    expect(status.helpInformation()).toContain('--country <code>');
  });

  describe('api', () => {
    it('GET with a leading /v1 is normalised against the base URL', async () => {
      await run(['api'], ['GET', '/v1/usage']);
      const [url, opts] = lastCall();
      expect(url).toBe('http://x/v1/usage');
      expect(opts.method).toBe('GET');
      expect(opts.body).toBeUndefined();
    });

    it('POST sends --data as the JSON body and --entity as x-entity-id; method is case-insensitive', async () => {
      await run(['api'], ['post', 'tax/calculate/c1/refund', '--data', '{"amount":5}', '--entity', 'ent-1']);
      const [url, opts] = lastCall();
      expect(url).toBe('http://x/v1/tax/calculate/c1/refund');
      expect(opts.method).toBe('POST');
      expect(opts.headers['x-entity-id']).toBe('ent-1');
      expect(JSON.parse(opts.body as string)).toEqual({ amount: 5 });
    });

    it('keeps a query string intact', async () => {
      await run(['api'], ['GET', '/invoices?limit=5']);
      expect(lastCall()[0]).toBe('http://x/v1/invoices?limit=5');
    });
  });

  describe('invoices', () => {
    it('list maps flags to query params (after-id becomes after_id)', async () => {
      await run(['invoices', 'list'], ['--country', 'IT', '--limit', '10', '--after-id', 'abc']);
      expect(lastCall()[0]).toBe('http://x/v1/invoices?country=IT&limit=10&after_id=abc');
    });

    it('get, retry and deliver hit their paths; deliver sends electronicAddress', async () => {
      await run(['invoices', 'get'], ['i1']);
      expect(lastCall()[0]).toBe('http://x/v1/invoices/i1');
      await run(['invoices', 'retry'], ['i1']);
      expect(lastCall()[0]).toBe('http://x/v1/invoices/i1/retry');
      expect(lastCall()[1].method).toBe('POST');
      await run(['invoices', 'deliver'], ['i1', '--address', '991-33333TEST-33', '--scheme', '0204']);
      const [url, opts] = lastCall();
      expect(url).toBe('http://x/v1/invoices/i1/deliver');
      expect(JSON.parse(opts.body as string)).toEqual({ electronicAddress: { value: '991-33333TEST-33', schemeId: '0204' } });
    });

    it('resend-notification uses the single route for one id and the batch route for several', async () => {
      await run(['invoices', 'resend-notification'], ['a']);
      expect(lastCall()[0]).toBe('http://x/v1/invoices/a/resend-notification');
      await run(['invoices', 'resend-notification'], ['a', 'b']);
      expect(lastCall()[0]).toBe('http://x/v1/invoices/resend-notification/batch');
      expect(JSON.parse(lastCall()[1].body as string)).toEqual({ ids: ['a', 'b'] });
    });
  });

  describe('customers', () => {
    it('create POSTs flags plus parsed --references', async () => {
      await run(['customers', 'create'], ['--name', 'Acme', '--tax-id', 'DE123', '--references', '[{"type":"LEITWEG_ID","value":"04011000-1234512345-06"}]']);
      const [url, opts] = lastCall();
      expect(url).toBe('http://x/v1/customers');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body as string)).toEqual({ name: 'Acme', taxId: 'DE123', references: [{ type: 'LEITWEG_ID', value: '04011000-1234512345-06' }] });
    });

    it('update PATCHes only the supplied fields and "null" clears references', async () => {
      await run(['customers', 'update'], ['c1', '--city', 'Berlin', '--references', 'null']);
      const [url, opts] = lastCall();
      expect(url).toBe('http://x/v1/customers/c1');
      expect(opts.method).toBe('PATCH');
      expect(JSON.parse(opts.body as string)).toEqual({ city: 'Berlin', references: null });
    });

    it('upsert PUTs by-ref; list passes search; reference-types passes country', async () => {
      await run(['customers', 'upsert'], ['CRM/1', '--name', 'Acme']);
      expect(lastCall()[0]).toBe('http://x/v1/customers/by-ref/CRM%2F1');
      expect(lastCall()[1].method).toBe('PUT');
      await run(['customers', 'list'], ['--search', 'ac']);
      expect(lastCall()[0]).toBe('http://x/v1/customers?search=ac');
      await run(['customers', 'reference-types'], ['--country', 'DE']);
      expect(lastCall()[0]).toBe('http://x/v1/customer-reference-types?country=DE');
    });

    it('delete tolerates the route\'s 204 empty body', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => { throw new Error('no body'); } });
      await run(['customers', 'delete'], ['c1']);
      expect(lastCall()[0]).toBe('http://x/v1/customers/c1');
      expect(lastCall()[1].method).toBe('DELETE');
    });
  });

  it('"entities update" PATCHes the supplied fields', async () => {
    await run(['entities', 'update'], ['e1', '--name', 'New Name', '--notify-customer-by-default', 'false', '--default-de-invoice-format', 'null']);
    const [url, opts] = lastCall();
    expect(url).toBe('http://x/v1/entities/e1');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body as string)).toEqual({ name: 'New Name', notifyCustomerByDefault: false, defaultDeInvoiceFormat: null });
  });

  it('"receive document <file>" POSTs base64 content to /receive', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clearvo-cli-test-'));
    const file = join(dir, 'invoice.xml');
    writeFileSync(file, '<Invoice/>');
    await run(['receive', 'document'], [file, '--country', 'DE']);
    const [url, opts] = lastCall();
    expect(url).toBe('http://x/v1/receive');
    expect(JSON.parse(opts.body as string)).toEqual({ fileBase64: Buffer.from('<Invoice/>').toString('base64'), fileName: 'invoice.xml', country: 'DE' });
  });

  it('"tax-settings update --data" PATCHes /tax/settings; "obligations update" PATCHes the obligation', async () => {
    await run(['tax-settings', 'update'], ['--data', '{"vatValidationMode":"format"}']);
    expect(lastCall()[0]).toBe('http://x/v1/tax/settings');
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({ vatValidationMode: 'format' });
    await run(['obligations', 'update'], ['o1', '--registration-status', 'REGISTERED', '--registration-number', 'X1']);
    expect(lastCall()[0]).toBe('http://x/v1/tax/obligations/o1');
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({ registrationStatus: 'REGISTERED', registrationNumber: 'X1' });
  });

  it('"calculations refund" POSTs amount and idempotencyKey', async () => {
    await run(['calculations', 'refund'], ['calc1', '--amount', '5', '--idempotency-key', 'k1']);
    expect(lastCall()[0]).toBe('http://x/v1/tax/calculate/calc1/refund');
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({ amount: 5, idempotencyKey: 'k1' });
  });

  it('"team invite" POSTs email, role and entityIds', async () => {
    await run(['team', 'invite'], ['--email', 'a@b.co', '--role', 'finance', '--entity-id', 'e1', 'e2']);
    expect(lastCall()[0]).toBe('http://x/v1/team/invites');
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({ email: 'a@b.co', role: 'finance', entityIds: ['e1', 'e2'] });
  });

  it('"reporting-batches confirm" sends a numeric snapshotVersion; "exclude" sends the transaction id', async () => {
    await run(['reporting-batches', 'confirm'], ['b1', '--snapshot-version', '7']);
    expect(lastCall()[0]).toBe('http://x/v1/reporting-batches/b1/confirm');
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({ snapshotVersion: 7 });
    await run(['reporting-batches', 'exclude'], ['b1', '--transaction-id', 't1', '--reason', 'late']);
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({ transactionId: 't1', reason: 'late' });
  });

  it('"reporting-obligations update" PATCHes the parsed obligations with confirm', async () => {
    await run(['reporting-obligations', 'update'], ['--obligations', '{"es_sii":{"enabled":true}}', '--confirm']);
    expect(lastCall()[0]).toBe('http://x/v1/tax/reporting-obligations');
    expect(lastCall()[1].method).toBe('PATCH');
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({ obligations: { es_sii: { enabled: true } }, confirm: true });
  });

  it('"usage", "setup-status", "jurisdictions", "mandates --id", "lookup company" GET their routes', async () => {
    await run(['usage']);
    expect(lastCall()[0]).toBe('http://x/v1/usage');
    await run(['setup-status']);
    expect(lastCall()[0]).toBe('http://x/v1/setup/status');
    await run(['jurisdictions']);
    expect(lastCall()[0]).toBe('http://x/v1/tax/jurisdictions');
    await run(['mandates'], ['--id', 'IT-SDI']);
    expect(lastCall()[0]).toBe('http://x/v1/mandates?id=IT-SDI');
    await run(['lookup', 'company'], ['--country', 'PL', '--name', 'Acme']);
    expect(lastCall()[0]).toBe('http://x/v1/lookup?country=PL&name=Acme');
  });

  it('"<country> credentials set <file>" POSTs the file contents to /<country>/credentials with x-entity-id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clearvo-cli-test-'));
    const file = join(dir, 'pl.json');
    writeFileSync(file, '{"nip":"1234567890","token":"t"}');
    await run(['pl', 'credentials', 'set'], [file, '--entity', 'ent-1']);
    const [url, opts] = lastCall();
    expect(url).toBe('http://x/v1/pl/credentials');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    expect(JSON.parse(opts.body as string)).toEqual({ nip: '1234567890', token: 't' });
  });
});
