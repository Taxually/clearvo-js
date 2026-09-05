import type {
  ClearvoClientOptions,
  Entity,
  CreateEntityInput,
  CreateEntityResponse,
  UpdateEntityInput,
  InvoiceSubmitResponse,
  InvoiceStatusResponse,
  ListInvoicesParams,
  ListInvoicesResponse,
  TaxCalculateRequest,
  TaxCalculateResponse,
  TaxNumberValidateResponse,
  TaxNumberBatchItem,
  TaxNumberBatchResult,
  CountryRequirements,
  Product,
  CreateProductInput,
  UpdateProductInput,
  ListProductsParams,
  ListProductsResponse,
  Webhook,
  CreateWebhookInput,
  CreateWebhookResponse,
  ListWebhooksResponse,
  TaxRegistration,
  ListRegistrationsResponse,
  AddRegistrationInput,
  SetCollectionInput,
  SetCollectionResponse,
  TaxCalculationSummary,
  ListTaxCalculationsParams,
  ListTaxCalculationsResponse,
  ListReportingObligationsResponse,
  UpdateReportingObligationsInput,
  UpdateReportingObligationsResponse,
  QueryRequestParams,
  QueryResponse,
  QueryFieldsResponse,
  ListClientTaxCodesResponse,
  CreateClientTaxCodeInput,
  UpdateClientTaxCodeInput,
  ClientTaxCodeResponse,
  SubmitInvoiceInput,
  ListTaxCodesParams,
  ListTaxCodesResponse,
} from './types.js';
import { ClearvoError } from './types.js';

const DEFAULT_BASE_URL = 'https://api.clearvo.io/v1';

export class ClearvoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: ClearvoClientOptions) {
    if (!options.apiKey) throw new Error('apiKey is required');
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...extraHeaders,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as Record<string, unknown>;
      throw new ClearvoError(
        response.status,
        String(data.error ?? `HTTP ${response.status}`),
        typeof data.hint === 'string' ? data.hint : undefined,
        typeof data.field === 'string' ? data.field : undefined
      );
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  // ── E-Invoicing ──────────────────────────────────────────────────────────────

  submitInvoice(input: SubmitInvoiceInput, idempotencyKey?: string): Promise<InvoiceSubmitResponse> {
    const headers: Record<string, string> = {};
    if (idempotencyKey) headers['x-idempotency-key'] = idempotencyKey;
    return this.request('POST', '/send', input, headers);
  }

  getInvoiceStatus(referenceId: string, country: string): Promise<InvoiceStatusResponse> {
    return this.request(
      'GET',
      `/status?id=${encodeURIComponent(referenceId)}&country=${encodeURIComponent(country)}`
    );
  }

  listInvoices(params: ListInvoicesParams = {}): Promise<ListInvoicesResponse> {
    const qs = new URLSearchParams();
    if (params.limit    != null) qs.set('limit',     String(params.limit));
    if (params.afterId)          qs.set('after_id',  params.afterId);
    if (params.beforeId)         qs.set('before_id', params.beforeId);
    if (params.country)          qs.set('country',   params.country);
    if (params.status)           qs.set('status',    params.status);
    const q = qs.toString();
    return this.request('GET', `/invoices${q ? `?${q}` : ''}`);
  }

  // ── Tax Calculation ───────────────────────────────────────────────────────────

  calculateTax(input: TaxCalculateRequest): Promise<TaxCalculateResponse> {
    return this.request('POST', '/tax/calculate', input);
  }

  // ── Tax Number Validation ─────────────────────────────────────────────────────

  validateTaxNumber(countryCode: string, taxNumber: string): Promise<TaxNumberValidateResponse> {
    return this.request('POST', '/tax-numbers/validate', { countryCode, taxNumber });
  }

  // ── Entity Management ─────────────────────────────────────────────────────────

  listEntities(): Promise<{ entities: Entity[] }> {
    return this.request('GET', '/entities');
  }

  getEntity(entityId: string): Promise<Entity> {
    return this.request('GET', `/entities/${encodeURIComponent(entityId)}`);
  }

  createEntity(input: CreateEntityInput): Promise<CreateEntityResponse> {
    return this.request('POST', '/entities', input);
  }

  updateEntity(entityId: string, updates: UpdateEntityInput): Promise<Entity> {
    return this.request('PATCH', `/entities/${encodeURIComponent(entityId)}`, updates);
  }

  // ── Product Catalogue ─────────────────────────────────────────────────────────

