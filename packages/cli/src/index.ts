#!/usr/bin/env node
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';
import { Command } from 'commander';

const CONFIG_PATH = join(homedir(), '.clearvo', 'config.json');
const BASE_URL = process.env.CLEARVO_BASE_URL ?? 'https://api.clearvo.io/v1';

function getApiKey(): string {
  const key = process.env.CLEARVO_API_KEY;
  if (key) return key;
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { apiKey?: string };
    if (cfg.apiKey) return cfg.apiKey;
  } catch {
    // config file absent — that's fine
  }
  console.error('Error: CLEARVO_API_KEY is not set.');
  console.error('Set it as an environment variable or in ~/.clearvo/config.json');
  console.error('Get a key at https://app.clearvo.io/settings');
  process.exit(1);
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'x-api-key': getApiKey(),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    const parts = [`HTTP ${res.status}: ${data.error ?? 'Unknown error'}`];
    if (data.hint) parts.push(`Hint: ${data.hint}`);
    if (data.field) parts.push(`Field: ${data.field}`);
    console.error(parts.join('\n'));
    process.exit(1);
  }
  return data;
}

function print(data: unknown, pretty: boolean) {
  console.log(pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
}

const program = new Command()
  .name('clearvo')
  .description('Clearvo CLI — submit invoices, calculate tax, validate tax numbers')
  .version('0.1.0');

// ── clearvo send <file> ───────────────────────────────────────────────────────
program
  .command('send <file>')
  .description('Submit an invoice from a JSON file')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, opts: { pretty?: boolean }) => {
    const raw = readFileSync(file, 'utf8');
    const body = JSON.parse(raw) as Record<string, unknown>;
    // Derive a stable idempotency key from the invoice file content
    const idempotencyKey = createHash('sha256').update(raw).digest('hex').slice(0, 64);
    const result = await api('POST', '/send', body, { 'x-idempotency-key': idempotencyKey });
    print(result, !!opts.pretty);
  });

// ── clearvo status <referenceId> ─────────────────────────────────────────────
program
  .command('status <referenceId>')
  .description('Poll the clearance status of a submitted invoice')
  .requiredOption('--country <code>', 'ISO 3166-1 alpha-2 country code of the invoice (e.g. IT, PL)')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (referenceId: string, opts: { country: string; pretty?: boolean }) => {
    const result = await api(
      'GET',
      `/status?id=${encodeURIComponent(referenceId)}&country=${encodeURIComponent(opts.country)}`
    );
    print(result, !!opts.pretty);
  });

// ── clearvo calculate <file> ─────────────────────────────────────────────────
program
  .command('calculate <file>')
  .description('Calculate tax for a transaction from a JSON file')
  .option('--commit', 'Record in audit trail (default: dry run)')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, opts: { commit?: boolean; pretty?: boolean }) => {
    const body = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (opts.commit) body.commit = true;
    const result = await api('POST', '/tax/calculate', body);
    print(result, !!opts.pretty);
  });

// ── clearvo validate-tin ─────────────────────────────────────────────────────
program
  .command('validate-tin')
  .description('Validate a business tax number against the official authority')
  .requiredOption('--country <code>', 'ISO 3166-1 alpha-2 country code (e.g. DE, GB, AU)')
  .requiredOption('--number <taxNumber>', 'The tax/VAT number to validate')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (opts: { country: string; number: string; pretty?: boolean }) => {
    const result = await api('POST', '/tax-numbers/validate', {
      countryCode: opts.country,
      taxNumber: opts.number,
    });
    print(result, !!opts.pretty);
  });

// ── clearvo requirements ─────────────────────────────────────────────────────
program
  .command('requirements')
  .description('Get e-invoicing and tax requirements for a country')
  .requiredOption('--country <code>', 'ISO 3166-1 alpha-2 country code (e.g. IT, PL, DE)')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (opts: { country: string; pretty?: boolean }) => {
    const result = await api('GET', `/requirements?country=${encodeURIComponent(opts.country)}`);
    print(result, !!opts.pretty);
  });

// ── clearvo entities ────────────────────────────────────────────────────────
const entities = program.command('entities').description('Manage entities');

entities
  .command('list')
  .description('List all entities under the account')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (opts: { pretty?: boolean }) => {
    const result = await api('GET', '/entities');
    print(result, !!opts.pretty);
  });

