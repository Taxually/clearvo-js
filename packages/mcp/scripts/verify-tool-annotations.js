#!/usr/bin/env node
'use strict';

// Asserts this stdio server's tools/list carries a `title` and explicit boolean
// annotations (readOnlyHint / destructiveHint / idempotentHint / openWorldHint) on
// EVERY tool — a requirement of Anthropic's Connectors/Plugins directory — and that
// each classification agrees with the HTTP verb the tool actually dispatches with
// (parsed from src/index.ts): a GET-only tool must be read-only, a tool that issues
// any non-GET must not be (except the POST-verb read tools below), and a
// DELETE-dispatching tool must be destructive. Mirrors the hosted connector's
// tests/unit/mcp-tool-annotations.test.ts.
//
// Usage: npm run build && node scripts/verify-tool-annotations.js

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'dist', 'index.js');
const SOURCE = path.join(ROOT, 'src', 'index.ts');

// POST-verb tools that never write (verified against their routes).
const READ_ONLY_POST_EXCEPTIONS = new Set(['query_data', 'simulate_rule', 'quote_duties', 'estimate_duties']);

// GET-dispatched tools whose route nevertheless writes (poll_status updates einvoicing_records and live-polls authorities).
const GET_THAT_WRITES = new Set(['poll_status']);

function fail(msg) {
  console.error(`FAIL — ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(SERVER)) fail(`Missing ${path.relative(ROOT, SERVER)} — run "npm run build" first.`);

function dispatchVerbsByTool() {
  const src = fs.readFileSync(SOURCE, 'utf8');
  const body = src.slice(src.indexOf('async function handleTool'));
  const out = new Map();
  for (const block of body.split(/\n    case '/).slice(1)) {
    const name = block.slice(0, block.indexOf("'"));
    const verbs = new Set([...block.matchAll(/callApi\(\s*'(GET|POST|PUT|PATCH|DELETE)'/g)].map(m => m[1]));
    if (verbs.size) out.set(name, verbs);
  }
  return out;
}

const child = spawn('node', [SERVER], {
  cwd: path.dirname(SERVER),
  env: { ...process.env, CLEARVO_API_KEY: 'csk_test_verifytoolannotations' },
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
    return;
  }
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
});

const timeout = setTimeout(() => fail('Timed out waiting for a tools/list response'), 5000);

(async () => {
  await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-tool-annotations', version: '0' } });
  const response = await call(2, 'tools/list', {});
  clearTimeout(timeout);

  const tools = response.result?.tools ?? [];
  if (!tools.length) fail('tools/list returned no tools');

  const verbs = dispatchVerbsByTool();
  const problems = [];
  const titles = new Set();
  for (const t of tools) {
    const a = t.annotations ?? {};
    if (!t.title || !String(t.title).trim()) problems.push(`${t.name}: missing title`);
    if (titles.has(t.title)) problems.push(`${t.name}: duplicate title "${t.title}"`);
    titles.add(t.title);
    for (const k of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
      if (typeof a[k] !== 'boolean') problems.push(`${t.name}: annotations.${k} is not a boolean`);
    }
    if (a.readOnlyHint && a.destructiveHint) problems.push(`${t.name}: read-only tool marked destructive`);

    const v = verbs.get(t.name);
    if (!v) {
      problems.push(`${t.name}: no callApi verb found in handleTool`);
      continue;
    }
    const writes = [...v].some(x => x !== 'GET');
    if (GET_THAT_WRITES.has(t.name)) {
      if (a.readOnlyHint) problems.push(`${t.name}: GET route that mutates state must not be readOnlyHint=true`);
    } else if (!writes && !a.readOnlyHint) problems.push(`${t.name}: GET-only tool must be readOnlyHint=true`);
    if (writes && a.readOnlyHint && !READ_ONLY_POST_EXCEPTIONS.has(t.name)) {
      problems.push(`${t.name}: dispatches ${[...v].join('/')} so it cannot be readOnlyHint=true`);
    }
    if (v.has('DELETE') && !a.destructiveHint) problems.push(`${t.name}: DELETE-dispatching tool must be destructiveHint=true`);
  }

  if (problems.length) fail(`\n  ${problems.join('\n  ')}`);

  console.log(`OK — all ${tools.length} tools carry a title + read/destructive/idempotent/openWorld annotations consistent with their HTTP verbs`);
  child.kill();
  process.exit(0);
})();
