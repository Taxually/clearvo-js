// Compile-time guard: the line-item dataset, the real filter operators, the purchase line supplyType and the three-valued
// poLink status on a list row.

import type { QueryRequestParams, TaxCalculateRequest, TaxCalculationSummary } from '../src/types.js';

const _lineItems: QueryRequestParams = {
  dataset: 'tax_calculation_line_items',
  filters: [
    { field: 'apOutcome', operator: 'in', values: ['OVERCHARGED', 'HELD'] },
    { field: 'statedTaxAmount', operator: 'between', values: [0, 100] },
    { field: 'apReasonCode', operator: 'isNull', value: false },
  ],
};

const _line: TaxCalculateRequest['lineItems'][number] = {
  id: '1', amount: 100, productName: 'Laptop', supplyType: 'GOODS', purchaseOrderLineNumber: '1',
  shipTo: { country: 'US', region: 'TX', city: 'Austin', line1: '1 Main St', postalCode: '78701' },
};

declare const row: TaxCalculationSummary;
const _notFound: 'NONE' | 'LINKED' | 'NOT_FOUND' | undefined = row.poLink?.status;

// @ts-expect-error supplyType is upper case GOODS | SERVICES on a calculate line
const _badSupply: TaxCalculateRequest['lineItems'][number] = { id: '1', amount: 1, productName: 'x', supplyType: 'goods' };

export { _lineItems, _line, _notFound, _badSupply };
