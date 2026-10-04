// Coverage for ClearvoClient.estimateDuties(), recordImportSettlement(), getImportSettlements() and
// getImportSettlementVariance(): POST /v1/duties/estimate, POST/GET /v1/tax/calculate/{id}/import-settlement and
// GET /v1/duties/settlement-variance. Bodies are sent as given and results returned unchanged.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';
import { ClearvoError } from '../src/types';
import type { DutiesEstimateResult, ImportSettlementResult } from '../src/types';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
const client = () => new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
const respond = (status: number, body: unknown) => vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });

describe('ClearvoClient.estimateDuties', () => {
  it('POSTs the body unchanged to /duties/estimate and returns the per-destination result', async () => {
    const result: DutiesEstimateResult = {
      currency: 'USD',
      product: { commodityCode: '610910', scheme: 'HS6', codeSource: 'request', precision: 'HS6_EXACT', countryOfOrigin: 'CN', originSource: 'request' },
      destinations: [
        { destination: { country: 'DE' }, status: 'quoted', duties: { status: 'quoted', contentVersion: 7 }, summary: { totalDuty: 12 } },
        { destination: { country: 'US' }, status: 'degraded', reason: 'destination_rejected', error: 'region is required', duties: { status: 'degraded', reason: 'internal_error' } },
      ],
    };
    const fetchMock = respond(200, result);
    global.fetch = fetchMock as unknown as typeof fetch;
    const input = {
      currency: 'USD',
      shipFrom: { country: 'CN' },
      product: { commodityCode: '610910', commodityCodeScheme: 'HS6' as const, countryOfOrigin: 'CN', unitPrice: 25, quantity: 4 },
      destinations: [{ country: 'DE' }, { country: 'US' }],
    };
    expect(await client().estimateDuties(input)).toEqual(result);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/duties/estimate');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual(input);
  });
});

describe('ClearvoClient import settlement', () => {
  const settlement: ImportSettlementResult = {
    replayed: false,
    settlement: {
      id: 'cl_impset_1', calculationId: 'cl_calc/1', consignmentId: 'c1', entryNumber: 'E-1', entryDate: null, currency: 'GBP',
      destinationTerritory: 'GB', precisionAtQuote: 'HS6_EXACT',
      estimated: { duty: 12.5, importTax: 20.1, fees: 3.3, total: 35.9 }, actual: { duty: 14, importTax: 20.1, fees: 3.3, total: 37.4 },
      variance: { duty: { amount: 1.5, percent: 12 }, importTax: { amount: 0, percent: 0 }, fees: { amount: 0, percent: 0 }, total: { amount: 1.5, percent: 4.1783 } },
      withinEstimate: false, notes: null, createdAt: '2026-10-02T10:00:00.000Z',
    },
  };

  it('POSTs to the calculation\'s import-settlement path with the id URL-encoded and the entity header', async () => {
    const fetchMock = respond(201, settlement);
    global.fetch = fetchMock as unknown as typeof fetch;
    const input = { entryNumber: 'E-1', actual: { duty: 14, importTax: 20.1, fees: 3.3, currency: 'GBP' } };
    expect(await client().recordImportSettlement('cl_calc/1', input, 'ent-1')).toEqual(settlement);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/tax/calculate/cl_calc%2F1/import-settlement');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-entity-id']).toBe('ent-1');
    expect(JSON.parse(opts.body as string)).toEqual(input);
  });

  it('throws ClearvoError on a 409 conflict', async () => {
    global.fetch = respond(409, { error: 'Entry E-1 is already settled', code: 'settlement_conflict' }) as unknown as typeof fetch;
    await expect(client().recordImportSettlement('cl_calc_1', { entryNumber: 'E-1', actual: { duty: 1, importTax: 1, fees: 1, currency: 'GBP' } })).rejects.toBeInstanceOf(ClearvoError);
  });

  it('GETs the settlements list', async () => {
    const fetchMock = respond(200, { calculationId: 'cl_calc_1', currency: 'GBP', settlements: [], summary: { count: 0, byCurrency: [] } });
    global.fetch = fetchMock as unknown as typeof fetch;
    await client().getImportSettlements('cl_calc_1');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x/v1/tax/calculate/cl_calc_1/import-settlement');
    expect(opts.method).toBe('GET');
  });

  it('GETs the variance aggregate with only the filters supplied', async () => {
    const fetchMock = respond(200, { filters: {}, groups: [] });
    global.fetch = fetchMock as unknown as typeof fetch;
    await client().getImportSettlementVariance({ from: '2026-10-01', destination: 'GB' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/duties/settlement-variance?from=2026-10-01&destination=GB');
    await client().getImportSettlementVariance();
    expect(fetchMock.mock.calls[1][0]).toBe('http://x/v1/duties/settlement-variance');
  });
});