entities
  .command('create')
  .description('Create a new entity and receive an API key')
  .requiredOption('--name <legalName>', 'Official registered legal name')
  .requiredOption('--country <code>', 'Country of establishment (ISO 3166-1 alpha-2)')
  .option('--vat <vatNumber>', 'VAT registration number (include country prefix)')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (opts: { name: string; country: string; vat?: string; pretty?: boolean }) => {
    const body: Record<string, string> = { legalName: opts.name, country: opts.country };
    if (opts.vat) body.vatNumber = opts.vat;
    const result = await api('POST', '/entities', body);
    print(result, !!opts.pretty);
    const r = result as Record<string, unknown>;
    if (r.apiKey) {
      console.error('\nSave this API key — it will not be shown again:');
      console.error(r.apiKey as string);
    }
  });

entities
  .command('get <id>')
  .description('Get a specific entity by ID')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (id: string, opts: { pretty?: boolean }) => {
    const result = await api('GET', `/entities/${encodeURIComponent(id)}`);
    print(result, !!opts.pretty);
  });

// ── clearvo products ────────────────────────────────────────────────────────
const products = program.command('products').description('Manage the product catalogue');

products
  .command('list')
  .description('List products in the catalogue')
  .option('--entity <entityId>', 'Filter by entity ID')
  .option('--limit <n>', 'Results per page', '25')
  .option('--page <n>', 'Page number', '1')
  .option('--sort <order>', 'Sort order: newest (default), name, or confidence')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (opts: { entity?: string; limit: string; page: string; sort?: string; pretty?: boolean }) => {
    const qs = new URLSearchParams({ limit: opts.limit, page: opts.page });
    if (opts.entity) qs.set('entityId', opts.entity);
    if (opts.sort)   qs.set('sort', opts.sort);
    const result = await api('GET', `/products?${qs}`);
    print(result, !!opts.pretty);
  });

products
  .command('create')
  .description('Create a product in the catalogue')
  .requiredOption('--name <name>', 'Product or service name')
  .option('--sku <sku>', 'Internal SKU or product code')
  .option('--description <text>', 'Optional longer description')
  .option('--tax-category <slug>', 'Tax category slug (e.g. saas_business, physical_goods_general)')
  .option('--entity <entityId>', 'Entity to create the product under')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (opts: {
    name: string;
    sku?: string;
    description?: string;
    taxCategory?: string;
    entity?: string;
    pretty?: boolean;
  }) => {
    const body: Record<string, string> = { name: opts.name };
    if (opts.sku) body.sku = opts.sku;
    if (opts.description) body.description = opts.description;
    if (opts.taxCategory) body.taxCategory = opts.taxCategory;
    if (opts.entity) body.entityId = opts.entity;
    const result = await api('POST', '/products', body);
    print(result, !!opts.pretty);
  });

products
  .command('update <id>')
  .description('Update a product (name, SKU, description, or tax category)')
  .option('--name <name>', 'Updated product name')
  .option('--sku <sku>', 'Updated SKU')
  .option('--description <text>', 'Updated description')
  .option('--tax-category <slug>', 'Updated tax category slug')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (id: string, opts: {
    name?: string;
    sku?: string;
    description?: string;
    taxCategory?: string;
    pretty?: boolean;
  }) => {
    const body: Record<string, string> = {};
    if (opts.name) body.name = opts.name;
    if (opts.sku) body.sku = opts.sku;
    if (opts.description) body.description = opts.description;
    if (opts.taxCategory) body.taxCategory = opts.taxCategory;
    const result = await api('PATCH', `/products/${encodeURIComponent(id)}`, body);
    print(result, !!opts.pretty);
  });

products
  .command('get <id>')
  .description('Get a product by ID')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (id: string, opts: { pretty?: boolean }) => {
    const result = await api('GET', `/products/${encodeURIComponent(id)}`);
    print(result, !!opts.pretty);
  });

// ── clearvo webhooks ────────────────────────────────────────────────────────
const webhooks = program.command('webhooks').description('Manage webhook endpoints');

webhooks
  .command('list')
  .description('List registered webhook endpoints')
  .option('--limit <n>', 'Results per page', '50')
  .option('--page <n>', 'Page number', '1')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (opts: { limit: string; page: string; pretty?: boolean }) => {
    const qs = new URLSearchParams({ limit: opts.limit, page: opts.page });
    const result = await api('GET', `/webhooks?${qs}`);
    print(result, !!opts.pretty);
  });

