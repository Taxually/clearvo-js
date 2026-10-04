// Compile-time guard for estimateDuties() and the import-settlement methods.

import type {
  ClearvoClient,
  DutiesEstimateResult,
  EstimateDutiesInput,
  ImportSettlementInput,
  ImportSettlementList,
  ImportSettlementResult,
  ImportSettlementVariance,
} from '../src/index.js';

declare const client: ClearvoClient;

const _input: EstimateDutiesInput = {
  currency: 'USD',
  shipFrom: { country: 'CN' },
  product: { commodityCode: '610910', commodityCodeScheme: 'HS6', countryOfOrigin: 'CN', unitPrice: 25, quantity: 4, weight: { value: 200, unit: 'g' } },
  freight: { amount: 12 },
  destinations: [{ country: 'DE' }, { country: 'US', region: 'TX' }],
};
const _result: Promise<DutiesEstimateResult> = client.estimateDuties(_input);

async function _readResult(): Promise<void> {
  const r = await client.estimateDuties(_input);
  const status: 'quoted' | 'degraded' | 'not_applicable' = r.destinations[0].status;
  const precision = r.product.precision;
  void status; void precision;
}

// @ts-expect-error destinations is required
const _noDestinations: EstimateDutiesInput = { currency: 'USD', product: { amount: 1 } };
// @ts-expect-error an unknown scheme is rejected
const _badScheme: EstimateDutiesInput = { currency: 'USD', product: { commodityCodeScheme: 'HS8' }, destinations: [] };

const _settleInput: ImportSettlementInput = { entryNumber: 'E-1', actual: { duty: 1, importTax: 2, fees: 3, currency: 'GBP' } };
const _settled: Promise<ImportSettlementResult> = client.recordImportSettlement('cl_calc_1', _settleInput);
const _list: Promise<ImportSettlementList> = client.getImportSettlements('cl_calc_1');
const _variance: Promise<ImportSettlementVariance> = client.getImportSettlementVariance({ from: '2026-10-01' });

// @ts-expect-error actual.currency is required
const _noCurrency: ImportSettlementInput = { entryNumber: 'E', actual: { duty: 1, importTax: 1, fees: 1 } };

void [_result, _noDestinations, _badScheme, _settled, _list, _variance, _noCurrency];
