#!/usr/bin/env node
'use strict';

// Coverage for the Filings tools (setup, return lifecycle, data upload): asserts tools/list carries all of them with the
// fields the public API takes (including the declaration on process_filing_upload_month), then calls each tool against a
// local stub of the API and checks the verb, path, body and multipart upload it sends. Mirrors the hosted connector's
// own tests (Taxually-Einvoicing tests/unit/mcp/filing-upload-tools.test.ts).
//
// Usage: npm run build && node scripts/verify-filings-tools.js

const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'dist', 'index.js');
if (!fs.existsSync(SERVER)) {
  console.error(`Missing ${path.relative(ROOT, SERVER)} — run "npm run build" first.`);
  process.exit(1);
}

const REQUIRED = [
  'get_registration_filing_setup', 'update_registration_filing_setup', 'list_filing_setups', 'get_filing_bank_account',
  'list_filings', 'get_filing', 'approve_filing', 'undo_filing_approval', 'pause_filing', 'resume_filing', 'skip_filing',
  'set_filing_prepayment', 'list_filing_change_requests', 'request_filing_change', 'generate_sandbox_filing',
  'list_filing_upload_months', 'get_filing_upload_month', 'upload_filing_data_file', 'replace_filing_data_file',
  'delete_filing_data_file', 'process_filing_upload_month', 'get_filing_upload_error_report',
  'get_filing_upload_template',
];

const requests = [];
let nextStatus = 200;
let nextBody = { ok: true };
const api = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    const status = nextStatus;
    const body = nextBody;
    nextStatus = 200;
    nextBody = { ok: true };
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
});