webhooks
  .command('create')
  .description('Register a new webhook endpoint')
  .requiredOption('--url <url>', 'HTTPS endpoint URL to deliver events to')
  .option('--events <events>', 'Comma-separated event types (default: *). Options: invoice.accepted,invoice.rejected,invoice.duplicate,invoice.undelivered,invoice.pending', '*')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (opts: { url: string; events: string; pretty?: boolean }) => {
    const events = opts.events.split(',').map(e => e.trim()).filter(Boolean);
    const result = await api('POST', '/webhooks', { url: opts.url, events });
    print(result, !!opts.pretty);
    const r = result as Record<string, unknown>;
    if (r.secret) {
      console.error('\nSave this webhook secret — it will not be shown again:');
      console.error(r.secret as string);
    }
  });

webhooks
  .command('delete <id>')
  .description('Deactivate a webhook endpoint')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (id: string, opts: { pretty?: boolean }) => {
    const result = await api('DELETE', `/webhooks?id=${encodeURIComponent(id)}`);
    print(result, !!opts.pretty);
  });

// ── clearvo validate-tin-batch ───────────────────────────────────────────────
program
  .command('validate-tin-batch <file>')
  .description('Validate up to 20 tax numbers from a JSON file (array of {countryCode, taxNumber})')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, opts: { pretty?: boolean }) => {
    const items = JSON.parse(readFileSync(file, 'utf8')) as unknown[];
    const result = await api('POST', '/tax-numbers/validate-batch', { items });
    print(result, !!opts.pretty);
  });

// ── clearvo registrations ───────────────────────────────────────────────────
const registrations = program.command('registrations').description('Manage tax registrations');

registrations
  .command('list')
  .description('List tax registrations and obligations for an entity')
  .option('--entity <entityId>', 'Entity ID (required for account-scoped keys)')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (opts: { entity?: string; pretty?: boolean }) => {
    const qs = opts.entity ? `?entityId=${encodeURIComponent(opts.entity)}` : '';
    const result = await api('GET', `/tax/registrations${qs}`);
    print(result, !!opts.pretty);
  });

registrations
  .command('set-collection <id>')
  .description('Set the collection start date for a registration')
  .option('--immediately', 'Start collecting tax immediately (today)')
  .option('--from <date>', 'Defer collection to a future date (YYYY-MM-DD)')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (id: string, opts: { immediately?: boolean; from?: string; pretty?: boolean }) => {
    if (!opts.immediately && !opts.from) {
      console.error('Error: provide either --immediately or --from <date>');
      process.exit(1);
    }
    const collectFromDate = opts.immediately ? null : (opts.from ?? null);
    const result = await api('PATCH', `/tax/registrations/${encodeURIComponent(id)}`, { collectFromDate });
    print(result, !!opts.pretty);
  });

registrations
  .command('add')
  .description('Record a new tax registration (VAT, IOSS, OSS, VOEC)')
  .requiredOption('--type <type>', 'Registration type: VAT, IOSS, UNION_OSS, NON_UNION_OSS, VOEC')
  .requiredOption('--number <taxNumber>', 'The registration number issued by the authority')
  .option('--country <code>', 'ISO 3166-1 alpha-2 country code (not required for IOSS)')
  .option('--entity <entityId>', 'Entity to register (required for account-scoped keys)')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (opts: { type: string; number: string; country?: string; entity?: string; pretty?: boolean }) => {
    const body: Record<string, string> = { type: opts.type.toUpperCase(), taxNumber: opts.number };
    if (opts.country) body.country = opts.country.toUpperCase();
    if (opts.entity) body.entityId = opts.entity;
    const result = await api('POST', '/tax/registrations', body);
    print(result, !!opts.pretty);
  });

// ── clearvo calculations ─────────────────────────────────────────────────────
const calculations = program.command('calculations').description('View committed tax calculation history');

calculations
  .command('list')
  .description('List committed tax calculations')
  .option('--entity <entityId>', 'Filter by entity ID')
  .option('--country <code>', 'Filter by jurisdiction country (e.g. DE, US)')
  .option('--limit <n>', 'Results per page', '25')
  .option('--page <n>', 'Page number', '1')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (opts: { entity?: string; country?: string; limit: string; page: string; pretty?: boolean }) => {
    const qs = new URLSearchParams({ limit: opts.limit, page: opts.page });
    if (opts.entity)  qs.set('entityId', opts.entity);
    if (opts.country) qs.set('country',  opts.country);
    const result = await api('GET', `/tax/calculate?${qs}`);
    print(result, !!opts.pretty);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
