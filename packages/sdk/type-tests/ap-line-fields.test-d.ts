// Compile-time guard: glAccount/costCenter/intendedUse/accountAssignment are flat line fields on the
// calculate request and response; RulePropertyDefinition no longer carries isSystem; ClearvoError exposes `code`.

import type { TaxCalculateRequest, TaxCalculateResponse, RulePropertyDefinition, AccountAssignment, CustomPropertyErrorCode } from '../src/types.js';
import { ClearvoError } from '../src/types.js';

const _line: TaxCalculateRequest['lineItems'][number] = {
  id: '1',
  amount: 100,
  productName: 'Steel',
  glAccount: '4000',
  costCenter: 'CC-7',
  intendedUse: 'resale',
  accountAssignment: 'K', // a raw ERP code is accepted on input
};
const _enumLine: TaxCalculateRequest['lineItems'][number] = { id: '2', amount: 1, productName: 'Steel', accountAssignment: 'stock' };

declare const _resp: TaxCalculateResponse;
const _gl: string | undefined = _resp.lineItems[0]?.glAccount;
const _aa: AccountAssignment | undefined = _resp.lineItems[0]?.accountAssignment;
// An echoed value is the closed enum, never a raw code.
// @ts-expect-error 'K' is not an AccountAssignment
const _badAa: AccountAssignment = 'K';

declare const _def: RulePropertyDefinition;
// @ts-expect-error isSystem is gone from property definitions
void _def.isSystem;

declare const _err: ClearvoError;
const _code: string | undefined = _err.code;
const _known: CustomPropertyErrorCode = 'BUILT_IN_PROPERTY_AS_CUSTOM';

void _line; void _enumLine; void _gl; void _aa; void _badAa; void _code; void _known;
