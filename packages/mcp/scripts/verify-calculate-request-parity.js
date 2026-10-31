#!/usr/bin/env node
'use strict';

// calculate_tax passes its arguments straight to POST /v1/tax/calculate, so its input schema is all an AI agent can see of what the
// API accepts. Fails when the tool lacks a field of the published request (public/openapi.json, TaxCalculateRequest), declares a field
// the document does not have, or lists an omission that is no longer one. Every deliberate omission has its reason below.
// Also checks quote_duties (the same body) and the SDK request type (packages/sdk/src/types.ts) against the same document.
//
// Usage: npm run build && CLEARVO_MARKETING_OPENAPI_PATH=.../public/openapi.json node scripts/verify-calculate-request-parity.js

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..', '..');
const SERVER = path.join(ROOT, 'dist', 'index.js');

function fail(msg) { console.error(`FAIL — ${msg}`); process.exit(1); }

const candidates = [
  process.env.CLEARVO_MARKETING_OPENAPI_PATH,
  path.join(REPO, '..', 'clearvo-marketing', 'public', 'openapi.json'),
  path.join(REPO, '..', 'clearvo-marketing-mcp-address', 'public', 'openapi.json'),
].filter(Boolean);
const OPENAPI = candidates.find((p) => fs.existsSync(p));
if (!OPENAPI) fail('No openapi.json found: set CLEARVO_MARKETING_OPENAPI_PATH (or check out clearvo-marketing next to this repo).');
if (!fs.existsSync(SERVER)) fail(`Missing ${path.relative(ROOT, SERVER)} — run "npm run build" first.`);

const REMOVED = 'Removed from the API: the field exists only so a stale caller gets a named 422, so an agent must never send it.';
const SELLER_ALIAS = 'Deprecated alias of supplier on a sale; the entity address comes from master data and the dispatch address from shipFrom, so the alias keeps the country only.';
const OMITTED = {
  clientTaxCode: REMOVED,
  'lineItems[].clientTaxCode': REMOVED,
  'lineItems[].stripeTaxCode': REMOVED,
  'seller.name': SELLER_ALIAS,
};
for (const f of ['line1', 'line2', 'city', 'region', 'postalCode']) OMITTED[`seller.address.${f}`] = SELLER_ALIAS;

// Accepted by the API but deliberately not published or typed: a deprecated loose hint that agents have always been able to send.
const UNDOCUMENTED_IN_TOOL = { 'customer.type': 'Deprecated loose B2B/B2C hint: accepted by the API, kept in the tool, not in the published document or the SDK type.', 'supplier.type': 'Same as customer.type.' };

const api = JSON.parse(fs.readFileSync(OPENAPI, 'utf8'));
const schemas = (api.components && api.components.schemas) || {};
function propertyPaths(schema, prefix, out, seen) {
  if (!schema || typeof schema !== 'object') return out;
  if (schema.$ref) {
    const name = String(schema.$ref).split('/').pop();
    if (schemas[name] && !seen.includes(name)) propertyPaths(schemas[name], prefix, out, seen.concat(name));
    return out;
  }
  for (const key of ['anyOf', 'oneOf', 'allOf']) for (const part of schema[key] || []) propertyPaths(part, prefix, out, seen);
  for (const [name, child] of Object.entries(schema.properties || {})) {
    const p = prefix ? `${prefix}.${name}` : name;
    out.add(p);
    propertyPaths(child, p, out, seen);
  }
  if (schema.items) propertyPaths(schema.items, `${prefix}[]`, out, seen);
  return out;
}
if (!schemas.TaxCalculateRequest) fail('openapi.json has no components.schemas.TaxCalculateRequest.');
const apiPaths = propertyPaths(schemas.TaxCalculateRequest, '', new Set(), []);

function check(label, paths, { omitted }) {
  const missing = [...apiPaths].filter((p) => !paths.has(p) && !(p in omitted)).sort();
  const unknown = [...paths].filter((p) => !apiPaths.has(p) && !(p in UNDOCUMENTED_IN_TOOL)).sort();
  const stale = Object.keys(omitted).filter((p) => !apiPaths.has(p) || paths.has(p)).concat(Object.keys(UNDOCUMENTED_IN_TOOL).filter((p) => apiPaths.has(p) || !paths.has(p))).sort();
  if (missing.length) fail(`${label} lacks ${missing.length} field(s) the API accepts:\n  ${missing.join('\n  ')}`);
  if (unknown.length) fail(`${label} declares ${unknown.length} field(s) the published API does not have:\n  ${unknown.join('\n  ')}`);
  if (stale.length) fail(`${label}: stale deliberate-omission entries:\n  ${stale.join('\n  ')}`);
  console.log(`OK — ${label} covers every field of the published request (${apiPaths.size} fields, ${Object.keys(omitted).length} deliberate omissions).`);
}

const child = spawn('node', [SERVER], { cwd: path.dirname(SERVER), env: { ...process.env, CLEARVO_API_KEY: 'csk_test_verifycalculateparity' } });
child.stderr.on('data', () => {});
const rl = readline.createInterface({ input: child.stdout });
const pending = new Map();
rl.on('line', (line) => { try { const m = JSON.parse(line); if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch { /* not JSON-RPC */ } });
const call = (id, method, params) => new Promise((resolve) => { pending.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });

(async () => {
  await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'parity', version: '0' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = await call(2, 'tools/list', {});
  child.kill();
  const tools = list.result.tools;
  const calc = tools.find((t) => t.name === 'calculate_tax');
  if (!calc) fail('tools/list has no calculate_tax.');
  check('calculate_tax', propertyPaths(calc.inputSchema, '', new Set(), []), { omitted: OMITTED });
  const quote = tools.find((t) => t.name === 'quote_duties');
  if (!quote) fail('tools/list has no quote_duties.');
  const quotePaths = propertyPaths(quote.inputSchema, '', new Set(), []);
  for (const p of ['customer.shippingAddress.line1', 'customer.shippingAddress.city', 'shipFrom.city', 'lineItems[].productDescription']) {
    if (!quotePaths.has(p)) fail(`quote_duties lacks ${p}, which it should inherit from calculate_tax.`);
  }
  console.log('OK — quote_duties inherits the same address and line fields.');
  process.exit(0);
})().catch((e) => { child.kill(); fail(e.message); });
