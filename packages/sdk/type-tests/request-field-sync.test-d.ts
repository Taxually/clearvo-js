// Compile-time guard that the SDK request types carry the fields the backend routes read:
// POST /v1/tax/calculate (credit-note linkage, date, shipTo, per-line purchase and US shipping facts)
// and POST /v1/send (taxPointDate, ossDeclared, sandboxSimulateOutcome, references, credit-note original).
//
// Not run: only type-checked (see type-tests/tsconfig.json). Deleting one of these fields from the
// type makes the object literal fail the excess-property check and `tsc --noEmit` fails.

import type { TaxCalculateRequest, SubmitInvoiceInput } from '../src/types.js';

const _creditNote: TaxCalculateRequest = {
  currency: 'EUR',
  transactionType: 'credit_note',
  relatedCalculationId: 'calc_1',
  date: '2026-10-01',
  taxReportingCurrency: 'RON',
  merchantRef: 'order-1',
  orderDiscount: 5,
  paymentMethod: 'card',
  isMarketplaceFacilitatedSale: false,
  shippingMode: 'courier',
  shipTo: { country: 'US', region: 'CA' },
  customProperties: { glAccount: '4000' },
  documentStage: 'invoice',
  vatValidation: 'format',
  vatUnverifiableFallback: 'permissive',
  lineItems: [{
    id: '1',
    productName: 'Widget',
    amount: 10,
    discount: 1,
    supplyType: 'GOODS',
    recoverablePercentOverride: 50,
    statedTaxAmount: 2.1,
    shippingCarrier: 'common',
    chargeAvoidable: true,
    actualCostOfShipment: false,
    screenSizeInches: 15,
    productDescription: 'A widget',
    productCode: 'W-1',
  }],
};

const _external: TaxCalculateRequest = {
  currency: 'EUR',
  transactionType: 'credit_note',
  externalOriginalReference: 'ERP-INV-9',
  date: '2026-10-01',
  lineItems: [{ id: '1', productName: 'Widget', unitPrice: 10, quantity: 1 }],
};

const _invoice: SubmitInvoiceInput = {
  invoiceNumber: 'CN-1',
  documentType: 'credit_note',
  issueDate: '2026-10-01',
  taxPointDate: '2026-09-30',
  currency: 'EUR',
  country: 'DE',
  ossDeclared: false,
  sandboxSimulateOutcome: 'REJECTED',
  originalInvoiceRef: { invoiceNumber: 'INV-1', issueDate: '2026-09-01', reason: 'Returned goods' },
  buyerReference: '04011000-1234512345-06',
  customer: { address: { city: 'Berlin', country: 'DE' } },
  lines: [{ description: 'Widget', quantity: 1, unitPrice: 10, taxRate: 19, gtuCode: 'GTU_01', allowances: [{ amount: 1 }] }],
  shipping: { amount: 5, carrierId: 'DHL', taxRate: 19 },
};

void _creditNote;
void _external;
void _invoice;
