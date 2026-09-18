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

// exempt: true with a self-asserted exemptionReason — no certificate on
// file yet. exemptionReason requires exempt: true on the SAME line (a
// server-side 422, not something the type system enforces).
const _withInlineExemptClaim: TaxCalculateRequest['lineItems'][number] = {
  id: '3',
  amount: 5000,
  productName: 'Widget',
  exempt: true,
  exemptionReason: 'GOVERNMENT',
};
void _withInlineExemptClaim;

// The response echoes the resolved reason on the line, separately from
// pendingCertificates at the top level (only present when customer.ref was
// also supplied).
const _exemptionReasonEcho: TaxCalculateResponse['lineItems'][number]['exemptionReason'] = _resp.lineItems[0]?.exemptionReason;
const _pendingCert = _resp.pendingCertificates?.[0];
if (_pendingCert) {
  const _certId: string = _pendingCert.certId;
  const _certificateType: string = _pendingCert.certificateType;
  void _certId;
  void _certificateType;
}
void _exemptionReasonEcho;

void _withAmount;
void _withUnitPrice;
