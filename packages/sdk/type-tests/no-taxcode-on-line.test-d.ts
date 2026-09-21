// Compile-time regression guard for the tax-code-mapping hard cut.
//
// LineItemInput / ShippingInput / AllowanceChargeInput must never accept a
// `taxCode` field again — the EN16931/BIS category is always a resolved
// OUTPUT (see LineTaxResolution), never a caller-supplied value. Use
// `clientTaxCode` or `taxTreatment` instead.
//
// This file is not run — it is only ever type-checked (see
// packages/sdk/type-tests/tsconfig.json, invoked via `npm run test:types`
// in this package, and by CI). Each `@ts-expect-error` below asserts that
// TypeScript's excess-property check rejects `taxCode` on that object
// literal today. If `taxCode` is ever re-added to one of these types, the
// corresponding line stops erroring, its `@ts-expect-error` directive
// becomes "unused" (TS2578), and `tsc --noEmit` fails — the intended
// failure mode this test exists to catch.

import type { LineItemInput, ShippingInput, AllowanceChargeInput } from '../src/types.js';

const _line: LineItemInput = {
  description: 'Software licence',
  quantity: 1,
  unitPrice: 100,
  // @ts-expect-error — `taxCode` was removed from LineItemInput by the tax-code-mapping hard cut. Use clientTaxCode (recommended) or taxTreatment instead.
  taxCode: 'S',
};

const _shipping: ShippingInput = {
  amount: 9.99,
  // @ts-expect-error — `taxCode` was removed from ShippingInput too. Use clientTaxCode or taxTreatment instead.
  taxCode: 'S',
};

const _charge: AllowanceChargeInput = {
  amount: 10,
  reason: 'Early payment discount',
  // @ts-expect-error — `taxCode` was removed from AllowanceChargeInput too. Use clientTaxCode or taxTreatment instead.
  taxCode: 'S',
};

// Sanity check: the real replacement fields DO compile clean (no ts-expect-error needed).
const _validLine: LineItemInput = {
  description: 'Software licence',
  quantity: 1,
  unitPrice: 100,
  clientTaxCode: 'A1',
};
const _validLineWithHint: LineItemInput = {
  description: 'Export of goods',
  quantity: 1,
  unitPrice: 100,
  taxTreatment: 'exempt',
  customerType: 'B2B',
  supplyType: 'goods',
};

void _line;
void _shipping;
void _charge;
void _validLine;
void _validLineWithHint;
