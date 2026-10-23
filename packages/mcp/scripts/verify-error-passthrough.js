#!/usr/bin/env node
'use strict';

// Error passthrough of the stdio MCP server, against a mock API:
//  - a failed call keeps field errors (flatten-style details and issues[]), errors[], hint, Retry-After, Request-Id;
//  - a non-JSON gateway page (502/504) and a 413 say what happened and may have been processed; rawBody is shown;
//  - a 2xx with an empty body is { ok: true, status }, a 2xx that is not JSON is an error;
//  - a 2xx whose body is a failure (ok:false, a top-level error) and a bulk submit with an ERRORED / NEEDS_INFO row are isError;
//  - a 402 plan_required keeps calculationId / monitorOnly / upgradeUrl in the result; a plan gate shows the upgrade link;
//  - a network failure says the request may not have arrived;
//  - every nullable PATCH field of update_customer / update_supplier / update_bank_account accepts null in its inputSchema.
//
// Usage: npm run build && node scripts/verify-error-passthrough.js

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

let next = { status: 200, headers: {}, body: '{}' };
const api = http.createServer((req, res) => {
  req.on('data', () => {});
  req.on('end', () => {
    res.writeHead(next.status, { 'Content-Type': 'application/json', ...next.headers });
    res.end(next.body);
  });
});

