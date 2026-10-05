#!/usr/bin/env node
'use strict';

// Drift guard for the stdio server's tool names. tool-names.json (checked in) lists every
// tool the server must expose: `hostedParity` (same name on the hosted connector,
// Taxually-Einvoicing lib/mcp/tools.ts) plus `stdioOnly`. `hostedOnly` documents hosted tools
// deliberately not mirrored here. tools/list must equal hostedParity + stdioOnly exactly: a
// tool added, removed or renamed without updating the list fails this check, as does a name
// that appears in two lists or a duplicate in tools/list.
//
// When a sibling Taxually-Einvoicing checkout is found (TAXUALLY_EINVOICING_PATH, or
// ../../../Taxually-Einvoicing from this repo) the list is also diffed against the hosted tool
// names in lib/mcp/tools.ts and any difference is printed as a warning (never a failure: that
// checkout may be on a stale branch). Without a checkout that part is skipped.
//
// Usage: npm run build && node scripts/verify-tool-names.js

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'dist', 'index.js');
const LIST = JSON.parse(fs.readFileSync(path.join(ROOT, 'tool-names.json'), 'utf8'));

function fail(msg) {
  console.error(`FAIL — ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(SERVER)) fail(`Missing ${path.relative(ROOT, SERVER)} — run "npm run build" first.`);

const parity = LIST.hostedParity;
const stdioOnly = Object.keys(LIST.stdioOnly);
const hostedOnly = Object.keys(LIST.hostedOnly);
const expected = new Set([...parity, ...stdioOnly]);

const overlap = [...new Set([...parity, ...stdioOnly, ...hostedOnly])].filter(
  n => [parity, stdioOnly, hostedOnly].filter(l => l.includes(n)).length > 1,
);
if (overlap.length) fail(`tool-names.json lists a name in more than one section: ${overlap.join(', ')}`);

const child = spawn('node', [SERVER], {
  cwd: path.dirname(SERVER),
  env: { ...process.env, CLEARVO_API_KEY: 'csk_test_verifytoolnames' },
});
child.stderr.on('data', () => {});

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

function hostedNames() {
  const base = process.env.TAXUALLY_EINVOICING_PATH ?? path.join(ROOT, '..', '..', '..', 'Taxually-Einvoicing');
  const file = path.join(base, 'lib', 'mcp', 'tools.ts');
  if (!fs.existsSync(file)) return null;
  return new Set([...fs.readFileSync(file, 'utf8').matchAll(/^    name: '([a-z_0-9]+)',/gm)].map(m => m[1]));
}

(async () => {
  await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-tool-names', version: '0' } });
  const response = await call(2, 'tools/list', {});
  clearTimeout(timeout);

  const names = (response.result?.tools ?? []).map(t => t.name);
  const seen = new Set();
  const dupes = names.filter(n => (seen.has(n) ? true : (seen.add(n), false)));
  if (dupes.length) fail(`Duplicate tool name(s): ${dupes.join(', ')}`);

  const actual = new Set(names);
  const unlisted = [...actual].filter(n => !expected.has(n));
  const missing = [...expected].filter(n => !actual.has(n));
  if (unlisted.length || missing.length) {
    fail(
      `tools/list differs from tool-names.json.\n` +
      (unlisted.length ? `  Exposed but not listed (add to tool-names.json): ${unlisted.join(', ')}\n` : '') +
      (missing.length ? `  Listed but not exposed (remove, or restore the tool): ${missing.join(', ')}\n` : ''),
    );
  }

  const hosted = hostedNames();
  if (hosted) {
    const notOnHosted = parity.filter(n => !hosted.has(n));
    const hostedUnaccounted = [...hosted].filter(n => !parity.includes(n) && !hostedOnly.includes(n));
    // A warning, not a failure: the sibling checkout may simply be on a stale branch.
    if (notOnHosted.length || hostedUnaccounted.length) {
      console.warn(
        `WARN — tool-names.json differs from the sibling checkout's lib/mcp/tools.ts (is that checkout up to date with origin/main?).\n` +
        (notOnHosted.length ? `  In hostedParity but not in that file: ${notOnHosted.join(', ')}\n` : '') +
        (hostedUnaccounted.length ? `  In that file but in neither hostedParity nor hostedOnly: ${hostedUnaccounted.join(', ')}\n` : ''),
      );
    }
  }

  console.log(`OK — ${names.length} tools match tool-names.json (${parity.length} hosted parity, ${stdioOnly.length} stdio-only)${hosted ? ', hosted list cross-checked' : ', hosted checkout not found so only the checked-in list was compared'}.`);
  child.kill();
  process.exit(0);
})();
