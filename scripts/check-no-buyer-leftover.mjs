#!/usr/bin/env node
// Regression guard for the e-invoicing `buyer` -> `customer` rename
// (decision D5, story S11 / clearvo-js story J2): fails if any of our own
// `src/` files under packages/* still mention `buyer`, other than the
// deliberately-kept exceptions below.
//
// Kept exceptions (never renamed by this story):
//   - `buyerReference` — EN16931 BT-10, a standard-defined identifier, not
//     our own party naming.
//   - Prose inside tax-calc tool/type descriptions (`calculate_tax`'s
//     `customer.b2bOverride`, `update_tax_settings`'s
//     `vatUnverifiableTreatment`, `TaxCalculateRequest.incoterms`) — the
//     tax-calc `seller`/`customer`/`supplier` rename is a different story on
//     a different branch; this file's own generic "buyer" business prose is
//     untouched here.
//   - A code comment naming an unrelated frontend feature ("the buyer
//     collection wizard").
//
// Usage: node scripts/check-no-buyer-leftover.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const SRC_DIRS = ['packages/sdk/src', 'packages/mcp/src', 'packages/cli/src'];

// path -> array of substrings that are allowed to contain "buyer" on that
// exact line (case-insensitive substring match against the line's content).
const ALLOWED_LINES = {
  'packages/sdk/src/types.ts': [
    'buyerReference', // BT-10 — kept
    "any other value (buyer is", // TaxCalculateRequest.incoterms — different story
    "since the buyer's own customs", // TaxCalculateRequest.incoterms — different story
  ],
  'packages/mcp/src/index.ts': [
    'the buyer collection wizard', // unrelated frontend feature, not our type naming
    'the old `buyer` field name is rejected', // deliberate: documents the 422 rejection
    "Use when you know the buyer is a business", // calculate_tax (tax-calc) — different story
    "How to treat a B2B buyer whose VAT number", // update_tax_settings (tax-calc) — different story
  ],
};

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'generated') continue; // generated/ is regenerated from openapi.json, not hand-audited here
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

let failures = [];

for (const dir of SRC_DIRS) {
  const absDir = join(REPO_ROOT, dir);
  let files;
  try {
    files = walk(absDir);
  } catch {
    continue; // package has no src dir — skip
  }
  for (const file of files) {
    const relPath = file.slice(REPO_ROOT.length + 1).split('\\').join('/');
    const allowed = ALLOWED_LINES[relPath] ?? [];
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/buyer/i.test(line)) return;
      if (allowed.some((a) => line.includes(a))) return;
      failures.push(`${relPath}:${i + 1}: ${line.trim()}`);
    });
  }
}

if (failures.length) {
  console.error(`Found ${failures.length} unexpected "buyer" mention(s) outside the allowed exceptions:\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error('\nIf this is a genuinely new, deliberately-kept mention, add it to ALLOWED_LINES in scripts/check-no-buyer-leftover.mjs.');
  process.exit(1);
}

console.log('OK — no unexpected "buyer" mentions in packages/*/src (only the documented exceptions).');
