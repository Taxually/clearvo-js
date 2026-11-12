#!/usr/bin/env node
'use strict';

// API change process: asserts the stdio server exposes list_deprecations and list_changelog with the same input
// schemas as the hosted connector (Taxually-Einvoicing lib/mcp/tools.ts), and that each dispatches a GET to
// /v1/deprecations and /v1/changelog (limit and cursor forwarded). Spawns the built server against a local HTTP stub.
//
// Usage: npm run build && node scripts/verify-api-change-tools.js

const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { spawn } = require('child_process');

const SERVER = path.join(__dirname, '..', 'dist', 'index.js');
if (!fs.existsSync(SERVER)) {
  console.error('Missing dist/index.js, run "npm run build" first.');
  process.exit(1);
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const requests = [];
const stub = http.createServer((req, res) => {
  requests.push({ method: req.method, url: req.url });
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true, data: [], nextCursor: null }));
});

stub.listen(0, '127.0.0.1', () => {
  const port = stub.address().port;
  const child = spawn('node', [SERVER], {
    env: { ...process.env, CLEARVO_API_KEY: 'csk_test_verifyapichange', CLEARVO_BASE_URL: `http://127.0.0.1:${port}/v1` },
  });
  child.stderr.on('data', () => {});
  const pending = new Map();
  const call = (id, method, params) => new Promise(resolve => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  readline.createInterface({ input: child.stdout }).on('line', line => {
    try { const m = JSON.parse(line); pending.get(m.id)?.(m); pending.delete(m.id); } catch { /* not JSON-RPC */ }
  });
  const timeout = setTimeout(() => fail('timed out'), 8000);

  (async () => {
    await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-api-change-tools', version: '0' } });
    const tools = new Map(((await call(2, 'tools/list', {})).result?.tools ?? []).map(t => [t.name, t]));

    const dep = tools.get('list_deprecations');
    if (!dep) return fail('list_deprecations missing');
    if (JSON.stringify(dep.inputSchema) !== JSON.stringify({ type: 'object', properties: {} })) return fail('list_deprecations takes no inputs');

    const log = tools.get('list_changelog');
    if (!log) return fail('list_changelog missing');
    const expected = {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Entries per page (default 20).' },
        cursor: { type: 'string', description: 'The nextCursor value from the previous page.' },
      },
    };
    if (JSON.stringify(log.inputSchema) !== JSON.stringify(expected)) return fail('list_changelog inputSchema drifted from the hosted connector');
    for (const t of [dep, log]) if (t.annotations?.readOnlyHint !== true) return fail(`${t.name} must be read-only`);

    await call(3, 'tools/call', { name: 'list_deprecations', arguments: {} });
    await call(4, 'tools/call', { name: 'list_changelog', arguments: { limit: 5, cursor: 'abc' } });
    await call(5, 'tools/call', { name: 'list_changelog', arguments: {} });
    const seen = requests.map(r => `${r.method} ${r.url}`);
    const want = ['GET /v1/deprecations', 'GET /v1/changelog?limit=5&cursor=abc', 'GET /v1/changelog'];
    if (JSON.stringify(seen) !== JSON.stringify(want)) return fail(`dispatch mismatch: ${JSON.stringify(seen)}`);

    clearTimeout(timeout);
    console.log('OK: list_deprecations and list_changelog match the hosted connector and dispatch the right GETs');
    child.kill();
    stub.close();
  })().catch(e => fail(String(e)));
});
