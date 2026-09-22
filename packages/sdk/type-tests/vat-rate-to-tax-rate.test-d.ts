// Compile-time regression guard for the e-invoicing line-item rename
// `vatRate` -> `taxRate` and `vatAmount` -> `taxAmount` (product-owner
// decision 2026-09-22: the platform is global, so no API field name is
// tax-type-specific). The backend rejects the retired names with
// 422 UNKNOWN_FIELD_VAT_RENAMED — there is no silent alias — so the SDK
// type must reject them at compile time too.
//
// Not run — only type-checked (see packages/sdk/type-tests/tsconfig.json,
// invoked via `npm run test:types` in this package, and by CI). If `vatRate`
// or `vatAmount` is ever reintroduced on LineItemInput, the corresponding
// `@ts-expect-error` below stops erroring, becomes "unused" (TS2578), and
// `tsc --noEmit` fails.

import type { LineItemInput, SubmitInvoiceInput } from '../src/types.js';

// `taxRate` and `taxAmount` are the correct property names.
const _valid: LineItemInput = { description: 'Widget', quantity: 1, unitPrice: 100, taxRate: 22, taxAmount: 22 };
void _valid;

// `vatRate` is no longer a valid line property — TypeScript's excess-property
// check on an object literal rejects it.
const _rejectsVatRate: LineItemInput = {
  description: 'Widget',
  quantity: 1,
  unitPrice: 100,
  // @ts-expect-error — `vatRate` was renamed to `taxRate` (422 UNKNOWN_FIELD_VAT_RENAMED on the wire).
  vatRate: 22,
};
void _rejectsVatRate;

// `vatAmount` is no longer a valid line property — use `taxAmount`.
const _rejectsVatAmount: LineItemInput = {
  description: 'Widget',
  quantity: 1,
  unitPrice: 100,
  taxRate: 22,
  // @ts-expect-error — `vatAmount` was renamed to `taxAmount` (422 UNKNOWN_FIELD_VAT_RENAMED on the wire).
  vatAmount: 22,
};
void _rejectsVatAmount;

// The same guard through the full request shape: a line inside
// SubmitInvoiceInput.lines[] must not accept the retired name either.
const _rejectsVatRateOnSubmit: SubmitInvoiceInput = {
  invoiceNumber: 'INV-001',
  issueDate: '2026-09-22',
  currency: 'EUR',
  country: 'IT',
  customer: { name: 'Acme SpA', address: { city: 'Milan', country: 'IT' } },
  lines: [
    // @ts-expect-error — `vatRate` was renamed to `taxRate`.
    { description: 'Licence', quantity: 1, unitPrice: 1000, vatRate: 22 },
  ],
};
void _rejectsVatRateOnSubmit;
