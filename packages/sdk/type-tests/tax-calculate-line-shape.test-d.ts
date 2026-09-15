// Compile-time guard for the tax-calculate line-item contract.
//
// POST /v1/tax/calculate accepts a line total either as `amount` directly, OR
// as `unitPrice` with `quantity` (the engine derives amount = round2(unitPrice
// * quantity)). Both forms must type-check on TaxCalculateRequest.lineItems,
// and each US line result may carry a per-authority `jurisdictionBreakdown`.
//
// Not run — only type-checked (see packages/sdk/type-tests/tsconfig.json). If a
// future change makes `amount` unconditionally required again, drops
// `unitPrice`/`quantity`, or removes `jurisdictionBreakdown`, the corresponding
// assignment stops compiling and `tsc --noEmit` fails.

import type { TaxCalculateRequest, TaxCalculateResponse } from '../src/types.js';

// Form 1: a line total supplied directly as `amount`.
const _withAmount: TaxCalculateRequest['lineItems'][number] = {
  id: '1',
  amount: 10000,
  productName: 'SaaS subscription',
};

// Form 2: a line total supplied as `unitPrice` + `quantity`.
const _withUnitPrice: TaxCalculateRequest['lineItems'][number] = {
  id: '2',
  unitPrice: 2500,
  quantity: 4,
  productName: 'Seats',
};

// The per-line, per-authority US breakdown is readable on a response line.
declare const _resp: TaxCalculateResponse;
const _breakdown = _resp.lineItems[0]?.jurisdictionBreakdown;
if (_breakdown) {
  const _first = _breakdown[0];
  const _level: string | undefined = _first?.level;
  const _name: string | undefined = _first?.name;
  const _taxType: string | undefined = _first?.taxType;
  const _rate: number | undefined = _first?.rate;
  const _taxAmount: number | undefined = _first?.taxAmount;
  void _level;
  void _name;
  void _taxType;
  void _rate;
  void _taxAmount;
}

void _withAmount;
void _withUnitPrice;
