#!/usr/bin/env node
'use strict';

// Coverage for the explicit supplier/customer role model (story J1): asserts
// the MCP server's tools/list actually contains the four supplier tools
// (mirroring list_customers/create_customer/update_customer/delete_customer)
// with `supplierRef` where the mirrored customer tool carries `customerRef`
// (list_customers' description and create_customer/update_customer's own
// property — delete_customer never mentions customerRef either, so
// delete_supplier is only checked for `supplierId`) — a regression here
// means the schema drifted back towards the customer-only shape. Same
// spawn-and-JSON-RPC approach as scripts/smoke-test-mcpb.js, but against the
// plain `npm run build` output (packages/mcp/dist/index.js) rather than the
// packaged .mcpb bundle.
//
// Usage: npm run build && node scripts/verify-supplier-tools.js

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

const REQUIRED_SUPPLIER_TOOLS = ['list_suppliers', 'create_supplier', 'update_supplier', 'delete_supplier'];

const child = spawn('node', [SERVER], {
  cwd: path.dirname(SERVER),
  env: { ...process.env, CLEARVO_API_KEY: 'csk_test_verifysuppliertools' },
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

(async () => {
  await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-supplier-tools', version: '0' } });
  const response = await call(2, 'tools/list', {});
  clearTimeout(timeout);

  const tools = response.result?.tools ?? [];
  const byName = new Map(tools.map(t => [t.name, t]));

  const missing = REQUIRED_SUPPLIER_TOOLS.filter(name => !byName.has(name));
  if (missing.length) {
    return fail(`Missing supplier tools from tools/list: ${missing.join(', ')}`);
  }

  // list_suppliers/create_supplier/update_supplier all name supplierRef
  // (mirroring where list_customers/create_customer/update_customer name
  // customerRef); delete_supplier — like delete_customer — identifies the
  // record by its Clearvo id (supplierId) instead, so it's checked separately.
  const mustMentionSupplierRef = ['list_suppliers', 'create_supplier', 'update_supplier'];
  const missingSupplierRef = mustMentionSupplierRef.filter(name => {
    const tool = byName.get(name);
    const schemaText = JSON.stringify(tool.inputSchema ?? {}) + (tool.description ?? '');
    return !schemaText.includes('supplierRef');
  });
  if (missingSupplierRef.length) {
    return fail(`Supplier tools that don't mention "supplierRef": ${missingSupplierRef.join(', ')}`);
  }

  const deleteSchema = byName.get('delete_supplier').inputSchema ?? {};
  if (!deleteSchema.properties?.supplierId) {
    return fail('delete_supplier.inputSchema is missing supplierId');
  }

  // calculate_tax must accept transactionDirection/supplier and no longer
  // require `customer` — the other half of story J1.
  const calcTool = byName.get('calculate_tax');
  if (!calcTool) return fail('calculate_tax is missing from tools/list');
  const calcSchema = calcTool.inputSchema ?? {};
  if (!calcSchema.properties?.transactionDirection) return fail('calculate_tax.inputSchema is missing transactionDirection');
  if (!calcSchema.properties?.supplier) return fail('calculate_tax.inputSchema is missing supplier');
  if ((calcSchema.required ?? []).includes('customer')) return fail('calculate_tax.inputSchema still requires customer — it must be optional now that transactionDirection can be "purchase"');

  console.log(`OK — ${REQUIRED_SUPPLIER_TOOLS.length} supplier tools present with supplierRef in schema, and calculate_tax carries transactionDirection/supplier with customer no longer required.`);
  child.kill();
  process.exit(0);
})();

function fail(message) {
  console.error(message);
  child.kill();
  process.exit(1);
}
