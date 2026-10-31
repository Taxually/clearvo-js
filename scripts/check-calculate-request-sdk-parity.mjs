#!/usr/bin/env node
// Fails when the SDK's TaxCalculateRequest type lacks a field of the published request (public/openapi.json, components.schemas.
// TaxCalculateRequest), declares one the document does not have, or lists an omission that is no longer one. The SDK request type is
// hand-written, so without this a new field in the API never reaches TypeScript callers. The MCP tool is checked the same way by
// packages/mcp/scripts/verify-calculate-request-parity.js.
// Usage: CLEARVO_MARKETING_OPENAPI_PATH=.../public/openapi.json node scripts/check-calculate-request-sdk-parity.mjs
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (m) => { console.error(`FAIL — ${m}`); process.exit(1); };

const openapiPath = [process.env.CLEARVO_MARKETING_OPENAPI_PATH, join(root, '../clearvo-marketing/public/openapi.json')].filter(Boolean).find((p) => existsSync(p));
if (!openapiPath) fail('No openapi.json found: set CLEARVO_MARKETING_OPENAPI_PATH (or check out clearvo-marketing next to this repo).');
const api = JSON.parse(readFileSync(openapiPath, 'utf8'));
const schemas = api.components?.schemas ?? {};
if (!schemas.TaxCalculateRequest) fail('openapi.json has no components.schemas.TaxCalculateRequest.');

function apiPaths(schema, prefix, out, seen) {
  if (!schema || typeof schema !== 'object') return out;
  if (schema.$ref) {
    const name = String(schema.$ref).split('/').pop();
    if (schemas[name] && !seen.includes(name)) apiPaths(schemas[name], prefix, out, [...seen, name]);
    return out;
  }
  for (const key of ['anyOf', 'oneOf', 'allOf']) for (const part of schema[key] ?? []) apiPaths(part, prefix, out, seen);
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    const p = prefix ? `${prefix}.${name}` : name;
    out.add(p);
    apiPaths(child, p, out, seen);
  }
  if (schema.items) apiPaths(schema.items, `${prefix}[]`, out, seen);
  return out;
}
const expected = apiPaths(schemas.TaxCalculateRequest, '', new Set(), []);

const configPath = join(root, 'packages/sdk/tsconfig.json');
const cfg = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, dirname(configPath));
const program = ts.createProgram([join(root, 'packages/sdk/src/types.ts')], parsed.options);
const checker = program.getTypeChecker();
const source = program.getSourceFile(join(root, 'packages/sdk/src/types.ts'));
const decl = source.statements.find((s) => ts.isInterfaceDeclaration(s) && s.name.text === 'TaxCalculateRequest');
if (!decl) fail('packages/sdk/src/types.ts has no interface TaxCalculateRequest.');

function typePaths(type, prefix, out, depth = 0) {
  if (depth > 6) return out;
  if (type.isUnion()) { for (const t of type.types) typePaths(t, prefix, out, depth + 1); return out; }
  if (checker.isArrayType(type)) { const [el] = checker.getTypeArguments(type); if (el) typePaths(el, `${prefix}[]`, out, depth + 1); return out; }
  if (!(type.flags & ts.TypeFlags.Object) || type.getCallSignatures().length) return out;
  const index = type.getStringIndexType();
  for (const prop of checker.getPropertiesOfType(type)) {
    const p = prefix ? `${prefix}.${prop.name}` : prop.name;
    out.add(p);
    typePaths(checker.getTypeOfSymbolAtLocation(prop, decl), p, out, depth + 1);
  }
  if (index) typePaths(index, `${prefix}{}`, out, depth + 1);
  return out;
}
const actual = typePaths(checker.getTypeAtLocation(decl), '', new Set());

const REMOVED = 'Removed from the API: the field exists only so a stale caller gets a named 422.';
const SELLER_ALIAS = 'Deprecated alias of supplier on a sale; the entity address comes from master data and the dispatch address from shipFrom, so the alias keeps the country only.';
const OMITTED = { clientTaxCode: REMOVED, 'lineItems[].clientTaxCode': REMOVED, 'lineItems[].stripeTaxCode': REMOVED, 'seller.name': SELLER_ALIAS };
for (const f of ['line1', 'line2', 'city', 'region', 'postalCode']) OMITTED[`seller.address.${f}`] = SELLER_ALIAS;

const missing = [...expected].filter((p) => !actual.has(p) && !(p in OMITTED)).sort();
const unknown = [...actual].filter((p) => !expected.has(p)).sort();
const stale = Object.keys(OMITTED).filter((p) => !expected.has(p) || actual.has(p)).sort();
if (missing.length) fail(`SDK TaxCalculateRequest lacks ${missing.length} field(s) the API accepts:\n  ${missing.join('\n  ')}`);
if (unknown.length) fail(`SDK TaxCalculateRequest declares ${unknown.length} field(s) the published API does not have:\n  ${unknown.join('\n  ')}`);
if (stale.length) fail(`Stale deliberate-omission entries:\n  ${stale.join('\n  ')}`);
console.log(`OK — SDK TaxCalculateRequest covers every field of the published request (${expected.size} fields, ${Object.keys(OMITTED).length} deliberate omissions).`);
