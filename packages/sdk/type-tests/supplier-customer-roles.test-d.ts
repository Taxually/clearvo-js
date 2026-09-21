// Compile-time guard for the explicit supplier/customer role model on
// TaxCalculateRequest/TaxCalculateResponse.
//
// `customer` and `seller` used to be required; `supplier` and
// `transactionDirection` didn't exist. Both parties are now optional at the
// type level (the direction-aware requiredness is a runtime 422, not
// something TypeScript enforces) so that a `transactionDirection: 'purchase'`
// request supplying only `supplier` (no `customer`) type-checks — and so
// does the ordinary `'sale'` shape supplying only `customer`.
//
// Not run — only type-checked (see packages/sdk/type-tests/tsconfig.json,
// invoked via `npm run test:types` in this package, and by CI).

import type { TaxCalculateRequest, TaxCalculateResponse, TaxCalcParty, Supplier, CreateSupplierInput } from '../src/types.js';

// A 'purchase' request: only `supplier` (the counterparty/vendor) is
// supplied — `customer` (the entity side) is omitted entirely and still
// type-checks, since it's auto-enriched from the entity's own master data.
const _purchaseRequest: TaxCalculateRequest = {
  currency: 'EUR',
  transactionDirection: 'purchase',
  supplier: {
    taxId: 'DE123456789',
    billingAddress: { country: 'DE' },
  },
  lineItems: [{ id: '1', amount: 10000, productName: 'Office supplies' }],
};
void _purchaseRequest;

// A 'purchase' request may also resolve a saved supplier by ref, supplying
// no other supplier fields at all.
const _purchaseByRef: TaxCalculateRequest = {
  currency: 'EUR',
  transactionDirection: 'purchase',
  supplier: { ref: 'VEND-001' },
  lineItems: [{ id: '1', amount: 5000, productName: 'Consulting' }],
};
void _purchaseByRef;

// The ordinary 'sale' shape (transactionDirection omitted, defaults to
// 'sale') still type-checks with only `customer` supplied — `supplier` and
// the deprecated `seller` alias are both optional.
const _saleRequest: TaxCalculateRequest = {
  currency: 'USD',
  customer: {
    type: 'B2B',
    taxId: 'FR12345678901',
    billingAddress: { country: 'FR' },
  },
  lineItems: [{ id: '1', amount: 10000, productName: 'SaaS subscription' }],
};
void _saleRequest;

// `seller` remains accepted (deprecated alias for `supplier`, sale-only) —
// no `@ts-expect-error` here, it must still compile.
const _saleWithDeprecatedSeller: TaxCalculateRequest = {
  currency: 'EUR',
  seller: { address: { country: 'DE' } },
  customer: {
    type: 'B2C',
    billingAddress: { country: 'DE' },
  },
  lineItems: [{ id: '1', amount: 2500, productName: 'Widget' }],
};
void _saleWithDeprecatedSeller;

// The response always carries both party blocks plus entityRole.
declare const _resp: TaxCalculateResponse;
const _entityRole: 'supplier' | 'customer' = _resp.entityRole;
const _supplierParty: TaxCalcParty = _resp.supplier;
const _customerParty: TaxCalcParty = _resp.customer;
const _isEntity: boolean = _supplierParty.isEntity;
void _entityRole;
void _customerParty;
void _isEntity;

// Supplier master-data shapes mirror Customer's — a bare name is enough to
// create one, and the saved record round-trips supplierRef/taxIds.
const _createSupplier: CreateSupplierInput = { name: 'Acme Supplies Ltd', country: 'IE', taxId: 'IE1234567T' };
void _createSupplier;
declare const _supplier: Supplier;
const _supplierRef: string | null | undefined = _supplier.supplierRef;
void _supplierRef;
