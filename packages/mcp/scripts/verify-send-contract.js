#!/usr/bin/env node
'use strict';

// POST /v1/send answers HTTP 200 for every stored document, with the outcome in the body (ingest-first stage 9).
// Asserts (1) submit_invoice's description states that contract and no longer says a stored outcome is a 422 / 202,
// and (2) the tool returns a stored rejection's 200 body as its result (not an isError), while a real HTTP error
// (409) still surfaces as an error.
//
// Usage: npm run build && node scripts/verify-send-contract.js

const fs = require('fs');
const http = require('http');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const SERVER = path.join(__dirname, '..', 'dist', 'index.js');
if (!fs.existsSync(SERVER)) {
  console.error('Missing dist/index.js — run "npm run build" first.');
  process.exit(1);
}

const REJECTED = {
  ok: false, id: 'EI-IT-1', referenceId: 'EI-IT-1', clearanceStatus: 'REJECTED', outcome: 'REJECTED', statusClass: 'DONE_REJECTED', terminal: true,
  nextStep: { actor: 'merchant', message: 'Fix the customer address' },
  error: { code: 'MISSING_CUSTOMER_ADDRESS', message: 'Customer address is required' },
  errors: [{ errorCode: 'MISSING_CUSTOMER_ADDRESS', severity: 'ERROR', path: '/customer/address', message: 'Customer address is required' }],
};

const api = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    const conflict = body.invoiceNumber === 'EDITED';
    res.writeHead(conflict ? 409 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(conflict ? { error: { code: 'IDEMPOTENT_BODY_MISMATCH', message: 'edited resend' } } : REJECTED));
  });
});

let child;
const pending = new Map();
function call(id, method, params) {
  return new Promise(resolve => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function fail(message) {
  console.error(message);
  child?.kill();
  api.close();
  process.exit(1);
}

api.listen(0, '127.0.0.1', async () => {
  const baseUrl = `http://127.0.0.1:${api.address().port}/v1`;
  child = spawn('node', [SERVER], {
    cwd: path.dirname(SERVER),
    env: { ...process.env, CLEARVO_API_KEY: 'csk_test_verifysendcontract', CLEARVO_BASE_URL: baseUrl },
  });
  child.stderr.on('data', () => {});
  readline.createInterface({ input: child.stdout }).on('line', line => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  });
  const timeout = setTimeout(() => fail('Timed out'), 10000);

  await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-send-contract', version: '0' } });
  const list = await call(2, 'tools/list', {});
  const tool = (list.result?.tools ?? []).find(t => t.name === 'submit_invoice');
  if (!tool) return fail('submit_invoice is missing from tools/list');
  const d = tool.description;

  for (const phrase of ['A 200 means the document is STORED', '`outcome`', '`nextStep`', 'IDEMPOTENT_BODY_MISMATCH', 'INGEST_UNAVAILABLE', 'PROCESSING_DELAYED']) {
    if (!d.includes(phrase)) return fail(`submit_invoice description is missing: ${phrase}`);
  }
  for (const stale of ['202 ACCUMULATED', 'fails with 422', 'rejected with 422', 'fails 422', 'is a 422']) {
    if (d.includes(stale)) return fail(`submit_invoice description still says: ${stale}`);
  }
  const schemaText = JSON.stringify(tool.inputSchema);
  for (const stale of ['fails with 422', 'fails 422', 'rejected with 422', 'it would answer 422']) {
    if (schemaText.includes(stale)) return fail(`submit_invoice inputSchema still says: ${stale}`);
  }

  const stored = await call(3, 'tools/call', { name: 'submit_invoice', arguments: { country: 'IT', invoiceNumber: 'INV-1' } });
  if (stored.result?.isError) return fail(`submit_invoice threw for a stored rejection: ${JSON.stringify(stored.result)}`);
  const parsed = JSON.parse(stored.result.content[0].text);
  if (parsed.outcome !== 'REJECTED' || parsed.errors?.[0]?.errorCode !== 'MISSING_CUSTOMER_ADDRESS') return fail('submit_invoice did not return the 200 body');

  const edited = await call(4, 'tools/call', { name: 'submit_invoice', arguments: { country: 'IT', invoiceNumber: 'EDITED' } });
  if (!edited.result?.isError || !edited.result.content[0].text.includes('HTTP 409')) return fail('a 409 must still surface as an error');

  clearTimeout(timeout);
  console.log('OK — submit_invoice states the 200 contract and returns a stored rejection as its result; 409 still errors.');
  child.kill();
  api.close();
  process.exit(0);
});
