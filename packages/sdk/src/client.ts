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
  Supplier,
  CreateSupplierInput,
  UpdateSupplierInput,
  ListSuppliersParams,
  ListSuppliersResponse,
  Webhook,
  CreateWebhookInput,
  CreateWebhookResponse,
  ListWebhooksResponse,
  TaxRegistration,
  ListRegistrationsResponse,
  AddRegistrationInput,
  SetCollectionInput,
  SetCollectionResponse,
  UpdateRegistrationInput,
  UpdateRegistrationResponse,
  TaxCalculationSummary,
  ListTaxCalculationsParams,
  ListTaxCalculationsResponse,
  ListReportingObligationsResponse,
  UpdateReportingObligationsInput,
  UpdateReportingObligationsResponse,
  ListReportingBatchesParams,
  ListReportingBatchesResponse,
  GetReportingBatchResponse,
  ConfirmReportingBatchInput,
  ConfirmReportingBatchResponse,
  ExcludeFromReportingBatchInput,
  ExcludeFromReportingBatchResponse,
  RunReportingBatchSweepInput,
  RunReportingBatchSweepResponse,
  AmendReportInput,
  AmendReportResponse,
  CancelReportInput,
  CancelReportResponse,
  GetSiiReconciliationSummaryResponse,
  GetSiiReconciliationResponse,
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
  SetFrCredentialsInput,
  FrCredentialsResponse,
  UpdateBusinessStatusInput,
  UpdateBusinessStatusResponse,
  FrInboundPollResponse,
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
    if (params.receivedAfter)    qs.set('receivedAfter', params.receivedAfter);
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

  // ── Supplier Master Data ─────────────────────────────────────────────────────
  // Mirrors the product/customer master-data pattern for the other side of a
  // transaction. `supplier.ref` on calculateTax() (transactionDirection:
  // 'purchase') resolves a saved record here, same as `customer.ref` resolves
  // saved customer data on a sale.

  /** GET /suppliers responds 200 with `{ suppliers, total, page, limit }` — matches ListSuppliersResponse bare. */
  listSuppliers(params: ListSuppliersParams = {}): Promise<ListSuppliersResponse> {
    const { entityId, ...query } = params;
    const qs = new URLSearchParams();
    if (query.search) qs.set('search', query.search);
    if (query.page != null) qs.set('page', String(query.page));
    if (query.limit != null) qs.set('limit', String(query.limit));
    const q = qs.toString();
    return this.request('GET', `/suppliers${q ? `?${q}` : ''}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** POST /suppliers responds 201 with `{ supplier }`, unlike get/update/by-ref below which return the Supplier bare. */
  async createSupplier(input: CreateSupplierInput): Promise<Supplier> {
    const { entityId, ...body } = input;
    const { supplier } = await this.request<{ supplier: Supplier }>(
      'POST', '/suppliers', body, entityId ? { 'x-entity-id': entityId } : undefined
    );
    return supplier;
  }

  /** GET /suppliers/{id} responds 200 with the Supplier bare — no envelope. */
  getSupplier(supplierId: string, entityId?: string): Promise<Supplier> {
    return this.request('GET', `/suppliers/${encodeURIComponent(supplierId)}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** PATCH /suppliers/{id} responds 200 with the Supplier bare — no envelope. */
  updateSupplier(supplierId: string, updates: UpdateSupplierInput, entityId?: string): Promise<Supplier> {
    return this.request('PATCH', `/suppliers/${encodeURIComponent(supplierId)}`, updates, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** DELETE /suppliers/{id} responds 204 with no body. */
  deleteSupplier(supplierId: string, entityId?: string): Promise<void> {
    return this.request('DELETE', `/suppliers/${encodeURIComponent(supplierId)}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** GET /suppliers/by-ref/{ref} — look up a saved supplier by your own supplierRef instead of Clearvo's internal id. */
  getSupplierByRef(ref: string, entityId?: string): Promise<Supplier> {
    return this.request('GET', `/suppliers/by-ref/${encodeURIComponent(ref)}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
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

  /**
   * Edit an existing registration's tax number and/or secondary identifiers
   * (e.g. France's SIRET) in place, instead of deleting and re-adding it.
   * `extraFields` merges into the row's existing secondary identifiers —
   * only the keys passed are changed.
   */
  updateRegistration(registrationId: string, input: UpdateRegistrationInput): Promise<UpdateRegistrationResponse> {
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
   * the entity's es_sii row is what routes them to AEAT, and its submissionMode
   * decides whether each one is sent immediately or joins a reporting batch
   * (see listReportingBatches). Rows carry `registrationGate` when the entity
   * holds no registration for the regime's country — enabling is refused
   * REGISTRATION_REQUIRED until one is added.
   */
  getReportingObligations(): Promise<ListReportingObligationsResponse> {
    return this.request('GET', '/tax/reporting-obligations');
  }

  /**
   * Enable/disable regimes. Enabling requires `effectiveFrom` (EFFECTIVE_FROM_REQUIRED
   * otherwise) and, for es_sii/fr_ereporting, a current registration in that country
   * (400 REGISTRATION_REQUIRED — RegistrationRequiredError body with fixUrl). es_sii and
   * fr_ereporting accept submissionMode 'immediate' | 'batch_auto' | 'batch_review'
   * (default 'batch_review'). Disabling es_sii while a batch is open / ready_for_review /
   * overdue is refused 409 OBLIGATION_HAS_PENDING_BATCH unless `force: true`.
   */
  updateReportingObligations(input: UpdateReportingObligationsInput): Promise<UpdateReportingObligationsResponse> {
    return this.request('PATCH', '/tax/reporting-obligations', input);
  }

  // ── Spain SII reporting batches ─────────────────────────────────────────────

  /**
   * List the Spain SII reporting batches this key can see (es_sii submissionMode
   * batch_auto/batch_review), newest first. `status: 'ready_for_review'` finds the
   * batches waiting for confirmReportingBatch().
   */
  listReportingBatches(params: ListReportingBatchesParams = {}): Promise<ListReportingBatchesResponse> {
    const qs = new URLSearchParams();
    if (params.status)   qs.set('status',   params.status);
    if (params.entityId) qs.set('entityId', params.entityId);
    if (params.page  != null) qs.set('page',  String(params.page));
    if (params.limit != null) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return this.request('GET', `/reporting-batches${q ? `?${q}` : ''}`);
  }

  /** One batch with its records, AEAT outcomes, and the `snapshotVersion` confirm needs. */
  getReportingBatch(id: string): Promise<GetReportingBatchResponse> {
    return this.request('GET', `/reporting-batches/${encodeURIComponent(id)}`);
  }

  /**
   * Confirm a batch so it is submitted to AEAT now. Pass the batch's CURRENT
   * snapshotVersion — 409 BATCH_STALE if it changed since you read it (re-read and retry),
   * 409 ALREADY_SUBMITTED if already in flight, 503 ENQUEUE_FAILED if confirmed but the
   * hand-off failed (retried automatically on the next scheduler run).
   */
  confirmReportingBatch(id: string, input: ConfirmReportingBatchInput): Promise<ConfirmReportingBatchResponse> {
    return this.request('POST', `/reporting-batches/${encodeURIComponent(id)}/confirm`, input);
  }

  /**
   * Move one record out of a closed/ready_for_review batch into the next open batch.
   * 409 BATCH_OPEN (not closed yet), BATCH_LOCKED (confirmed, mid-dispatch),
   * ALREADY_SUBMITTED, or EXCLUDE_WOULD_EMPTY_BATCH (last record — leave the batch
   * unconfirmed instead).
   */
  excludeFromReportingBatch(id: string, input: ExcludeFromReportingBatchInput): Promise<ExcludeFromReportingBatchResponse> {
    return this.request('POST', `/reporting-batches/${encodeURIComponent(id)}/exclude`, input);
  }

  /**
   * SANDBOX ONLY (csk_test_* key; 403 SANDBOX_ONLY otherwise). Runs the daily
   * close/dispatch/notify sweeps for this entity right now so a batch can be driven
   * through its lifecycle in a test without waiting for the Spanish-business-day clock.
   */
  runReportingBatchSweep(input: RunReportingBatchSweepInput = {}): Promise<RunReportingBatchSweepResponse> {
    return this.request('POST', '/test-helpers/reporting-batches/run-sweep', input);
  }

  // ── Spain SII block 3: amend (A1) / cancel (Baja) / Consulta reconciliation ─

  /**
   * File an AEAT Spain SII "A1" amendment against an already-registered SII invoice — a
   * COMPLETE corrected re-registration of the document's content (same invoiceNumber/
   * issueDate as the original; never a rectificativa, never changes the invoice number).
   * `idempotencyKey` is required by the API (400 otherwise) — a same-key retry returns the
   * stored ledger row instead of rebuilding/re-enqueueing. Refuses 409 when the record isn't
   * currently ACCEPTED at AEAT (Correcto/AceptadoConErrores), an earlier amend/cancel is still
   * in flight, a batch containing it is in flight, or the corrected payload would change the
   * IDFactura identity — never silently falls back to a fresh A0.
   */
  amendSiiReport(id: string, input: AmendReportInput, idempotencyKey: string): Promise<AmendReportResponse> {
    return this.request('POST', `/invoices/${encodeURIComponent(id)}/amend-report`, input, { 'x-idempotency-key': idempotencyKey });
  }

  /**
   * File an AEAT Spain SII Baja (withdrawal) against an already-registered SII invoice.
   * Identity-only — does not cancel or refund the invoice itself (issue a credit note via
   * submitInvoice for that). Idempotent: cancelling an already-cancelled invoice returns the
   * `{ cancelled: true, cancelledAt }` shape rather than erroring, regardless of the
   * `idempotencyKey` presented. `idempotencyKey` is required by the API (400 otherwise).
   * Refuses 409 when the record is not currently registered at AEAT.
   */
  cancelSiiReport(id: string, input: CancelReportInput, idempotencyKey: string): Promise<CancelReportResponse> {
    return this.request('POST', `/invoices/${encodeURIComponent(id)}/cancel-report`, input, { 'x-idempotency-key': idempotencyKey });
  }

  /**
   * The current entity's latest AEAT Spain SII Consulta reconciliation run — id plus the
   * same condensed reassurance-line status the dashboard's Spain SII page shows. Call this
   * first to get an `id` for getSiiReconciliation() below; `id` is null only when the
   * Consulta sweep has never run for this entity. Read-only, scheduled — there is no way to
   * trigger a run on demand.
   */
  getSiiReconciliationSummary(): Promise<GetSiiReconciliationSummaryResponse> {
    return this.request('GET', '/sii/reconciliation');
  }

  /**
   * Fetch one AEAT Spain SII Consulta reconciliation run's stored comparison result — what
   * AEAT's own view of a (book, ejercicio, periodo) showed against this platform's own
   * records, including any platform-fault alert (`authorityView.missingAtAeat`). `id` comes
   * from getSiiReconciliationSummary() or the dashboard.
   */
  getSiiReconciliation(id: string): Promise<GetSiiReconciliationResponse> {
    return this.request('GET', `/sii/reconciliation/${encodeURIComponent(id)}`);
  }

  // ── Data Query Tool ────────────────────────────────────────────────────────

  /**
   * Filtered, paginated query over einvoicing_records or tax_calculations.
   * Fields, operators, and enum values are allowlisted per dataset — call
   * getQueryFields() to discover what's currently supported before building
   * `filters`/`columns`. Read access is enough — this is the dashboard's
   * Explore tool, available to every member role.
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
  // clientTaxCode on a line item instead of taxCode+taxRate) and returned as
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

  // ── France platform credentials ────────────────────────────────────────
  // No secret to store — registers/reads back the entity's own French VAT
  // number and its per-capability (einvoicing/ereporting) onboarding status.

  setFrCredentials(input: SetFrCredentialsInput): Promise<FrCredentialsResponse> {
    const { entityId, ...body } = input;
    return this.request('POST', '/fr/credentials', body, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  getFrCredentials(entityId?: string): Promise<FrCredentialsResponse> {
    return this.request('GET', '/fr/credentials', undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  // ── Business (customer-lifecycle) status ─────────────────────────────────
  // Only valid for a received (inbound) invoice — records the calling
  // entity's own decision (approve, dispute, mark paid, ...) on it.

  updateBusinessStatus(input: UpdateBusinessStatusInput): Promise<UpdateBusinessStatusResponse> {
    const { id, entityId, ...body } = input;
    return this.request(
      'PATCH',
      `/invoices/${encodeURIComponent(id)}/business-status`,
      body,
      entityId ? { 'x-entity-id': entityId } : undefined
    );
  }

  // ── France inbound poll (Marosa interim bridge) ──────────────────────────
  // Manual, entity-API-key trigger — resolves this entity's own pending
  // outbound submissions and discovers newly received inbound documents.
  // DELIBERATELY TEMPORARY; see the clearvo-fr-marosa skill.

  pollFrInbound(entityId?: string): Promise<FrInboundPollResponse> {
    return this.request('POST', '/fr/inbound/poll', {}, entityId ? { 'x-entity-id': entityId } : undefined);
  }
}