  listProducts(params: ListProductsParams = {}): Promise<ListProductsResponse> {
    const qs = new URLSearchParams();
    if (params.entityId) qs.set('entityId', params.entityId);
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.page  != null) qs.set('page',  String(params.page));
    if (params.sort) qs.set('sort', params.sort);
    const q = qs.toString();
    return this.request('GET', `/products${q ? `?${q}` : ''}`);
  }

  createProduct(input: CreateProductInput): Promise<Product> {
    return this.request('POST', '/products', input);
  }

  updateProduct(productId: string, updates: UpdateProductInput): Promise<Product> {
    return this.request('PATCH', `/products/${encodeURIComponent(productId)}`, updates);
  }

  getProduct(productId: string): Promise<Product> {
    return this.request('GET', `/products/${encodeURIComponent(productId)}`);
  }

  deleteProduct(productId: string): Promise<void> {
    return this.request('DELETE', `/products/${encodeURIComponent(productId)}`);
  }

  // ── Requirements ──────────────────────────────────────────────────────────────

  getRequirements(country: string): Promise<CountryRequirements> {
    return this.request('GET', `/requirements?country=${encodeURIComponent(country)}`);
  }

  // ── Webhooks ──────────────────────────────────────────────────────────────────

  listWebhooks(params: { limit?: number; page?: number } = {}): Promise<ListWebhooksResponse> {
    const qs = new URLSearchParams();
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.page  != null) qs.set('page',  String(params.page));
    const q = qs.toString();
    return this.request('GET', `/webhooks${q ? `?${q}` : ''}`);
  }

  createWebhook(input: CreateWebhookInput): Promise<CreateWebhookResponse> {
    return this.request('POST', '/webhooks', input);
  }

  deleteWebhook(webhookId: string): Promise<{ ok: boolean; id: string }> {
    return this.request('DELETE', `/webhooks?id=${encodeURIComponent(webhookId)}`);
  }

  // ── Batch TIN Validation ──────────────────────────────────────────────────────

  validateTaxNumbersBatch(items: TaxNumberBatchItem[]): Promise<TaxNumberBatchResult> {
    return this.request('POST', '/tax-numbers/validate-batch', { items });
  }

  // ── Tax Registrations ──────────────────────────────────────────────────────────

  listRegistrations(entityId?: string): Promise<ListRegistrationsResponse> {
    const qs = entityId ? `?entityId=${encodeURIComponent(entityId)}` : '';
    return this.request('GET', `/tax/registrations${qs}`);
  }

  addRegistration(input: AddRegistrationInput): Promise<{ ok: boolean; registration?: object }> {
    return this.request('POST', '/tax/registrations', input);
  }

  setCollectionDate(registrationId: string, input: SetCollectionInput): Promise<SetCollectionResponse> {
    return this.request('PATCH', `/tax/registrations/${encodeURIComponent(registrationId)}`, input);
  }

  // ── Tax Calculation History ───────────────────────────────────────────────────

  listTaxCalculations(params: ListTaxCalculationsParams = {}): Promise<ListTaxCalculationsResponse> {
    const qs = new URLSearchParams();
    if (params.entityId) qs.set('entityId', params.entityId);
    if (params.country)  qs.set('country',  params.country);
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.page  != null) qs.set('page',  String(params.page));
    const q = qs.toString();
    return this.request('GET', `/tax/calculate${q ? `?${q}` : ''}`);
  }

  // ── Tax Reporting obligations ────────────────────────────────────────────────

  /**
   * Per-regime reporting toggles (France e-reporting, Spain SII) for the entity.
   * Spain SII invoices go through submitInvoice() like every other country —
   * the entity's es_sii row is what routes them to AEAT.
   */
  getReportingObligations(): Promise<ListReportingObligationsResponse> {
    return this.request('GET', '/tax/reporting-obligations');
  }

  /**
   * Enable/disable regimes. Enabling requires `effectiveFrom`; a bare `true`
   * is rejected with EFFECTIVE_FROM_REQUIRED.
   */
  updateReportingObligations(input: UpdateReportingObligationsInput): Promise<UpdateReportingObligationsResponse> {
    return this.request('PATCH', '/tax/reporting-obligations', input);
  }

  // ── Data Query Tool ────────────────────────────────────────────────────────

  /**
   * Filtered, paginated query over einvoicing_records or tax_calculations.
   * Fields, operators, and enum values are allowlisted per dataset — call
   * getQueryFields() to discover what's currently supported before building
   * `filters`/`columns`.
   */
  queryData(params: QueryRequestParams): Promise<QueryResponse> {
    const { dataset, filters, columns, limit, from, to, cursor } = params;
    return this.request('POST', '/query', { dataset, filters, columns, limit, from, to, cursor });
  }

  /** Discoverable schema for queryData(): allowlisted fields, operators, enums, and limits per dataset. */
  getQueryFields(): Promise<QueryFieldsResponse> {
    return this.request('GET', '/query/fields');
  }

  // ── Client Tax Codes ──────────────────────────────────────────────────────
  // Maps a customer's own ERP tax code (e.g. a SAP two-digit code) to the
  // tax treatment it represents. Used as an INPUT on submitInvoice() (pass
  // clientTaxCode on a line item instead of taxCode+vatRate) and returned as
  // an OUTPUT on calculateTax() (the response echoes back your matching code
  // for ERP posting). `rate` is always response-only — never send it.

  listClientTaxCodes(entityId?: string): Promise<ListClientTaxCodesResponse> {
    return this.request('GET', '/tax/client-codes', undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  createClientTaxCode(input: CreateClientTaxCodeInput): Promise<ClientTaxCodeResponse> {
    const { entityId, ...body } = input;
    return this.request('POST', '/tax/client-codes', body, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  updateClientTaxCode(clientTaxCodeId: string, updates: UpdateClientTaxCodeInput, entityId?: string): Promise<ClientTaxCodeResponse> {
    return this.request(
      'PATCH',
      `/tax/client-codes/${encodeURIComponent(clientTaxCodeId)}`,
      updates,
      entityId ? { 'x-entity-id': entityId } : undefined
    );
  }

  deleteClientTaxCode(clientTaxCodeId: string, entityId?: string): Promise<{ ok: boolean }> {
    return this.request(
      'DELETE',
      `/tax/client-codes/${encodeURIComponent(clientTaxCodeId)}`,
      undefined,
      entityId ? { 'x-entity-id': entityId } : undefined
    );
  }

  /** GET /v1/tax/codes — every tax-code row this platform knows about, plus this entity's own client tax codes, in one shape. */
  listTaxCodes(params: ListTaxCodesParams = {}): Promise<ListTaxCodesResponse> {
    const { entityId, ...query } = params;
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) qs.set(key, String(value));
    }
    const q = qs.toString();
    return this.request('GET', `/tax/codes${q ? `?${q}` : ''}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }
}
