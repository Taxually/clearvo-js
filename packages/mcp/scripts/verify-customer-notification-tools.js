#!/usr/bin/env node
'use strict';

// The customer notification email timeline must match the hosted connector (Taxually-Einvoicing lib/mcp/tools.ts):
// get_invoice describes customerNotification.events, and create_webhook lists the ten opt-in
// invoice.customer_notification.<type> events and says '*' does not cover them.
//
// Usage: npm run build && node scripts/verify-customer-notification-tools.js

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

const TYPES = ['sent', 'delivered', 'delivery_delayed', 'opened', 'clicked', 'bounced', 'complained', 'failed', 'viewed', 'downloaded'];

const child = spawn('node', [SERVER], {
  cwd: path.dirname(SERVER),
  env: { ...process.env, CLEARVO_API_KEY: 'csk_test_verifycustomernotification' },
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
  try { msg = JSON.parse(line); } catch { return; }
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
});

const timeout = setTimeout(() => fail('Timed out waiting for a tools/list response'), 5000);

(async () => {
  await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-customer-notification-tools', version: '0' } });
  const response = await call(2, 'tools/list', {});
  clearTimeout(timeout);
  const byName = new Map((response.result?.tools ?? []).map(t => [t.name, t]));

  const getInvoice = byName.get('get_invoice');
  if (!getInvoice) return fail('get_invoice is missing from tools/list');
  if (!getInvoice.description.includes('customerNotification') || !getInvoice.description.includes('events')) {
    return fail('get_invoice description does not describe customerNotification.events');
  }
  for (const t of TYPES) {
    if (!getInvoice.description.includes(t)) return fail(`get_invoice description does not name the event type ${t}`);
  }

  const createWebhook = byName.get('create_webhook');
  if (!createWebhook) return fail('create_webhook is missing from tools/list');
  const eventsDescription = createWebhook.inputSchema?.properties?.events?.description ?? '';
  for (const t of TYPES) {
    const name = `invoice.customer_notification.${t}`;
    if (!eventsDescription.includes(name)) return fail(`create_webhook events description is missing ${name}`);
    if (!createWebhook.description.includes('invoice.customer_notification.<type>')) return fail('create_webhook description does not describe invoice.customer_notification.<type>');
  }
  if (!eventsDescription.includes('invoice.customer_notification.* events') || !createWebhook.description.includes('NOT covered by "*"')) {
    return fail('create_webhook must say "*" does not cover the invoice.customer_notification.* events');
  }

  console.log('OK — get_invoice describes customerNotification.events and create_webhook lists the ten opt-in customer notification events.');
  child.kill();
  process.exit(0);
})();

function fail(message) {
  console.error(message);
  child.kill();
  process.exit(1);
}
