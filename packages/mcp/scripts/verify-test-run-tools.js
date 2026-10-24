#!/usr/bin/env node
'use strict';

// Coverage for the integration-test tools: asserts the MCP server's tools/list
// contains the ten test-run / test-case tools (names shared with the hosted
// connector's lib/mcp/tools.ts) plus the two sandbox simulators, that each
// carries the "not a certification" disclaimer, and that the input schemas list
// exactly the route body fields. Spawn-and-JSON-RPC like verify-supplier-tools.js.
//
// Usage: npm run build && node scripts/verify-test-run-tools.js

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'dist', 'index.js');

if (!fs.existsSync(SERVER)) {
  console.error(`Missing ${path.relative(ROOT, SERVER)} — run "npm run build" first.`);
  process.exit(1);
}

const child = spawn('node', [SERVER], {
  cwd: path.dirname(SERVER),
  env: { ...process.env, CLEARVO_API_KEY: 'csk_test_verifytestruntools' },
});
child.stderr.on('data', () => {}); // expected config warnings, not failures

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
    return; // ignore non-JSON-RPC stdout noise
  }
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
});

const timeout = setTimeout(() => fail('Timed out waiting for a tools/list response'), 5000);

const REQUIRED = {
  start_test_run: ['name', 'tags', 'caseIds', 'deadlineMinutes'],
  get_test_run: ['runId'],
  export_test_run: ['runId'],
  list_test_runs: [],
  list_test_cases: [],
  create_test_case: ['title', 'steps', 'expected', 'description', 'check', 'appliesWhen'],
  archive_test_case: ['caseId'],
  skip_test_case: ['caseId'],
  unskip_test_case: ['caseId'],
  get_test_case_catalogue: [],
};
const NEEDS_DISCLAIMER = Object.keys(REQUIRED);

(async () => {
  await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-test-run-tools', version: '0' } });
  const response = await call(2, 'tools/list', {});
  clearTimeout(timeout);

  const byName = new Map((response.result?.tools ?? []).map(t => [t.name, t]));

  const missing = [...Object.keys(REQUIRED), 'test_webhook', 'simulate_received_invoices'].filter(n => !byName.has(n));
  if (missing.length) return fail(`Missing tools from tools/list: ${missing.join(', ')}`);

  for (const [name, fields] of Object.entries(REQUIRED)) {
    const props = Object.keys(byName.get(name).inputSchema?.properties ?? {}).sort();
    if (JSON.stringify(props) !== JSON.stringify([...fields].sort())) {
      return fail(`${name}.inputSchema properties are [${props.join(', ')}], expected [${fields.join(', ')}]`);
    }
  }
  const noDisclaimer = NEEDS_DISCLAIMER.filter(n => !(byName.get(n).description ?? '').includes('not a certification'));
  if (noDisclaimer.length) return fail(`Tools without the disclaimer sentence: ${noDisclaimer.join(', ')}`);
  if (!(byName.get('create_test_case').inputSchema.required ?? []).includes('title')) return fail('create_test_case must require title');

  console.log(`OK - ${Object.keys(REQUIRED).length} test-run tools present with the disclaimer and the route body fields; test_webhook and simulate_received_invoices present.`);
  child.kill();
  process.exit(0);
})();

function fail(message) {
  console.error(message);
  child.kill();
  process.exit(1);
}
