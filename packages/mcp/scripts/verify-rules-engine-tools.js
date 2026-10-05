#!/usr/bin/env node
'use strict';

// B7 propagation (docs/features/rules-engine/discovery.md, focus-eng-lead.md
// §1.N.4) — asserts this stdio server's tools/list carries a stdio twin of
// every one of the hosted MCP connector's rules-engine
// tools (Taxually-Einvoicing lib/mcp/tools.ts). HOSTED_RULES_ENGINE_TOOL_NAMES
// below is a hand-duplicated fixture of that hosted list's own rules-engine
// tool names (same "separate repos, no shared import"
// convention as the hosted connector's own tests/unit/mcp-tools-parity.test.ts)
// — keep it in sync by hand whenever either side adds/removes one of these
// tools. Deliberately scoped to this story's own surface, not every tool on
// both servers — see this repo's own known gaps (pre-existing, unrelated to
// this story) for tools that already differ between the two servers outside
// this scope.
//
// Usage: npm run build && node scripts/verify-rules-engine-tools.js

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

const HOSTED_RULES_ENGINE_TOOL_NAMES = [
  // Rules engine core (RE-4): schema, rule CRUD, activate/move/simulate.
  'get_rules_engine_schema', 'list_rules', 'get_rule', 'create_rule', 'update_rule',
  'activate_rule', 'move_rule', 'simulate_rule',
  // Dashboard seams / B6 — rule version history, execution trace, platform-rule-change feed.
  'list_rule_versions', 'get_rules_trace', 'list_platform_rule_changes',
  // Custom property definitions + starter templates.
  'list_rule_property_definitions', 'create_rule_property_definition',
  'list_rule_templates', 'get_rule_template', 'instantiate_rule_template',
  // RE-8 field mappings.
  'list_field_mappings', 'update_field_mapping', 'reset_field_mappings',
  // RE-5 reference datasets (export excluded — text/csv, a poor fit for a JSON-RPC tool call).
  'list_rules_engine_datasets', 'create_rules_engine_dataset', 'get_rules_engine_dataset',
  'list_rules_engine_dataset_rows', 'upsert_rules_engine_dataset_row',
  'delete_rules_engine_dataset_row', 'import_rules_engine_dataset',
];

const child = spawn('node', [SERVER], {
  cwd: path.dirname(SERVER),
  env: { ...process.env, CLEARVO_API_KEY: 'csk_test_verifyrulesenginetools' },
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
  await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-rules-engine-tools', version: '0' } });
  const response = await call(2, 'tools/list', {});
  clearTimeout(timeout);

  const tools = response.result?.tools ?? [];
  const names = new Set(tools.map(t => t.name));

  const missing = HOSTED_RULES_ENGINE_TOOL_NAMES.filter(name => !names.has(name));
  if (missing.length) {
    return fail(`Missing rules-engine tools from tools/list: ${missing.join(', ')}`);
  }

  // Duplicate-name guard, same regression class the hosted connector's own
  // parity test guards against.
  const seen = new Set();
  const duplicates = tools.map(t => t.name).filter(name => (seen.has(name) ? true : (seen.add(name), false)));
  if (duplicates.length) {
    return fail(`Duplicate tool name(s): ${duplicates.join(', ')}`);
  }

  console.log(`OK — all ${HOSTED_RULES_ENGINE_TOOL_NAMES.length} rules-engine tools present, no duplicates.`);
  child.kill();
  process.exit(0);
})();

function fail(message) {
  console.error(message);
  child.kill();
  process.exit(1);
}
