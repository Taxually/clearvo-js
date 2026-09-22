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

// The full canonical line-item shape compiles.
const _valid: LineItemInput = {
  description: 'Widget', quantity: 1, unitPrice: 100, taxRate: 22, taxAmount: 22,
  lineNumber: 1, discountPercent: 10, unitOfMeasure: 'EA', sellerItemId: 'SKU-001',
};
void _valid;
const _validDiscountAmount: LineItemInput = { description: 'Widget', quantity: 1, unitPrice: 100, taxRate: 22, discountAmount: 5 };
void _validDiscountAmount;

// `taxRate` is ALWAYS required (0–100), even when clientTaxCode is supplied —
// the backend returns 400 for a missing/out-of-range rate. Omitting it is a
// compile error (TS2741 missing property).
// @ts-expect-error — `taxRate` is required on every line, clientTaxCode or not.
const _rejectsMissingTaxRate: LineItemInput = { description: 'Widget', quantity: 1, unitPrice: 100, clientTaxCode: 'A1' };
void _rejectsMissingTaxRate;

// `vatRate` is no longer a valid line property — TypeScript's excess-property
// check on an object literal rejects it.
const _rejectsVatRate: LineItemInput = {
  description: 'Widget',
  quantity: 1,
  unitPrice: 100,
  taxRate: 22,
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

// `discount` was renamed to `discountPercent` (with `discountAmount` as the absolute alternative).
const _rejectsDiscount: LineItemInput = {
  description: 'Widget', quantity: 1, unitPrice: 100, taxRate: 22,
  // @ts-expect-error — `discount` was renamed to `discountPercent` (or use `discountAmount`).
  discount: 10,
};
void _rejectsDiscount;

// `unit` was renamed to `unitOfMeasure`.
const _rejectsUnit: LineItemInput = {
  description: 'Widget', quantity: 1, unitPrice: 100, taxRate: 22,
  // @ts-expect-error — `unit` was renamed to `unitOfMeasure`.
  unit: 'EA',
};
void _rejectsUnit;

// `itemCode` was renamed to `sellerItemId`.
const _rejectsItemCode: LineItemInput = {
  description: 'Widget', quantity: 1, unitPrice: 100, taxRate: 22,
  // @ts-expect-error — `itemCode` was renamed to `sellerItemId`.
  itemCode: 'SKU-001',
};
void _rejectsItemCode;

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
    { description: 'Licence', quantity: 1, unitPrice: 1000, taxRate: 22, vatRate: 22 },
  ],
};
void _rejectsVatRateOnSubmit;