let child;
const pending = new Map();
function rpc(id, method, params) {
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function fail(message) {
  console.error(`FAIL — ${message}`);
  child?.kill();
  api.close();
  process.exit(1);
}
function assert(cond, message) { if (!cond) fail(message); }

let id = 10;
async function callTool(name, args) {
  requests.length = 0;
  const msg = await rpc(id++, 'tools/call', { name, arguments: args });
  return { msg, text: msg.result?.content?.[0]?.text ?? '', isError: !!msg.result?.isError };
}
const only = () => { assert(requests.length === 1, `expected one request, saw ${requests.length}`); return requests[0]; };

api.listen(0, '127.0.0.1', async () => {
  const port = api.address().port;
  child = spawn('node', [SERVER], {
    cwd: path.dirname(SERVER),
    env: { ...process.env, CLEARVO_API_KEY: 'csk_test_verifyfilingstools', CLEARVO_ENTITY_ID: 'ent-1', CLEARVO_BASE_URL: `http://127.0.0.1:${port}/v1` },
  });
  child.stderr.on('data', () => {});
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  });
  const timeout = setTimeout(() => fail('timed out'), 20000);

  await rpc(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-filings-tools', version: '0' } });
  const tools = (await rpc(2, 'tools/list', {})).result?.tools ?? [];
  const byName = new Map(tools.map((t) => [t.name, t]));

  const missing = REQUIRED.filter((n) => !byName.has(n));
  assert(missing.length === 0, `missing tools: ${missing.join(', ')}`);

  const proc = byName.get('process_filing_upload_month').inputSchema;
  for (const k of ['month', 'declarationAccepted', 'declarationVersion']) assert(proc.properties?.[k], `process_filing_upload_month is missing ${k}`);
  assert(!proc.properties?.acknowledgeRejectedRows, 'process_filing_upload_month must not take acknowledgeRejectedRows');
  assert(!byName.has('close_filing_upload_month'), 'close_filing_upload_month was removed: a month is finished by approving the return');
  const up = byName.get('upload_filing_data_file').inputSchema;
  assert(JSON.stringify([...up.required].sort()) === JSON.stringify(['contentBase64', 'fileName', 'month']), 'upload_filing_data_file requires month, fileName and contentBase64');
  assert(!byName.get('upload_filing_data_file').annotations.readOnlyHint, 'upload_filing_data_file must not be read-only');
  assert(byName.get('get_filing_upload_month').annotations.readOnlyHint, 'get_filing_upload_month must be read-only');
  assert(byName.get('approve_filing').annotations.destructiveHint, 'approve_filing must be flagged destructive');

  const b64 = (s) => Buffer.from(s).toString('base64');
  let r;

  await callTool('list_filing_setups', {}); r = only();
  assert(r.method === 'GET' && r.url === '/v1/filings/setups', `list_filing_setups: ${r.method} ${r.url}`);
  assert(r.headers['x-entity-id'] === 'ent-1', 'the configured entity is sent as x-entity-id');

  await callTool('update_registration_filing_setup', { registrationId: 'reg 1', frequencyCode: 'Monthly', frequencyAttested: true, startChoice: 'asap', ignored: 1 }); r = only();
  assert(r.method === 'PUT' && r.url === '/v1/tax/registrations/reg%201/filing', `update_registration_filing_setup: ${r.method} ${r.url}`);
  assert(JSON.stringify(JSON.parse(r.body)) === JSON.stringify({ frequencyCode: 'Monthly', frequencyAttested: true, startChoice: 'asap' }), 'only the filing fields are sent');

  await callTool('list_filings', { view: 'upcoming', limit: 5 }); r = only();
  assert(r.method === 'GET' && r.url === '/v1/filings?view=upcoming&limit=5', `list_filings: ${r.url}`);

  for (const [tool, p] of [['approve_filing', 'approve'], ['undo_filing_approval', 'undo'], ['pause_filing', 'pause'], ['resume_filing', 'resume']]) {
    await callTool(tool, { filingId: 'fil_1', snapshotVersion: 3 }); r = only();
    assert(r.method === 'POST' && r.url === `/v1/filings/fil_1/${p}`, `${tool}: ${r.method} ${r.url}`);
    assert(JSON.parse(r.body).snapshotVersion === 3, `${tool} sends snapshotVersion`);
  }
  await callTool('pause_filing', { filingId: 'ret_1', snapshotVersion: 0, endDate: '2026-10-12' }); r = only();
  assert(r.url === '/v1/filings/ret_1/pause' && JSON.parse(r.body).endDate === '2026-10-12', 'pause_filing sends endDate');
  await callTool('skip_filing', { filingId: 'fil_1', snapshotVersion: 3, reason: 'Closed' }); r = only();
  assert(r.url === '/v1/filings/fil_1/skip' && JSON.parse(r.body).reason === 'Closed', 'skip_filing');
  await callTool('set_filing_prepayment', { filingId: 'fil_1', snapshotVersion: 3, amount: 5 }); r = only();
  assert(r.url === '/v1/filings/fil_1/prepayment' && JSON.parse(r.body).amount === 5, 'set_filing_prepayment');
  await callTool('request_filing_change', { filingId: 'fil_1', message: 'Fix it' }); r = only();
  assert(r.method === 'POST' && r.url === '/v1/filings/fil_1/change-requests', 'request_filing_change');
  await callTool('list_filing_change_requests', { filingId: 'fil_1' }); r = only();
  assert(r.method === 'GET' && r.url === '/v1/filings/fil_1/change-requests', 'list_filing_change_requests');
  await callTool('generate_sandbox_filing', { registrationId: 'reg-1' }); r = only();
  assert(r.url === '/v1/filings/sandbox/generate' && JSON.stringify(JSON.parse(r.body)) === '{"registrationId":"reg-1"}', 'generate_sandbox_filing');

  await callTool('list_filing_upload_months', {}); r = only();
  assert(r.url === '/v1/filings/upload/months', 'list_filing_upload_months');
  await callTool('get_filing_upload_month', { month: '2026-09' }); r = only();
  assert(r.url === '/v1/filings/upload/months/2026-09', 'get_filing_upload_month');
  await callTool('get_filing_upload_error_report', { month: '2026-09', fileId: 'a/b' }); r = only();
  assert(r.url === '/v1/filings/upload/months/2026-09/files/a%2Fb/error-report', 'get_filing_upload_error_report');
  await callTool('get_filing_upload_template', {}); r = only();
  assert(r.url === '/v1/filings/upload/template?format=json', 'get_filing_upload_template');
  await callTool('delete_filing_data_file', { month: '2026-09', fileId: 'f1' }); r = only();
  assert(r.method === 'DELETE' && r.url === '/v1/filings/upload/months/2026-09/files/f1', 'delete_filing_data_file');

  await callTool('process_filing_upload_month', { month: '2026-09', declarationAccepted: true, declarationVersion: '2026-10-11.1' }); r = only();
  assert(r.method === 'POST' && r.url === '/v1/filings/upload/months/2026-09/process', 'process_filing_upload_month');
  assert(JSON.stringify(JSON.parse(r.body)) === '{"declarationAccepted":true,"declarationVersion":"2026-10-11.1"}', 'process sends the declaration and nothing else by default');
  await callTool('process_filing_upload_month', { month: '2026-09', declarationAccepted: true, declarationVersion: 'v', acknowledgeRejectedRows: true }); r = only();
  assert(JSON.stringify(JSON.parse(r.body)) === '{"declarationAccepted":true,"declarationVersion":"v"}', 'process never sends acknowledgeRejectedRows');

  // Upload: multipart, field "file", decoded content, no JSON content type.
  await callTool('upload_filing_data_file', { month: '2026-09', fileName: 'sales.csv', contentBase64: b64('a,b\n1,2\n') }); r = only();
  assert(r.method === 'POST' && r.url === '/v1/filings/upload/months/2026-09/files', 'upload_filing_data_file url');
  assert(String(r.headers['content-type']).startsWith('multipart/form-data; boundary='), `upload content-type: ${r.headers['content-type']}`);
  const text = r.body.toString('utf8');
  assert(text.includes('name="file"') && text.includes('filename="sales.csv"') && text.includes('a,b\n1,2\n'), 'upload carries the field "file", the file name and the decoded content');

  // Client-side checks never reach the API.
  for (const bad of [{ fileName: 'a.txt', contentBase64: b64('x') }, { fileName: 'a.csv', contentBase64: '' }]) {
    const out = await callTool('upload_filing_data_file', { month: '2026-09', ...bad });
    assert(out.isError && requests.length === 0, `a bad upload (${bad.fileName}) must fail before calling the API`);
  }

  // Replace = delete, then upload.
  await callTool('replace_filing_data_file', { month: '2026-09', fileId: 'f1', fileName: 'fixed.xlsx', contentBase64: b64('xx') });
  assert(requests.length === 2 && requests[0].method === 'DELETE' && requests[0].url.endsWith('/files/f1') && requests[1].method === 'POST' && requests[1].url.endsWith('/2026-09/files'), 'replace deletes then uploads');
  assert(requests[1].body.toString('utf8').includes('spreadsheetml'), 'an .xlsx is typed as a spreadsheet');
  // An API refusal surfaces with its status and sentence.
  nextStatus = 409; nextBody = { error: 'FILE_ALREADY_ADDED', message: 'This file is already added to this month.' };
  const refused = await callTool('upload_filing_data_file', { month: '2026-09', fileName: 'a.csv', contentBase64: b64('x') });
  assert(refused.isError && refused.text.includes('HTTP 409') && refused.text.includes('This file is already added'), `a 409 must surface: ${refused.text}`);
  assert(refused.text.includes('FILE_ALREADY_ADDED'), `the stable code must surface too: ${refused.text}`);
  assert(/HTTP 409: FILE_ALREADY_ADDED\nMessage: This file is already added/.test(refused.text), `upload refusals read as code, then Message: ${refused.text}`);
  nextStatus = 409; nextBody = { error: 'FILE_ALREADY_ADDED', message: 'Already added.', existingId: 'f9', reason: 'same_name' };
  const dup = await callTool('upload_filing_data_file', { month: '2026-09', fileName: 'a.csv', contentBase64: b64('x') });
  assert(dup.text.includes('Details: {"existingId":"f9","reason":"same_name"}'), `Details must carry the extra body fields: ${dup.text}`);
  nextStatus = 409; nextBody = { error: 'FILE_ERRORS', message: 'One or more files have errors.', filesWithErrors: 2 };
  const fe = await callTool('process_filing_upload_month', { month: '2026-09', declarationAccepted: true, declarationVersion: 'v' });
  assert(fe.text.includes('HTTP 409: FILE_ERRORS') && fe.text.includes('Details: {"filesWithErrors":2}'), `FILE_ERRORS details: ${fe.text}`);
  nextStatus = 409; nextBody = { error: 'SYSTEM_FILE_ERRORS', message: 'A file we prepared for you has errors.', filesWithErrors: 1, contactUrl: 'https://example.test/contact' };
  const sfe = await callTool('process_filing_upload_month', { month: '2026-09', declarationAccepted: true, declarationVersion: 'v' });
  assert(sfe.text.includes('SYSTEM_FILE_ERRORS') && sfe.text.includes('"contactUrl":"https://example.test/contact"'), `SYSTEM_FILE_ERRORS details: ${sfe.text}`);
  nextStatus = 422; nextBody = { error: 'DECLARATION_VERSION_MISMATCH', message: 'Changed.', currentVersion: 'v2', declaration: { version: 'v2', text: 'T' } };
  const mm = await callTool('process_filing_upload_month', { month: '2026-09', declarationAccepted: true, declarationVersion: 'v' });
  assert(mm.text.includes('"currentVersion":"v2"') && mm.text.includes('"declaration":{"version":"v2","text":"T"}'), `declaration details: ${mm.text}`);

  clearTimeout(timeout);
  console.log(`OK — ${REQUIRED.length} filings tools present; every tool dispatches to the documented verb, path and body; upload is multipart and checked client-side.`);
  child.kill();
  api.close();
  process.exit(0);
});
