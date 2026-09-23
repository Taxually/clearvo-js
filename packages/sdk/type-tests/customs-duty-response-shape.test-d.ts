// Compile-time guard for the contract-propagation additions:
// TaxCalculateResponse.customsDuty / customsDutyNote / ioss /
// summary.retailDeliveryFees — see CHANGELOG.md's "additive, safe to
// publish any time" entry and Taxually-Einvoicing's
// docs/features/ioss-per-item-customs-duty/focus-tax-sme.md §M-10 for the
// legal wording these fields must keep matching.
//
// Not run — only type-checked (see packages/sdk/type-tests/tsconfig.json).

import type { TaxCalculateResponse } from '../src/types.js';

declare const _resp: TaxCalculateResponse;

// summary.retailDeliveryFees — optional, US state fee rows.
const _fees = _resp.summary.retailDeliveryFees;
if (_fees) {
  const _first = _fees[0];
  const _state: string | undefined = _first?.state;
  const _name: string | undefined = _first?.name;
  const _amount: number | undefined = _first?.amount;
  void _state;
  void _name;
  void _amount;
}

// ioss — present when IOSS treatment applied.
const _ioss = _resp.ioss;
if (_ioss) {
  const _number: string = _ioss.number;
  const _registrationCountry: string = _ioss.registrationCountry;
  const _totalGoodsValue: number = _ioss.totalGoodsValue;
  const _currency: string = _ioss.currency;
  void _number;
  void _registrationCountry;
  void _totalGoodsValue;
  void _currency;
}

// customsDuty — sibling of ioss, never nested inside it; always
// includedInTotals: false / payableBy: 'DECLARANT' / estimate: true.
const _duty = _resp.customsDuty;
if (_duty) {
  const _includedInTotals: false = _duty.includedInTotals;
  const _payableBy: 'DECLARANT' = _duty.payableBy;
  const _estimate: true = _duty.estimate;
  const _currency: string = _duty.currency;
  const _itemCount: number = _duty.itemCount;
  const _items = _duty.items;
  const _firstItem = _items[0];
  const _classificationCode: string | null | undefined = _firstItem?.classificationCode;
  const _lineIds: string[] | undefined = _firstItem?.lineIds;
  void _includedInTotals;
  void _payableBy;
  void _estimate;
  void _currency;
  void _itemCount;
  void _classificationCode;
  void _lineIds;
}

// customsDutyNote — appears instead of customsDuty on a credit note.
const _note: 'NOT_REVERSED_ON_CREDIT_NOTE' | undefined = _resp.customsDutyNote;
void _note;