function startServer(baseUrl) {
  const child = spawn('node', [SERVER], { cwd: path.dirname(SERVER), env: { ...process.env, CLEARVO_API_KEY: 'csk_test_verifyerrors', CLEARVO_BASE_URL: baseUrl } });
  child.stderr.on('data', () => {});
  const pending = new Map();
  readline.createInterface({ input: child.stdout }).on('line', line => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  });
  let id = 0;
  const call = (method, params) => new Promise(resolve => {
    id += 1;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  return { child, call };
}

let main;
function fail(message) {
  console.error(message);
  main?.child.kill();
  api.close();
  process.exit(1);
}
const json = (o) => JSON.stringify(o);
async function tool(name, args, reply) {
  next = { status: 200, headers: {}, ...reply };
  const r = await main.call('tools/call', { name, arguments: args });
  const result = r.result ?? { isError: true, content: [{ text: JSON.stringify(r.error) }] };
  return { isError: result.isError === true, text: result.content?.[0]?.text ?? '' };
}
function expect(cond, message) { if (!cond) fail(message); }

api.listen(0, '127.0.0.1', async () => {
  const baseUrl = `http://127.0.0.1:${api.address().port}/v1`;
  main = startServer(baseUrl);
  const timeout = setTimeout(() => fail('Timed out'), 30000);
  await main.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-error-passthrough', version: '0' } });
  const list = await main.call('tools/list', {});
  const tools = list.result?.tools ?? [];

  // 1. Field errors, hint, Retry-After, Request-Id.
  let r = await tool('get_bulk_upload_status', { batchId: 'b1' }, {
    status: 400, headers: { 'x-request-id': 'req_77', 'retry-after': '4' },
    body: json({ error: 'Invalid request body', code: 'VALIDATION_ERROR', hint: 'Fix the fields', details: { formErrors: [], fieldErrors: { country: ['must be 2 characters'] } } }),
  });
  expect(r.isError, 'a 400 must be isError');
  for (const s of ['HTTP 400: Invalid request body: country: must be 2 characters', 'Code: VALIDATION_ERROR', 'Hint: Fix the fields', '  - country: must be 2 characters', 'Retry-After: 4s', 'Request-Id: req_77']) {
    expect(r.text.includes(s), `a 400 must say "${s}": ${r.text}`);
  }

  // 2. issues[] with full dotted paths win over the top-level key.
  r = await tool('get_bulk_upload_status', { batchId: 'b1' }, {
    status: 422, body: json({ error: 'Invalid request body', details: { fieldErrors: { countrySpecific: ['Invalid input'] } }, issues: [{ path: 'countrySpecific.de.invoiceFormat', message: 'Invalid enum value' }] }),
  });
  expect(r.text.includes('countrySpecific.de.invoiceFormat: Invalid enum value') && !r.text.includes('countrySpecific: Invalid input'), `issues[] paths must win: ${r.text}`);

  // 3. errors[].
  r = await tool('get_bulk_upload_status', { batchId: 'b1' }, { status: 422, body: json({ ok: false, errors: [{ code: 'E1', message: 'Row 3 is bad', field: 'row' }] }) });
  expect(r.isError && r.text.includes('Row 3 is bad') && r.text.includes('E1'), `errors[] must be listed: ${r.text}`);

  // 4. Gateway page.
  r = await tool('get_bulk_upload_status', { batchId: 'b1' }, { status: 504, headers: { 'Content-Type': 'text/html' }, body: '<html><body>Gateway Timeout</body></html>' });
  expect(r.isError && r.text.includes('gateway timeout or unavailable; the request may have been processed, check status before retrying') && r.text.includes('Gateway Timeout'), `504 HTML must be explained: ${r.text}`);
  r = await tool('get_bulk_upload_status', { batchId: 'b1' }, { status: 413, headers: { 'Content-Type': 'text/plain' }, body: 'Request Entity Too Large' });
  expect(r.isError && r.text.includes('payload too large'), `413 must say payload too large: ${r.text}`);

  // 5. 2xx bodies.
  r = await tool('get_bulk_upload_status', { batchId: 'b1' }, { status: 204, body: '' });
  expect(!r.isError && JSON.parse(r.text).ok === true && JSON.parse(r.text).status === 204, `empty 204 must be {ok:true,status}: ${r.text}`);
  r = await tool('get_bulk_upload_status', { batchId: 'b1' }, { status: 200, headers: { 'Content-Type': 'text/html' }, body: '<html>login</html>' });
  expect(r.isError && r.text.includes('Unexpected non-JSON response'), `a non-JSON 200 must be an error: ${r.text}`);
  r = await tool('get_bulk_upload_status', { batchId: 'b1' }, { status: 200, body: json({ ok: false, error: 'Batch failed' }) });
  expect(r.isError && r.text.includes('Batch failed'), `ok:false on a 200 must be isError: ${r.text}`);
  r = await tool('get_bulk_upload_status', { batchId: 'b1' }, { status: 200, body: json({ error: 'Something went wrong', code: 'X' }) });
  expect(r.isError, 'a top-level error on a 200 must be isError');
  r = await tool('get_bulk_upload_status', { batchId: 'b1' }, { status: 200, body: json({ batchId: 'b1', status: 'COMPLETED', error: null }) });
  expect(!r.isError, 'a healthy 200 (error: null) must not be an error');

  // 6. Bulk rows.
  const bulk = (rows) => ({ status: 200, body: json({ ok: true, batchId: 'b2', status: 'COMPLETED', completedInline: true, summary: { total: rows.length }, rows, rowsTruncated: false, continuation: null }) });
  r = await tool('submit_invoices_bulk', { csvContent: 'a,b\n1,2\n' }, bulk([{ rowNumber: 1, outcome: 'ACCEPTED' }, { rowNumber: 2, outcome: 'ERRORED', errorMessage: 'Bad date' }]));
  expect(r.isError && r.text.includes('Bad date'), `a bulk ERRORED row must be isError with the body: ${r.text}`);
  r = await tool('submit_invoices_bulk', { csvContent: 'a,b\n1,2\n' }, bulk([{ rowNumber: 1, outcome: 'NEEDS_INFO' }]));
  expect(r.isError, 'a bulk NEEDS_INFO row must be isError');
  r = await tool('submit_invoices_bulk', { csvContent: 'a,b\n1,2\n' }, bulk([{ rowNumber: 1, outcome: 'ACCEPTED' }]));
  expect(!r.isError, 'an all-ACCEPTED bulk result must not be an error');
  const big = ['h'].concat(Array.from({ length: 800 }, (_, i) => `r${i}`)).join('\n');
  r = await tool('submit_invoices_bulk', { csvContent: big }, { status: 202, body: json({ ok: true, batchId: 'b3', status: 'UPLOADED', completedInline: false, pollUrl: '/v1/send/bulk/b3', rowsUrl: '/v1/send/bulk/b3/rows' }) });
  expect(!r.isError && r.text.includes('b3'), `800 rows are no longer refused client-side, and a 202 is not an error: ${r.text}`);

  // 7. Plan handling.
  r = await tool('calculate_tax', { country: 'DE', lineItems: [] }, {
    status: 402, body: json({ error: 'plan_required', reason: 'custom_api_requires_growth', calculationId: 'calc_1', monitorOnly: true, message: 'Upgrade to Growth', upgradeUrl: 'https://app.clearvo.io/billing' }),
  });
  expect(!r.text.startsWith('Error:') && r.text.includes('"calculationId": "calc_1"') && r.text.includes('"monitorOnly": true') && r.text.includes('"upgradeUrl"'), `402 plan_required must keep its body: ${r.text}`);
  expect(r.isError, 'a plan_required result carries no amounts, so it is flagged isError');
  r = await tool('get_bulk_upload_status', { batchId: 'b1' }, { status: 403, body: json({ error: 'ecm_not_included', message: 'Exemption certificates are not in your plan', upgradeUrl: 'https://app.clearvo.io/billing' }) });
  expect(r.isError && r.text.includes('Exemption certificates are not in your plan') && r.text.includes('Upgrade: https://app.clearvo.io/billing') && r.text.includes('Code: ecm_not_included'), `a plan gate must show the sentence and the link: ${r.text}`);

  // 8. Network failure (nothing listening).
  const dead = http.createServer();
  await new Promise(resolve => dead.listen(0, '127.0.0.1', resolve));
  const deadPort = dead.address().port;
  await new Promise(resolve => dead.close(resolve));
  const offline = startServer(`http://127.0.0.1:${deadPort}/v1`);
  await offline.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-error-passthrough', version: '0' } });
  const net = await offline.call('tools/call', { name: 'get_bulk_upload_status', arguments: { batchId: 'b1' } });
  offline.child.kill();
  expect(net.result?.isError && net.result.content[0].text.includes('Network error') && net.result.content[0].text.includes('NETWORK_ERROR'), `a network failure must be explained: ${JSON.stringify(net.result)}`);

  // 9. Nullable PATCH fields.
  const nullable = {
    update_customer: ['country', 'taxId', 'customerRef', 'addressCountry', 'addressLine1', 'addressLine2', 'city', 'region', 'postalCode'],
    update_supplier: ['country', 'taxId', 'supplierRef', 'establishmentCountry', 'addressLine1', 'addressLine2', 'city', 'region', 'postalCode', 'toleranceOverride'],
    update_bank_account: ['currency', 'bic', 'accountHolderName'],
  };
  for (const [name, fields] of Object.entries(nullable)) {
    const t = tools.find(x => x.name === name);
    expect(t, `${name} is missing from tools/list`);
    for (const f of fields) {
      const type = t.inputSchema.properties[f]?.type;
      expect(Array.isArray(type) && type.includes('null'), `${name}.${f} must accept null (type is ${JSON.stringify(type)})`);
    }
  }

  clearTimeout(timeout);
  console.log('OK — field errors, gateway pages, empty and non-JSON 2xx, 2xx failure bodies, bulk rows, 402 plan_required, network errors and nullable PATCH fields all pass through.');
  main.child.kill();
  api.close();
  process.exit(0);
});
