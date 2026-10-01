// Compile-time guard: classificationCodes replaces the removed stripeTaxCode on
// tax-calculation lines and product create/update; results carry CODE_MAP.

import type {
  TaxCalculateRequest,
  TaxCalculateResponse,
  CreateProductInput,
  UpdateProductInput,
} from '../src/types.js';

const _line: TaxCalculateRequest['lineItems'][number] = {
  id: '1',
  amount: 1000,
  productName: 'Shirt',
  classificationCodes: [
    { system: 'stripe', code: 'txcd_10103001' },
    { system: 'shopify', code: 'aa-1-13' },
  ],
};

const _lineOld: TaxCalculateRequest['lineItems'][number] = {
  id: '1',
  amount: 1000,
  productName: 'Shirt',
  // @ts-expect-error — stripeTaxCode was removed; use classificationCodes.
  stripeTaxCode: 'txcd_10103001',
};

const _create: CreateProductInput = { name: 'Shirt', classificationCodes: [{ system: 'hs', code: '610910' }] };
const _update: UpdateProductInput = { classificationCodes: [{ system: 'stripe', code: 'txcd_10103001' }] };

declare const _resp: TaxCalculateResponse;
const _src: 'EXPLICIT' | 'CODE_MAP' | 'CACHED' | 'AI' | 'AI_FALLBACK' | null | undefined = _resp.lineItems[0]?.classificationSource;
const _sys: string | undefined = _resp.lineItems[0]?.classificationSystem;
const _matched: string | undefined = _resp.lineItems[0]?.classificationMatchedCode;

void [_line, _lineOld, _create, _update, _src, _sys, _matched];
