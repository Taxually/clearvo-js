#!/usr/bin/env node
'use strict';

// Multi-entity behaviour of the stdio MCP server, against a local mock API:
//  1. every tool that acts on one business profile advertises an optional entityId (entity-agnostic tools do not);
//  2. a per-call entityId is sent as x-entity-id and overrides the CLEARVO_ENTITY_ID default;
//  3. without entityId the CLEARVO_ENTITY_ID default is sent;
//  4. entityId is not leaked into the request body of a tool whose handler has no entityId of its own;
//  5. list_entities passes taxNumber straight through and describes the connection's business profiles.
//
// Usage: npm run build && node scripts/verify-entity-scope.js

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

const AGNOSTIC = ['list_entities', 'create_entity', 'invite_team_member', 'list_tax_categories', 'list_country_coverage',
  'validate_tax_number', 'validate_tax_numbers_batch', 'get_tax_number_batch_job', 'get_test_case_catalogue', 'get_requirements', 'get_rules_engine_schema',
  'get_registration_field_definitions', 'get_entity_fact_definitions', 'get_query_fields', 'get_filing_upload_template'];

const seen = [];
const api = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, entity: req.headers['x-entity-id'], body });
    res.setHeader('Content-Type', 'application/json');
    res.end('{}');
  });
});

function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }

api.listen(0, '127.0.0.1', async () => {
  const baseUrl = `http://127.0.0.1:${api.address().port}/v1`;
  const child = spawn('node', [SERVER], {
    env: { ...process.env, CLEARVO_API_KEY: 'csk_test_entityscope', CLEARVO_ENTITY_ID: 'ent_default', CLEARVO_BASE_URL: baseUrl },
  });
  child.stderr.on('data', () => {});
  const pending = new Map();
  readline.createInterface({ input: child.stdout }).on('line', line => {
    try { const m = JSON.parse(line); pending.get(m.id)?.(m); pending.delete(m.id); } catch { /* ignore */ }
  });
  let n = 0;
  const call = (method, params) => new Promise(resolve => {
    const id = ++n;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const tool = (name, args) => call('tools/call', { name, arguments: args });
  setTimeout(() => fail('timed out'), 15000).unref();

  await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify', version: '0' } });
  const { result } = await call('tools/list', {});
  const byName = Object.fromEntries(result.tools.map(t => [t.name, t]));

  for (const t of result.tools) {
    const has = 'entityId' in (t.inputSchema.properties ?? {});
    if (AGNOSTIC.includes(t.name) && t.name !== 'create_entity' && t.name !== 'invite_team_member' && has) fail(`${t.name} must not take entityId`);
    if (!AGNOSTIC.includes(t.name) && !has) fail(`${t.name} is missing entityId`);
    const d = t.inputSchema.properties?.entityId?.description ?? '';
    if (/Required for account-scoped keys/.test(d)) fail(`${t.name} still has the account-scoped wording`);
  }
  for (const name of ['amend_sii_report', 'cancel_sii_report', 'get_sii_reconciliation']) {
    if (!byName[name]?.inputSchema.properties.entityId) fail(`${name} lacks entityId`);
  }
  if (!/this connection can act on/.test(byName.list_entities.description)) fail('list_entities description not updated');

  // 3. default from the env
  seen.length = 0;
  await tool('get_setup_status', {});
  if (seen[0]?.entity !== 'ent_default') fail(`default entity not sent, got ${seen[0]?.entity}`);

  // 2. per-call override, on a tool that has its own entityId property and on one that does not
  seen.length = 0;
  await tool('get_setup_status', { entityId: 'ent_other' });
  if (seen[0]?.entity !== 'ent_other') fail(`per-call entityId did not override the default, got ${seen[0]?.entity}`);
  seen.length = 0;
  await tool('get_sii_reconciliation', { entityId: 'ent_other', from: '2026-01-01' });
  if (seen[0]?.entity !== 'ent_other') fail(`entityId not sent as header for get_sii_reconciliation, got ${seen[0]?.entity}`);
  if (/entityId/.test(seen[0].url) || /entityId/.test(seen[0].body)) fail('entityId leaked into the request');

  // concurrent calls keep their own entity
  seen.length = 0;
  await Promise.all([tool('get_setup_status', { entityId: 'ent_a' }), tool('get_setup_status', { entityId: 'ent_b' }), tool('get_setup_status', {})]);
  const got = seen.map(s => s.entity).sort().join(',');
  if (got !== 'ent_a,ent_b,ent_default') fail(`concurrent calls mixed entities: ${got}`);

  // 5. list_entities passthrough: taxNumber is forwarded, no entityId needed
  seen.length = 0;
  await tool('list_entities', { taxNumber: 'DE123456788' });
  if (!/\/entities\?.*taxNumber=DE123456788/.test(seen[0]?.url ?? '')) fail(`list_entities did not pass taxNumber: ${seen[0]?.url}`);

  console.log('OK: entityId is advertised on every business-profile tool, overrides CLEARVO_ENTITY_ID per call, and list_entities passes through.');
  child.kill();
  api.close();
  process.exit(0);
});
