#!/usr/bin/env node
'use strict';

// Drift guard between the public contract (clearvo-marketing public/openapi.json) and the stdio
// server's two big input schemas: every top-level property of components.schemas.InvoiceRequest must
// be a property of submit_invoice's inputSchema, and every top-level property of TaxCalculateRequest
// a property of calculate_tax's, so a field added to the contract cannot silently be missing from
// the tool again. (The reverse does not hold: the contract documents "the fields most integrators
// need", and the tools also carry fields the routes read that it omits.)
//
// IGNORED lists contract names the backend routes do not accept (retired or rejected) so a stale
// spec does not force a wrong field into a tool. Skipped (exit 0) when no openapi.json is found,
// same sibling-checkout rule as scripts/generate-from-openapi.mjs.
//
// Usage: npm run build && node scripts/verify-openapi-parity.js

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'dist', 'index.js');

const IGNORED = {
  submit_invoice: {
    // Renamed in the canonical invoice schema; the routes answer 422 UNKNOWN_FIELD_RENAMED.
    deductibleVatAmount: 'renamed to deductibleTaxAmount',
    taxReportingAmounts: 'renamed to taxReporting',
  },
  calculate_tax: {
    reportingCurrency: 'renamed to taxReportingCurrency',
    clientTaxCode: 'rejected on POST /v1/tax/calculate (calculation output only); belongs on POST /v1/send',
  },
};

function fail(msg) {
  console.error(`FAIL — ${msg}`);
  process.exit(1);
}

const candidates = [
  process.env.CLEARVO_MARKETING_OPENAPI_PATH,
  path.join(ROOT, '..', '..', '..', 'clearvo-marketing', 'public', 'openapi.json'),
].filter(Boolean);
const openapiPath = candidates.find(p => fs.existsSync(p));
if (!openapiPath) {
  console.log('SKIP — no openapi.json found (set CLEARVO_MARKETING_OPENAPI_PATH).');
  process.exit(0);
}
if (!fs.existsSync(SERVER)) fail(`Missing ${path.relative(ROOT, SERVER)} — run "npm run build" first.`);

const schemas = JSON.parse(fs.readFileSync(openapiPath, 'utf8')).components?.schemas ?? {};
const PAIRS = [
  ['submit_invoice', 'InvoiceRequest'],
  ['calculate_tax', 'TaxCalculateRequest'],
];

const child = spawn('node', [SERVER], {
  cwd: path.dirname(SERVER),
  env: { ...process.env, CLEARVO_API_KEY: 'csk_test_verifyopenapiparity' },
});
child.stderr.on('data', () => {});

const pending = new Map();
function call(id, method, params) {
  return new Promise(resolve => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
readline.createInterface({ input: child.stdout }).on('line', line => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
});

const timeout = setTimeout(() => fail('Timed out waiting for a tools/list response'), 5000);

(async () => {
  await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-openapi-parity', version: '0' } });
  const response = await call(2, 'tools/list', {});
  clearTimeout(timeout);
  const tools = new Map((response.result?.tools ?? []).map(t => [t.name, t]));

  const problems = [];
  for (const [toolName, schemaName] of PAIRS) {
    const contract = schemas[schemaName]?.properties;
    if (!contract) {
      problems.push(`openapi.json has no components.schemas.${schemaName}.properties`);
      continue;
    }
    const have = new Set(Object.keys(tools.get(toolName)?.inputSchema?.properties ?? {}));
    const ignored = IGNORED[toolName] ?? {};
    const missing = Object.keys(contract).filter(k => !have.has(k) && !(k in ignored));
    if (missing.length) problems.push(`${toolName} is missing ${schemaName} properties: ${missing.join(', ')}`);
  }
  if (problems.length) fail(`\n  ${problems.join('\n  ')}\n  (openapi: ${openapiPath})`);

  console.log(`OK — submit_invoice and calculate_tax cover every top-level InvoiceRequest / TaxCalculateRequest property in ${path.basename(openapiPath)}.`);
  child.kill();
  process.exit(0);
})();
