// Compile-time regression guard for the e-invoicing `buyer` -> `customer`
// rename (decision D5, story S11 / clearvo-js story J2).
//
// SubmitInvoiceInput's counterparty party is always named `customer` now —
// `buyer` is not a valid property. `buyerReference` is NOT part of this
// rename (EN16931 BT-10, a standard identifier) and keeps its name.
//
// Not run — only type-checked (see packages/sdk/type-tests/tsconfig.json,
// invoked via `npm run test:types` in this package, and by CI). If `buyer`
// is ever reintroduced as a property name on one of our own party-shaped
// types, the corresponding `@ts-expect-error` below stops erroring, becomes
// "unused" (TS2578), and `tsc --noEmit` fails.

import type { SubmitInvoiceInput, LineItemInput, InvoiceSubmitResponse } from '../src/types.js';

// `customer` is the correct, required property.
const _valid: SubmitInvoiceInput = {
  invoiceNumber: 'INV-001',
  issueDate: '2026-09-21',
  currency: 'EUR',
  country: 'DE',
  customer: {
    name: 'Acme GmbH',
    address: { city: 'Berlin', country: 'DE' },
  },
  customerType: 'B2B',
  lines: [{ description: 'Widget', quantity: 1, unitPrice: 100, taxRate: 19, customerType: 'B2B' }],
};
void _valid;

// `buyer` is no longer a valid top-level property — TypeScript's
// excess-property check on an object literal rejects it. `customer` is
// still supplied so the only expected error is the excess `buyer` property,
// not a missing-required-property one.
const _rejectsBuyer: SubmitInvoiceInput = {
  invoiceNumber: 'INV-002',
  issueDate: '2026-09-21',
  currency: 'EUR',
  country: 'DE',
  customer: { name: 'Acme GmbH', address: { city: 'Berlin', country: 'DE' } },
  // @ts-expect-error — `buyer` was renamed to `customer` by the buyer->customer hard cut. Use `customer` instead.
  buyer: { name: 'Acme GmbH', address: { city: 'Berlin', country: 'DE' } },
  lines: [],
};
void _rejectsBuyer;

// `buyerType` (invoice-level) is no longer valid — use `customerType`.
const _rejectsBuyerType: SubmitInvoiceInput = {
  invoiceNumber: 'INV-003',
  issueDate: '2026-09-21',
  currency: 'EUR',
  country: 'DE',
  customer: { name: 'Acme GmbH', address: { city: 'Berlin', country: 'DE' } },
  // @ts-expect-error — `buyerType` was renamed to `customerType`.
  buyerType: 'B2B',
  lines: [],
};
void _rejectsBuyerType;

// `buyerType` (per-line) is no longer valid — use `customerType`.
const _rejectsLineBuyerType: LineItemInput = {
  description: 'Widget',
  quantity: 1,
  unitPrice: 100,
  // @ts-expect-error — `buyerType` was renamed to `customerType` on LineItemInput too.
  buyerType: 'B2B',
};
void _rejectsLineBuyerType;

// `notifyBuyer` is no longer valid — use `notifyCustomer`.
const _rejectsNotifyBuyer: SubmitInvoiceInput = {
  invoiceNumber: 'INV-004',
  issueDate: '2026-09-21',
  currency: 'EUR',
  country: 'DE',
  customer: { name: 'Acme GmbH', address: { city: 'Berlin', country: 'DE' } },
  // @ts-expect-error — `notifyBuyer` was renamed to `notifyCustomer`.
  notifyBuyer: true,
  lines: [],
};
void _rejectsNotifyBuyer;

// The response carries `customerNotification`, not `buyerNotification`.
declare const _resp: InvoiceSubmitResponse;
const _notification = _resp.customerNotification;
void _notification;
