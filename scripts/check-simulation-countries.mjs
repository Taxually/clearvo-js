#!/usr/bin/env node
// Fails when the sandbox received-invoice simulator country list differs between the SDK, MCP server and CLI
// (each declares `const SIMULATION_COUNTRY_CODES = [...]`), or from the 24 countries the backend supports.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED = ['AE', 'AT', 'AU', 'BE', 'CH', 'DE', 'DK', 'EE', 'FI', 'FR', 'HR', 'IE', 'IS', 'JP', 'LT', 'LU', 'LV', 'NL', 'NO', 'NZ', 'SE', 'SG', 'SI', 'SK'];
const files = ['packages/sdk/src/simulation-countries.ts', 'packages/mcp/src/index.ts', 'packages/cli/src/program.ts'];

let failed = false;
for (const f of files) {
  const m = readFileSync(join(root, f), 'utf8').match(/const SIMULATION_COUNTRY_CODES\s*=\s*\[([^\]]*)\]/);
  const got = m ? [...m[1].matchAll(/'([A-Z]{2})'/g)].map((x) => x[1]) : null;
  if (!got || got.length !== EXPECTED.length || got.some((c, i) => c !== EXPECTED[i])) {
    console.error(`${f}: simulator country list is ${got ? got.join(',') : 'missing'}, expected ${EXPECTED.join(',')}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`OK - SDK, MCP and CLI all list the ${EXPECTED.length} simulator countries`);
