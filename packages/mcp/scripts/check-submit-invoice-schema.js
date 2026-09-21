#!/usr/bin/env node
'use strict';

// Regression guard for the e-invoicing `buyer` -> `customer` rename
// (decision D5, story S11 / clearvo-js story J2): asserts the built MCP
// server's `submit_invoice` tool schema names its counterparty party
// `customer` (required) and carries no `buyer`-named property anywhere in
// its inputSchema. Run after `npm run build` (uses dist/index.js directly —
// not the .mcpb bundle smoke-test-mcpb.js exercises).
//
// Same spawn-and-talk-JSON-RPC-over-stdio approach as smoke-test-mcpb.js.

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
  cwd: ROOT,
  env: { ...process.env, CLEARVO_API_KEY: 'csk_test_schemacheck' },
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

// Recursively collects every property key name found anywhere in a JSON
// Schema's `properties` objects (including nested objects and array items).
function collectPropertyNames(schema, out = new Set()) {
  if (!schema || typeof schema !== 'object') return out;
  if (schema.properties && typeof schema.properties === 'object') {
    for (const key of Object.keys(schema.properties)) {
      out.add(key);
      collectPropertyNames(schema.properties[key], out);
    }
  }
  if (schema.items) collectPropertyNames(schema.items, out);
  return out;
}

(async () => {
  await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'schema-check', version: '0' } });
  const response = await call(2, 'tools/list', {});
  clearTimeout(timeout);

  const submitInvoice = (response.result?.tools ?? []).find(t => t.name === 'submit_invoice');
  if (!submitInvoice) return fail('submit_invoice tool not found in tools/list response');

  const schema = submitInvoice.inputSchema;
  const required = schema.required ?? [];
  const allProps = collectPropertyNames(schema);

  const problems = [];
  if (!required.includes('customer')) problems.push('submit_invoice.inputSchema.required is missing "customer"');
  if (required.includes('buyer')) problems.push('submit_invoice.inputSchema.required still names "buyer"');
  // buyerReference is a standard EN16931 (BT-10) identifier — deliberately NOT part of the rename.
  const leftoverBuyerProps = [...allProps].filter(p => /buyer/i.test(p) && p !== 'buyerReference');
  if (leftoverBuyerProps.length) {
    problems.push(`submit_invoice.inputSchema still has buyer-named propert${leftoverBuyerProps.length === 1 ? 'y' : 'ies'}: ${leftoverBuyerProps.join(', ')}`);
  }

  if (problems.length) return fail(problems.join('\n'));

  console.log('OK — submit_invoice schema names its counterparty "customer" with no leftover "buyer" property.');
  child.kill();
  process.exit(0);
})();

function fail(message) {
  console.error(message);
  child.kill();
  process.exit(1);
}
