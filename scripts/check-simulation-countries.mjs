#!/usr/bin/env node
// Fails when the sandbox received-invoice simulator lists differ between the SDK, MCP server and CLI, or from what the backend supports:
//   - the 24 countries (each declares `const SIMULATION_COUNTRY_CODES = [...]`)
//   - the scenarios: the SDK and MCP server declare `SIMULATION_SCENARIOS` (id + description), the CLI declares `SIMULATION_SCENARIO_IDS`
// When CLEARVO_MARKETING_OPENAPI_PATH points at the published OpenAPI document, its scenario enum must match too.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED = ['AE', 'AT', 'AU', 'BE', 'CH', 'DE', 'DK', 'EE', 'FI', 'FR', 'HR', 'IE', 'IS', 'JP', 'LT', 'LU', 'LV', 'NL', 'NO', 'NZ', 'SE', 'SG', 'SI', 'SK'];
const EXPECTED_SCENARIOS = [
  'standard', 'credit_note_for_existing', 'warnings_only', 'needs_review_format', 'needs_review_business_rules', 'duplicate',
  'duplicate_exact', 'with_references', 'with_payment_terms', 'with_attachment', 'with_discounts', 'many_lines', 'unicode_text', 'foreign_supplier',
];
const countryFiles = ['packages/sdk/src/simulation-countries.ts', 'packages/mcp/src/index.ts', 'packages/cli/src/program.ts'];
const read = (f) => readFileSync(join(root, f), 'utf8');
const same = (a, b) => a && a.length === b.length && a.every((x, i) => x === b[i]);

let failed = false;
const fail = (message) => { console.error(message); failed = true; };

for (const f of countryFiles) {
  const m = read(f).match(/const SIMULATION_COUNTRY_CODES\s*=\s*\[([^\]]*)\]/);
  const got = m ? [...m[1].matchAll(/'([A-Z]{2})'/g)].map((x) => x[1]) : null;
  if (!same(got, EXPECTED)) fail(`${f}: simulator country list is ${got ? got.join(',') : 'missing'}, expected ${EXPECTED.join(',')}`);
}

const scenarioEntries = (f) => {
  const m = read(f).match(/const SIMULATION_SCENARIOS = \[([\s\S]*?)\] as const;/);
  return m ? [...m[1].matchAll(/\{ id: '([a-z_]+)', description: '((?:[^'\\]|\\.)*)' \}/g)].map((x) => [x[1], x[2]]) : null;
};
const sdk = scenarioEntries('packages/sdk/src/simulation-scenarios.ts');
const mcp = scenarioEntries('packages/mcp/src/index.ts');
if (!same(sdk?.map((e) => e[0]), EXPECTED_SCENARIOS)) fail(`packages/sdk/src/simulation-scenarios.ts: scenarios are ${sdk ? sdk.map((e) => e[0]).join(',') : 'missing'}, expected ${EXPECTED_SCENARIOS.join(',')}`);
if (!same(mcp?.map((e) => e[0]), EXPECTED_SCENARIOS)) fail(`packages/mcp/src/index.ts: scenarios are ${mcp ? mcp.map((e) => e[0]).join(',') : 'missing'}, expected ${EXPECTED_SCENARIOS.join(',')}`);
if (sdk && mcp && !same(sdk.map((e) => e.join('|')), mcp.map((e) => e.join('|')))) fail('The scenario descriptions differ between the SDK and the MCP server');
const cli = read('packages/cli/src/program.ts').match(/const SIMULATION_SCENARIO_IDS = \[([^\]]*)\]/);
const cliIds = cli ? [...cli[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : null;
if (!same(cliIds, EXPECTED_SCENARIOS)) fail(`packages/cli/src/program.ts: scenarios are ${cliIds ? cliIds.join(',') : 'missing'}, expected ${EXPECTED_SCENARIOS.join(',')}`);

const openapiPath = process.env.CLEARVO_MARKETING_OPENAPI_PATH;
if (openapiPath && existsSync(openapiPath)) {
  const spec = JSON.parse(readFileSync(openapiPath, 'utf8'));
  const schema = spec.paths?.['/v1/receive/simulate']?.post?.requestBody?.content?.['application/json']?.schema?.properties?.scenario;
  if (!same(schema?.enum, EXPECTED_SCENARIOS)) fail(`${openapiPath}: scenario enum is ${schema?.enum ? schema.enum.join(',') : 'missing'}, expected ${EXPECTED_SCENARIOS.join(',')}`);
}

if (failed) process.exit(1);
console.log(`OK - SDK, MCP and CLI all list the ${EXPECTED.length} simulator countries and the ${EXPECTED_SCENARIOS.length} scenarios`);
