#!/usr/bin/env node
'use strict';

// The E-Invoicing settings tools (optional live tax-number check on sent invoices): asserts tools/list carries
// get_einvoicing_settings and update_einvoicing_settings with the hosted connector's schema, and that the tax
// settings tools no longer mention validateTaxNumbersOnSend.
//
// Usage: npm run build && node scripts/verify-einvoicing-settings-tools.js

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const SERVER = path.join(__dirname, '..', 'dist', 'index.js');
if (!fs.existsSync(SERVER)) {
  console.error('Missing dist/index.js — run "npm run build" first.');
  process.exit(1);
}

const child = spawn('node', [SERVER], {
  cwd: path.dirname(SERVER),
  env: { ...process.env, CLEARVO_API_KEY: 'csk_test_verifyeinvoicingsettings' },
});
child.stderr.on('data', () => {});

function fail(message) {
  console.error(`FAIL — ${message}`);
  child.kill();
  process.exit(1);
}

const pending = new Map();
function call(id, method, params) {
  return new Promise(resolve => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

readline.createInterface({ input: child.stdout }).on('line', line => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
});

const timeout = setTimeout(() => fail('Timed out waiting for a tools/list response'), 5000);

(async () => {
  await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-einvoicing-settings-tools', version: '0' } });
  const response = await call(2, 'tools/list', {});
  clearTimeout(timeout);
  const byName = new Map((response.result?.tools ?? []).map(t => [t.name, t]));

  const get = byName.get('get_einvoicing_settings');
  const update = byName.get('update_einvoicing_settings');
  if (!get) return fail('get_einvoicing_settings is missing from tools/list');
  if (!update) return fail('update_einvoicing_settings is missing from tools/list');
  if (Object.keys(get.inputSchema?.properties ?? {}).length !== 0) return fail('get_einvoicing_settings takes no input');
  const prop = update.inputSchema?.properties?.validateTaxNumbersOnSend;
  if (!prop || JSON.stringify(prop.type) !== JSON.stringify(['boolean', 'null'])) return fail('update_einvoicing_settings.validateTaxNumbersOnSend must be boolean or null');
  if (get.annotations?.readOnlyHint !== true) return fail('get_einvoicing_settings must be read-only');
  if (update.annotations?.readOnlyHint !== false) return fail('update_einvoicing_settings must not be read-only');

  for (const name of ['get_tax_settings', 'update_tax_settings']) {
    const tool = byName.get(name);
    if (!tool) return fail(`${name} is missing from tools/list`);
    if (JSON.stringify(tool).includes('validateTaxNumbersOnSend')) return fail(`${name} still mentions validateTaxNumbersOnSend`);
  }

  console.log('OK — get_einvoicing_settings and update_einvoicing_settings present; tax settings tools do not mention validateTaxNumbersOnSend.');
  child.kill();
  process.exit(0);
})();
