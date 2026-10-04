// Compile-time guard for customs duties: quoteDuties() takes the calculate body without commit / credit-note /
// purchase fields and returns DutiesResult; the closed enums and the rateExpression union stay closed; calculateTax()
// carries the same duty blocks.

import type {
  ClearvoClient,
  DutiesResult,
  DutyConsignment,
  DutyRateExpression,
  LineDuty,
  QuoteDutiesInput,
  QuotedDutyConsignment,
  TaxCalculateRequest,
  TaxCalculateResponse,
} from '../src/index.js';

declare const client: ClearvoClient;

// ── quoteDuties(): input and result ───────────────────────────────────────────
const _input: QuoteDutiesInput = {
  currency: 'USD',
  customer: { billingAddress: { country: 'US', region: 'TX', postalCode: '78701' } },
  shipFrom: { country: 'GB', postalCode: 'SW1A 1AA', customsStatus: 'free_circulation' },
  incoterms: 'DAP',
  importerOfRecord: 'BUYER',
  insurance: { amount: 1.5 },
  duties: { collectDeposit: true, ratePolicyForHs6: 'highest' },
  lineItems: [{
    id: 'l1', amount: 40, productName: 'T-shirt',
    commodityCode: '6109100012', commodityCodeScheme: 'HTS10', countryOfOrigin: 'CN',
    weight: { value: 0.2, unit: 'kg' },
  }],
};

const _result: Promise<DutiesResult> = client.quoteDuties(_input);

// @ts-expect-error — a quote never commits.
const _commit: QuoteDutiesInput = { ..._input, commit: true };
// @ts-expect-error — a quote carries no idempotency key.
const _key: QuoteDutiesInput = { ..._input, idempotencyKey: 'k' };
// @ts-expect-error — duties are quoted for a sale only.
const _direction: QuoteDutiesInput = { ..._input, transactionDirection: 'purchase' };
// @ts-expect-error — duties.include is implied on a quote, and false is rejected.
const _include: QuoteDutiesInput = { ..._input, duties: { include: false } };

declare const result: DutiesResult;
const _status: 'quoted' | 'not_applicable' | 'degraded' | 'disabled' = result.duties.status;
const _currency: string = result.currency;
const _lineDuty: LineDuty = result.lineItems[0].duty;
const _total: number | undefined = result.summary?.totalDuty;
const _due: number | undefined = result.summary?.totalAmountDue;

// ── consignments are a discriminated union on status ───────────────────────────
declare const consignment: DutyConsignment;
if (consignment.status === 'quoted') {
  const _quoted: QuotedDutyConsignment = consignment;
  const _party: 'seller' | 'buyer' | 'unresolved' = _quoted.responsibleParty;
  const _collect: boolean = _quoted.collectedAtCheckout;
  const _charges: number = _quoted.importChargesAtCheckout;
  const _basis: 'FOB' | 'CIF' | undefined = _quoted.valuation?.basis;
  void [_party, _collect, _charges, _basis];
} else if (consignment.status === 'degraded') {
  const _reason: 'fx_rate_missing' | 'territory_content_missing' | 'content_unavailable' | 'internal_error' = consignment.reason;
  void _reason;
} else {
  const _reason: 'no_customs_crossing' | 'ship_from_unknown' = consignment.reason;
  void _reason;
}

// ── closed enums ───────────────────────────────────────────────────────────────
declare const line: LineDuty;
// @ts-expect-error — 'MADE_UP' is not a DutyPrecision.
const _precision: 'MADE_UP' = line.precision;
// @ts-expect-error — 'unknown_reason' is not an estimate reason.
const _reasons: 'unknown_reason'[] = line.estimateReasons;
// @ts-expect-error — HS8 is not a commodity code scheme.
const _scheme: TaxCalculateRequest['lineItems'][number]['commodityCodeScheme'] = 'HS8';

// ── rateExpression is a closed union ───────────────────────────────────────────
const _adValorem: DutyRateExpression = { type: 'ad_valorem_pct', value: 16.5 };
const _compound: DutyRateExpression = {
  type: 'compound',
  parts: [{ type: 'ad_valorem_pct', value: 5 }, { type: 'specific', amount: 1.2, currency: 'EUR', per: 'kg' }],
};
const _capped: DutyRateExpression = { type: 'min_max', base: { type: 'ad_valorem_pct', value: 0.3464 }, min: { type: 'flat', amount: 34.58, currency: 'USD' } };
// @ts-expect-error — 'percent' is not a rate expression type.
const _badExpression: DutyRateExpression = { type: 'percent', value: 5 };
const _measureRate: number | null = line.measures[0].rate;

// ── calculateTax() carries the same blocks ─────────────────────────────────────
declare const calc: TaxCalculateResponse;
const _block: DutiesResult['duties'] | undefined = calc.duties;
const _consignments: DutyConsignment[] | undefined = calc.consignments;
const _lineOnCalc: LineDuty | undefined = calc.lineItems[0]?.duty;
const _importCharges: number | undefined = calc.summary.importChargesAtCheckout;

void [
  _result, _commit, _key, _direction, _include, _status, _currency, _lineDuty, _total, _due, _precision, _reasons, _scheme,
  _adValorem, _compound, _capped, _badExpression, _measureRate, _block, _consignments, _lineOnCalc, _importCharges,
];
