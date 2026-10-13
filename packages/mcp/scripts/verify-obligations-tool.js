#!/usr/bin/env node
'use strict';

// Coverage for the list_obligations tool: present in tools/list with country/status/includePreview, read-only,
// and calling it sends GET /tax/obligations with those params to the configured base URL (a local stub server).
//
// Usage: npm run build && node scripts/verify-obligations-tool.js

const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { spawn } = require('child_process');

const SERVER = path.join(__dirname, '..', 'dist', 'index.js');
if (!fs.existsSync(SERVER)) {
  console.error('Missing dist/index.js — run "npm run build" first.');
  process.exit(1);
}

let seenUrl = null;
const stub = http.createServer((req, res) => {
  seenUrl = req.url;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ obligations: [], total: 0, previewObligations: [], previewTotal: 0 }));
});

stub.listen(0, '127.0.0.1', () => {
  const baseUrl = `http://127.0.0.1:${stub.address().port}/v1`;
  const child = spawn('node', [SERVER], { env: { ...process.env, CLEARVO_API_KEY: 'csk_test_verifyobligations', CLEARVO_BASE_URL: baseUrl } });
  child.stderr.on('data', () => {});
  const pending = new Map();
  const call = (id, method, params) => new Promise(resolve => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  readline.createInterface({ input: child.stdout }).on('line', line => {
    try { const msg = JSON.parse(line); pending.get(msg.id)?.(msg); pending.delete(msg.id); } catch { /* ignore non-JSON-RPC stdout */ }
  });
  const fail = message => { console.error(message); child.kill(); stub.close(); process.exit(1); };
  const timeout = setTimeout(() => fail('Timed out'), 8000);

  (async () => {
    await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-obligations-tool', version: '0' } });
    const list = await call(2, 'tools/list', {});
    const tool = (list.result?.tools ?? []).find(t => t.name === 'list_obligations');
    if (!tool) return fail('list_obligations missing from tools/list');
    for (const prop of ['country', 'status', 'includePreview']) {
      if (!tool.inputSchema?.properties?.[prop]) return fail(`list_obligations.inputSchema is missing ${prop}`);
    }
    if (tool.annotations?.readOnlyHint !== true) return fail('list_obligations must be annotated read-only');
    if (!tool.description.includes('eu-distance-sales')) return fail('list_obligations description does not mention the EU row');

    await call(3, 'tools/call', { name: 'list_obligations', arguments: { country: 'EU', includePreview: true } });
    clearTimeout(timeout);
    const qs = new URL(seenUrl, 'http://x').searchParams;
    if (!seenUrl.startsWith('/v1/tax/obligations') || qs.get('country') !== 'EU' || qs.get('includePreview') !== 'true') {
      return fail(`Unexpected request: ${seenUrl}`);
    }
    console.log('OK — list_obligations is listed, read-only, and sends country/includePreview to GET /tax/obligations.');
    child.kill();
    stub.close();
    process.exit(0);
  })();
});
