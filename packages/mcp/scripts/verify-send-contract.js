#!/usr/bin/env node
'use strict';

// POST /v1/send answers HTTP 200 for every stored document, with the outcome in the body (ingest-first stage 9).
// Asserts (1) submit_invoice's description states that contract and no longer says a stored outcome is a 422 / 202,
// and (2) the tool returns a stored REJECTED / NEEDS_INFO 200 body in full but flags the result isError so an agent
// does not treat the document as sent; a CLEARED 200 is not an error, and a real HTTP error (409) still errors.
// Also guards the description against internal engineering status and against losing the country guidance.
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

const NEEDS_INFO = { ...REJECTED, id: 'EI-IT-2', referenceId: 'EI-IT-2', clearanceStatus: 'NEEDS_INFO', outcome: 'NEEDS_INFO', statusClass: 'WAIT_MERCHANT', terminal: false };
const CLEARED = { ok: true, id: 'EI-IT-3', referenceId: 'EI-IT-3', clearanceStatus: 'PENDING', outcome: 'CLEARED', statusClass: 'IN_FLIGHT', terminal: false };

const PROCESSING = { ok: true, id: 'EI-IT-4', referenceId: 'EI-IT-4', clearanceStatus: 'RECEIVED', outcome: 'PROCESSING', statusClass: 'IN_FLIGHT', terminal: false };
const UNROUTABLE = { ok: false, id: 'EI-IT-5', referenceId: 'EI-IT-5', clearanceStatus: 'UNROUTABLE', outcome: 'NEEDS_INFO', statusClass: 'WAIT_MERCHANT', terminal: false };

const api = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    const conflict = body.invoiceNumber === 'EDITED';
    res.writeHead(conflict ? 409 : 200, { 'Content-Type': 'application/json' });
    const reply = body.invoiceNumber === 'NEEDS' ? NEEDS_INFO : body.invoiceNumber === 'OK' ? CLEARED : body.invoiceNumber === 'PROC' ? PROCESSING : body.invoiceNumber === 'ACT' ? UNROUTABLE : REJECTED;
    res.end(JSON.stringify(conflict ? { error: { code: 'IDEMPOTENT_BODY_MISMATCH', message: 'edited resend' } } : reply));
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
  // Restored guidance (lost in the stage 9 sync) and the wording rules for customer-facing text.
  for (const marker of ['PEPPOL_CUSTOMER_UNREACHABLE', 'selfBilling', 'Canary Islands', 'IGIC', 'F2', 'es_tax_territory', 'VERIFACTU_TAX_TERRITORY_REQUIRED', 'error.alternatives', 'ZUGFERD', 'XRECHNUNG', 'DE_SELF_BILLED_PEPPOL_NOT_SUPPORTED']) {
    if (!d.includes(marker)) return fail(`submit_invoice description lost guidance: ${marker}`);
  }
  for (const phrase of ['JURISDICTION_AMBIGUOUS', 'JURISDICTION_UNKNOWN', 'supplier name and address never need re-sending']) {
    if (!d.includes(phrase)) return fail(`submit_invoice description lost the reporting-country guidance: ${phrase}`);
  }
  if (!/Required when no supplier\.taxId is sent and the business is registered in more than one country/.test(tool.inputSchema?.properties?.country?.description ?? '')) return fail('submit_invoice inputSchema.country lost its conditional-required wording');
  if ((tool.inputSchema?.required ?? []).includes('country')) return fail('submit_invoice must not require country');
  for (const forbidden of ['AT certificate', 'until Clearvo', 'PT_SOFTWARE_CERTIFICATION_PENDING', 'closed-gate', 'has not opened']) {
    if (d.includes(forbidden)) return fail(`submit_invoice description has internal status wording: ${forbidden}`);
  }
  const schemaText = JSON.stringify(tool.inputSchema);
  for (const stale of ['fails with 422', 'fails 422', 'rejected with 422', 'it would answer 422']) {
    if (schemaText.includes(stale)) return fail(`submit_invoice inputSchema still says: ${stale}`);
  }

  const stored = await call(3, 'tools/call', { name: 'submit_invoice', arguments: { country: 'IT', invoiceNumber: 'INV-1' } });
  if (stored.result?.isError !== true) return fail(`a stored REJECTED must be flagged isError: ${JSON.stringify(stored.result)}`);
  const parsed = JSON.parse(stored.result.content[0].text);
  if (parsed.outcome !== 'REJECTED' || parsed.errors?.[0]?.errorCode !== 'MISSING_CUSTOMER_ADDRESS') return fail('submit_invoice did not return the full 200 body');

  const needs = await call(5, 'tools/call', { name: 'submit_invoice', arguments: { country: 'IT', invoiceNumber: 'NEEDS' } });
  if (needs.result?.isError !== true) return fail('a stored NEEDS_INFO must be flagged isError');
  if (JSON.parse(needs.result.content[0].text).outcome !== 'NEEDS_INFO') return fail('NEEDS_INFO body must still be returned in full');

  const ok = await call(6, 'tools/call', { name: 'submit_invoice', arguments: { country: 'IT', invoiceNumber: 'OK' } });
  if (ok.result?.isError) return fail('a CLEARED 200 must not be an error');

  const proc = await call(7, 'tools/call', { name: 'submit_invoice', arguments: { country: 'IT', invoiceNumber: 'PROC' } });
  if (proc.result?.isError) return fail('PROC must not be flagged isError (matches hosted MCP)');
  // UNROUTABLE answers outcome NEEDS_INFO (one outcome for needs-info and unroutable): flagged like every NEEDS_INFO.
  const unroutable = await call(8, 'tools/call', { name: 'submit_invoice', arguments: { country: 'IT', invoiceNumber: 'ACT' } });
  if (unroutable.result?.isError !== true) return fail('an UNROUTABLE (outcome NEEDS_INFO) must be flagged isError');
  const desc = tool.description;
  for (const needle of ['PROCESSING', 'UNROUTABLE', 'SETUP_NEEDED and HELD_PLATFORM_FAULT']) {
    if (!desc.includes(needle)) return fail(`submit_invoice description must mention ${needle}`);
  }

  const edited = await call(4, 'tools/call', { name: 'submit_invoice', arguments: { country: 'IT', invoiceNumber: 'EDITED' } });
  if (!edited.result?.isError || !edited.result.content[0].text.includes('HTTP 409')) return fail('a 409 must still surface as an error');

  clearTimeout(timeout);
  console.log('OK — submit_invoice states the 200 contract and returns a stored rejection in full with isError; 409 still errors.');
  child.kill();
  api.close();
  process.exit(0);
});
