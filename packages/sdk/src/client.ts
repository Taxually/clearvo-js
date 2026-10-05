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
  QuoteDutiesInput,
  DutiesResult,
  EstimateDutiesInput,
  DutiesEstimateResult,
  ImportSettlementInput,
  ImportSettlementResult,
  ImportSettlementList,
  ImportSettlementVarianceParams,
  ImportSettlementVariance,
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
  BankAccount,
  CreateBankAccountInput,
  UpdateBankAccountInput,
  ListBankAccountsResponse,
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
  GetClientTaxCodeOptionsParams,
  ClientTaxCodeOptionsResponse,
  GetClientTaxCodeExemptionReasonOptionsParams,
  ClientTaxCodeExemptionReasonOptionsResponse,
  ListMandateTransactionsParams,
  ListMandateTransactionsResponse,
  SetFrCredentialsInput,
  FrCredentialsResponse,
  SetItProfileInput,
  ItProfileResponse,
  UpdateBusinessStatusInput,
  UpdateBusinessStatusResponse,
  FrInboundPollResponse,
  SubmitInvoicesBulkInput,
  SubmitInvoicesBulkAsyncInput,
  SubmitInvoicesBulkResponse,
  SubmitInvoicesBulkAsyncQueuedResponse,
  GetBulkUploadStatusResponse,
  ListBulkUploadErrorsParams,
  ListBulkUploadErrorsResponse,
  ImportTaxCalculationsInput,
  ImportTaxCalculationsResponse,
  GetTaxCalculationImportStatusParams,
  GetTaxCalculationImportStatusResponse,
  ListTaxCalculationImportErrorsResponse,
  ListRulesParams,
  ListRulesResponse,
  GetRuleResponse,
  CreateRuleInput,
  CreateRuleResponse,
  UpdateRuleInput,
  SuppressRuleParams,
  SuppressRuleResponse,
  UnsuppressRuleResponse,
  ListRuleVersionsResponse,
  SimulateRuleInput,
  SimulateRuleResponse,
  ListRulePropertyDefinitionsResponse,
  CreateRulePropertyDefinitionInput,
  CreateRulePropertyDefinitionResponse,
  ListRuleTemplatesParams,
  ListRuleTemplatesResponse,
  GetRuleTemplateResponse,
  InstantiateRuleTemplateInput,
  InstantiateRuleTemplateResponse,
  ListRulesEngineDatasetsResponse,
  CreateRulesEngineDatasetInput,
  CreateRulesEngineDatasetResponse,
  GetRulesEngineDatasetResponse,
  ListRulesEngineDatasetRowsParams,
  ListRulesEngineDatasetRowsResponse,
  UpsertRulesEngineDatasetRowInput,
  UpsertRulesEngineDatasetRowResponse,
  ImportRulesEngineDatasetInput,
  ImportRulesEngineDatasetResponse,
  ListFieldMappingsParams,
  ListFieldMappingsResponse,
  GetFieldMappingResponse,
  UpdateFieldMappingInput,
  UpdateFieldMappingResponse,
  ResetFieldMappingsResponse,
  GetRulesTraceParams,
  GetRulesTraceResponse,
  ListPlatformRuleChangesParams,
  ListPlatformRuleChangesResponse,
  RulesEngineSchema,
  ProposeManualAdjustmentInput,
  ProposeManualAdjustmentResponse,
  ListManualAdjustmentsResponse,
  ManualAdjustmentStatus,
  ManualAdjustmentOptions,
} from './types.js';
import { ClearvoError } from './types.js';

const DEFAULT_BASE_URL = 'https://api.clearvo.io/v1';

// Bulk CSV ingestion — matches the hosted MCP connector's own client-side pre-check against
// POST /v1/send/bulk's synchronous ceiling (Taxually-Einvoicing lib/mcp/tools.ts).
const MAX_BULK_ROWS = 500;
const MAX_BULK_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Data-row count of a CSV's raw text (header row excluded, blank lines ignored) — client-side only, used by submitInvoicesBulk's pre-check against MAX_BULK_ROWS. */
function countCsvDataRows(csvContent: string): number {
  const lines = csvContent.split(/\r\n|\r|\n/).filter(line => line.length > 0);
  return Math.max(0, lines.length - 1);
}

/** Builds the multipart/form-data body submitInvoicesBulk(Async) send to POST /v1/send/bulk — a single 'file' field carrying the raw CSV text, same field name the route expects. */
function csvFormData(csvContent: string, filename: string): FormData {
  const formData = new FormData();
  formData.append('file', new Blob([csvContent], { type: 'text/csv' }), filename);
  return formData;
}

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
    // FormData (e.g. bulk CSV upload) must not get a JSON Content-Type or be stringified —
    // fetch sets the correct multipart boundary itself when the body is a FormData instance,
    // and stringifying it would send "[object FormData]".
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'x-api-key': this.apiKey,
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        'Accept': 'application/json',
        ...extraHeaders,
      },
      body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
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

  /**
   * `idempotencyKey` is optional and is only YOUR retry hint. Every document gets a system-generated
   * identity key from its own fields (sale: documentType + country + invoiceNumber; purchase: also
   * supplier.taxId + issueDate), returned in the `X-Idempotency-Key` response header; that, not your
   * key, is what deduplicates. A re-send of the same identity with different content is refused
   * 409 IDEMPOTENT_BODY_MISMATCH (unless the earlier attempt is NEEDS_INFO or REJECTED, which re-run
   * in place), and reusing your key for a different document is refused 409 IDEMPOTENCY_KEY_REUSED.
   * A document missing one of its identity fields is refused 422 MISSING_IDENTITY_FIELD.
   */
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

  /**
   * Estimate import duty, import VAT/GST and customs fees for a cross-border
   * cart without recording a calculation (POST /v1/duties/quote). Stateless:
   * nothing is stored and no idempotency key is read. A duty failure is a 200
   * with `duties.status: 'degraded'`, never a thrown error. Nothing in the
   * result is tax: it is never added to `totalTax`/`totalAmountWithTax`.
   */
  quoteDuties(input: QuoteDutiesInput): Promise<DutiesResult> {
    return this.request('POST', '/duties/quote', input);
  }

  /**
   * Estimate import duty, import VAT/GST, customs fees and landed cost for ONE product across up to 20 destinations
   * (POST /v1/duties/estimate). A pricing call: nothing is recorded, there is no calculation id, and a read-only key is
   * enough. Same engine and estimate/precision semantics as `quoteDuties()`; each destination carries a `status`
   * (`quoted`, `degraded` or `not_applicable`) and one bad destination never fails the call.
   */
  estimateDuties(input: EstimateDutiesInput): Promise<DutiesEstimateResult> {
    return this.request('POST', '/duties/estimate', input);
  }

  /**
   * Record what customs or the carrier actually charged after clearance for a committed calculation that carries a
   * quoted duties block (POST /v1/tax/calculate/{id}/import-settlement). Stored append-only next to the estimate, with
   * the variance computed server-side. Idempotent on calculation + consignment + `entryNumber`: replaying the same
   * actuals returns the stored settlement (`replayed: true`); different actuals for the same entry throw a 409
   * `settlement_conflict`. `actual.currency` must equal the calculation's currency (422 `currency_mismatch`). Stores
   * facts only: it never changes the calculation or the entity's tax obligations.
   */
  recordImportSettlement(calculationId: string, input: ImportSettlementInput, entityId?: string): Promise<ImportSettlementResult> {
    return this.request('POST', `/tax/calculate/${encodeURIComponent(calculationId)}/import-settlement`, input, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** GET /tax/calculate/{id}/import-settlement: a calculation's settlements and a per-currency summary. */
  getImportSettlements(calculationId: string, entityId?: string): Promise<ImportSettlementList> {
    return this.request('GET', `/tax/calculate/${encodeURIComponent(calculationId)}/import-settlement`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** GET /duties/settlement-variance: estimate-versus-entry variance grouped by destination territory and precision tier. */
  getImportSettlementVariance(params: ImportSettlementVarianceParams = {}, entityId?: string): Promise<ImportSettlementVariance> {
    const qs = new URLSearchParams();
    if (params.from)        qs.set('from', params.from);
    if (params.to)          qs.set('to', params.to);
    if (params.destination) qs.set('destination', params.destination);
    if (params.precision)   qs.set('precision', params.precision);
    const q = qs.toString();
    return this.request('GET', `/duties/settlement-variance${q ? `?${q}` : ''}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
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

  // ── Bank Account Master Data ─────────────────────────────────────────────────
  // Entity-owned IBAN/BIC master data (one per currency, plus an optional
  // entity-wide DEFAULT) so it doesn't need to be resent on every invoice —
  // see BankAccount's own doc comment (types.ts) for the fallback precedence.

  /** GET /bank-accounts responds 200 with `{ bankAccounts }`. */
  listBankAccounts(entityId?: string): Promise<ListBankAccountsResponse> {
    return this.request('GET', '/bank-accounts', undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** POST /bank-accounts responds 201 with `{ bankAccount }`, unlike get/update below which return the BankAccount bare. */
  async createBankAccount(input: CreateBankAccountInput): Promise<BankAccount> {
    const { entityId, ...body } = input;
    const { bankAccount } = await this.request<{ bankAccount: BankAccount }>(
      'POST', '/bank-accounts', body, entityId ? { 'x-entity-id': entityId } : undefined
    );
    return bankAccount;
  }

  /** GET /bank-accounts/{id} responds 200 with the BankAccount bare — no envelope. */
  getBankAccount(bankAccountId: string, entityId?: string): Promise<BankAccount> {
    return this.request('GET', `/bank-accounts/${encodeURIComponent(bankAccountId)}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** PATCH /bank-accounts/{id} responds 200 with the BankAccount bare — no envelope. */
  updateBankAccount(bankAccountId: string, updates: UpdateBankAccountInput, entityId?: string): Promise<BankAccount> {
    return this.request('PATCH', `/bank-accounts/${encodeURIComponent(bankAccountId)}`, updates, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** DELETE /bank-accounts/{id} responds 204 with no body. */
  deleteBankAccount(bankAccountId: string, entityId?: string): Promise<void> {
    return this.request('DELETE', `/bank-accounts/${encodeURIComponent(bankAccountId)}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
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

  /** GET /v1/tax/client-codes/options — valid field combinations for creating/updating a client tax code. Call before createClientTaxCode/updateClientTaxCode rather than guessing an enum value. */
  getClientTaxCodeOptions(params: GetClientTaxCodeOptionsParams = {}): Promise<ClientTaxCodeOptionsResponse> {
    const { entityId, ...query } = params;
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) qs.set(key, String(value));
    }
    const q = qs.toString();
    return this.request('GET', `/tax/client-codes/options${q ? `?${q}` : ''}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** GET /v1/tax/client-codes/exemption-reasons — candidate exemptionReasonCode values for an in-progress (not yet saved) client tax code. */
  getClientTaxCodeExemptionReasonOptions(params: GetClientTaxCodeExemptionReasonOptionsParams = {}): Promise<ClientTaxCodeExemptionReasonOptionsResponse> {
    const { entityId, ...query } = params;
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) qs.set(key, String(value));
    }
    const q = qs.toString();
    return this.request('GET', `/tax/client-codes/exemption-reasons${q ? `?${q}` : ''}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  // ── Mandate transactions ─────────────────────────────────────────────────
  // Consolidated cross-jurisdiction transaction view — one row per resolved
  // (or in-progress) mandate decision, whatever mechanism it resolved to.
  // state: 'HELD' is the direct answer to "which transactions reference a
  // client tax code that does not exist" — inspect holdReason/actionOwner on
  // each row.

  listMandateTransactions(params: ListMandateTransactionsParams = {}): Promise<ListMandateTransactionsResponse> {
    const { entityId, ...query } = params;
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) qs.set(key, String(value));
    }
    if (entityId !== undefined) qs.set('entityId', entityId);
    const q = qs.toString();
    // entityId is forwarded BOTH ways: as x-entity-id so the backend can resolve entity
    // context for an account-scoped key at all, and as a query param, which the route
    // separately reads as its own secondary filter (same convention as GET /v1/invoices).
    return this.request('GET', `/mandate-transactions${q ? `?${q}` : ''}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  // ── Bulk CSV ingestion ───────────────────────────────────────────────────
  // The public API used to split sync/async across two endpoints (/send/bulk
  // vs /send/bulk-async); that split was folded into one door 2026-09-18
  // (unify-bulk-send-endpoint) — both methods below still exist (a caller who
  // wants a guaranteed-synchronous small file vs. one who doesn't want a
  // client-side size check still has a reason to pick between them), but BOTH
  // now POST to the exact same route, which decides the real transport by
  // request size regardless of which method was called.

  /**
   * Submits (does not just validate) many transactions at once from a CSV file, through the
   * exact same resolution/dispatch pipeline as submitInvoice, one call per row. Up to 500 rows /
   * 25MB, processed synchronously with per-row outcomes in the response — throws (without
   * calling the API at all) for a csvContent over either limit, naming submitInvoicesBulkAsync
   * instead. No idempotency key needed: each row's own content (or its source_reference column)
   * is already the de-duplication key, so a byte-identical re-run of the same file is a safe
   * no-op.
   */
  submitInvoicesBulk(input: SubmitInvoicesBulkInput): Promise<SubmitInvoicesBulkResponse> {
    const { csvContent, entityId } = input;
    const rowCount = countCsvDataRows(csvContent);
    const byteLength = new TextEncoder().encode(csvContent).length;
    if (rowCount > MAX_BULK_ROWS || byteLength > MAX_BULK_UPLOAD_BYTES) {
      throw new Error(
        `This CSV has ${rowCount} data rows (${byteLength} bytes) — submitInvoicesBulk accepts at most ${MAX_BULK_ROWS} rows ` +
        `and ${MAX_BULK_UPLOAD_BYTES / (1024 * 1024)}MB per call. Use submitInvoicesBulkAsync instead for a file this size — ` +
        'no request was sent.',
      );
    }
    return this.request('POST', '/send/bulk', csvFormData(csvContent, 'invoices.csv'), entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /**
   * Submits (does not just validate) many transactions at once from a CSV file — for a file too
   * large for submitInvoicesBulk's 500-row/25MB synchronous ceiling, or simply to skip that
   * method's client-side size check. The underlying route decides the real transport by request
   * size: a small csvContent may still come back as a completed synchronous result rather than a
   * queued batch. When it DOES queue, it returns { batchId, status: 'UPLOADED' } immediately —
   * poll getBulkUploadStatus with that batchId every 30-60 seconds until status is
   * COMPLETED/FAILED/CANCELLED, then call listBulkUploadErrors if any rows errored.
   */
  submitInvoicesBulkAsync(input: SubmitInvoicesBulkAsyncInput): Promise<SubmitInvoicesBulkResponse | SubmitInvoicesBulkAsyncQueuedResponse> {
    const { csvContent, filename, entityId } = input;
    return this.request('POST', '/send/bulk', csvFormData(csvContent, filename || 'invoices.csv'), entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /**
   * Poll one async bulk upload batch — created via submitInvoicesBulkAsync, or handed back as a
   * `continuation` batchId when submitInvoicesBulk's own file had more than 500 rows. 404s (as a
   * thrown ClearvoError) when no such batch exists, or it belongs to a different entity than this
   * key is scoped to.
   */
  getBulkUploadStatus(batchId: string, entityId?: string): Promise<GetBulkUploadStatusResponse> {
    return this.request('GET', `/send/bulk/${encodeURIComponent(batchId)}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /**
   * Paginated, row-level structural errors for one async bulk upload batch — every row that never
   * reached mandate resolution (a malformed date/amount/currency, or a downstream rejection
   * before resolution). A row that DID reach resolution (however it was classified) is not a
   * structural error and is not listed here — call listMandateTransactions with the same
   * uploadBatchId instead.
   */
  listBulkUploadErrors(batchId: string, params: ListBulkUploadErrorsParams = {}): Promise<ListBulkUploadErrorsResponse> {
    const { entityId, ...query } = params;
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) qs.set(key, String(value));
    }
    const q = qs.toString();
    return this.request('GET', `/send/bulk/${encodeURIComponent(batchId)}/errors${q ? `?${q}` : ''}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  // ── Tax Calculation CSV bulk import ──────────────────────────────────────
  // A dedicated, calc-only ingestion path — deliberately separate from the
  // e-invoicing bulk methods above. Always async. Every import is a FINAL
  // calculation: no preview or confirm step. Poll getTaxCalculationImportStatus.

  /**
   * Uploads a CSV of transactions to be tax-calculated in bulk — for recording historical/backdated
   * transactions, or loading a batch of current data, into the tax calculation audit trail. This
   * never sends an invoice or reports to any tax authority — it only produces committed
   * tax_calculations rows, the same as calling calculateTax many times. Every import is FINAL:
   * there is no preview or confirm step. Always async — this call only lands the file and queues
   * it; it never calculates anything in-request. A background job then commits each clean
   * transaction immediately; transactions that error are NOT committed and are reported. Poll
   * getTaxCalculationImportStatus with the returned batchId until status is COMPLETED.
   */
  importTaxCalculations(input: ImportTaxCalculationsInput): Promise<ImportTaxCalculationsResponse> {
    const { csvContent, filename, entityId } = input;
    return this.request('POST', '/tax/calculate/import', csvFormData(csvContent, filename || 'tax-calculations.csv'), entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /**
   * Poll one tax calculation import batch, created via importTaxCalculations. Returns the batch
   * (status UPLOADED/PROCESSING/COMPLETED/FAILED/CANCELLED; total/committedCount/errorCount advance
   * while PROCESSING) plus a paginated page of its transaction groups, each with its final outcome:
   * COMMITTED (with the real calculationId) or ERROR (nothing committed, with a reason).
   */
  getTaxCalculationImportStatus(batchId: string, params: GetTaxCalculationImportStatusParams = {}): Promise<GetTaxCalculationImportStatusResponse> {
    const { entityId, ...query } = params;
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) qs.set(key, String(value));
    }
    const q = qs.toString();
    return this.request('GET', `/tax/calculate/import/${encodeURIComponent(batchId)}${q ? `?${q}` : ''}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /**
   * Every transaction group of a tax calculation import batch that was NOT committed — row range,
   * transaction ref, error code, and message — so the source file can be fixed and re-uploaded
   * for just the affected transactions.
   */
  listTaxCalculationImportErrors(batchId: string, entityId?: string): Promise<ListTaxCalculationImportErrorsResponse> {
    return this.request('GET', `/tax/calculate/import/${encodeURIComponent(batchId)}/errors?format=json`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
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

  // ── Italy profile field (Regime Fiscale) ─────────────────────────────────
  // No credential to store — Clearvo is the accredited SDI intermediary.
  // Sets/reads the entity's required Regime Fiscale profile field.

  setItProfile(input: SetItProfileInput): Promise<ItProfileResponse> {
    const { entityId, ...body } = input;
    return this.request('PUT', '/it/profile', body, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  getItProfile(entityId?: string): Promise<ItProfileResponse> {
    return this.request('GET', '/it/profile', undefined, entityId ? { 'x-entity-id': entityId } : undefined);
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

  // ── Rules Engine (B7 propagation) ─────────────────────────────────────────
  // SDK twins of every /v1/rules-engine/* operation. Scope (Entity vs
  // Organisation) is always derived server-side from the API key.

  /** Describe the rules-engine's own vocabulary — call before authoring any rule. */
  getRulesEngineSchema(): Promise<RulesEngineSchema> {
    return this.request('GET', '/rules-engine/schema');
  }

  /** This key's own rules — never the wider "effective set" a Global row would also contribute at evaluation time. `direction` is inclusive of direction-less rows. Pass `includeDefaults: true` to also get this scope's Global platform-default rules as `defaults[]`/`defaultsCount` (e.g. to find one worth suppressRule()-ing). */
  listRules(params: ListRulesParams = {}): Promise<ListRulesResponse> {
    const { entityId, includeDefaults, ...query } = params;
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) qs.set(key, String(value));
    }
    // The API only recognizes the literal string '1' here, not 'true'.
    if (includeDefaults) qs.set('includeDefaults', '1');
    const q = qs.toString();
    return this.request('GET', `/rules-engine/rules${q ? `?${q}` : ''}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  getRule(ruleId: string, entityId?: string): Promise<GetRuleResponse> {
    return this.request('GET', `/rules-engine/rules/${encodeURIComponent(ruleId)}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** Always starts status=DRAFT — call activateRule() separately to make it fire. */
  createRule(input: CreateRuleInput): Promise<CreateRuleResponse> {
    const { entityId, ...body } = input;
    return this.request('POST', '/rules-engine/rules', body, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** `version` is required (optimistic concurrency) — read it from getRule()/listRules() first. */
  updateRule(ruleId: string, input: UpdateRuleInput): Promise<GetRuleResponse> {
    const { entityId, ...body } = input;
    return this.request('PATCH', `/rules-engine/rules/${encodeURIComponent(ruleId)}`, body, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** Move a DRAFT rule to ACTIVE — the only path there. Idempotent if already ACTIVE. */
  activateRule(ruleId: string, entityId?: string): Promise<GetRuleResponse> {
    return this.request('POST', `/rules-engine/rules/${encodeURIComponent(ruleId)}/activate`, {}, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** Reorder a rule within its own ruleKind by setting a new sortOrder. */
  moveRule(ruleId: string, sortOrder: number, entityId?: string): Promise<GetRuleResponse> {
    return this.request('POST', `/rules-engine/rules/${encodeURIComponent(ruleId)}/move`, { sortOrder }, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** Opt this key's own scope out of a wider-scope platform-default (is_system) rule — the default keeps firing for every other scope. Find the id via listRules({ includeDefaults: true }). */
  suppressRule(ruleId: string, params: SuppressRuleParams = {}): Promise<SuppressRuleResponse> {
    const { entityId, ...body } = params;
    return this.request('POST', `/rules-engine/rules/${encodeURIComponent(ruleId)}/suppress`, body, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** Remove this key's own scope's suppression of a platform-default rule, if one exists — the default resumes firing for this scope. 404 if no active suppression exists. */
  unsuppressRule(ruleId: string, entityId?: string): Promise<UnsuppressRuleResponse> {
    return this.request('DELETE', `/rules-engine/rules/${encodeURIComponent(ruleId)}/suppress`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** A rule's own rules_versions history, newest first. */
  listRuleVersions(ruleId: string, entityId?: string): Promise<ListRuleVersionsResponse> {
    return this.request('GET', `/rules-engine/rules/${encodeURIComponent(ruleId)}/versions`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** Preview an already-saved rule over its own key's recent records — read-only, no write. */
  simulateRule(ruleId: string, input: SimulateRuleInput = {}): Promise<SimulateRuleResponse> {
    const { entityId, ...body } = input;
    return this.request('POST', `/rules-engine/rules/${encodeURIComponent(ruleId)}/simulate`, body, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** Preview a rule that has never been saved — `draft` is required. */
  simulateDraftRule(input: SimulateRuleInput & { draft: NonNullable<SimulateRuleInput['draft']> }): Promise<SimulateRuleResponse> {
    const { entityId, ...body } = input;
    return this.request('POST', '/rules-engine/rules/simulate', body, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** Custom property definitions visible to this key — its own scope plus every platform (Global/system) one. */
  listRulePropertyDefinitions(entityId?: string): Promise<ListRulePropertyDefinitionsResponse> {
    return this.request('GET', '/rules-engine/properties', undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  createRulePropertyDefinition(input: CreateRulePropertyDefinitionInput): Promise<CreateRulePropertyDefinitionResponse> {
    const { entityId, ...body } = input;
    return this.request('POST', '/rules-engine/properties', body, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** Starter rule templates visible to this key. */
  listRuleTemplates(params: ListRuleTemplatesParams = {}): Promise<ListRuleTemplatesResponse> {
    const { entityId, ...query } = params;
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) qs.set(key, String(value));
    }
    const q = qs.toString();
    return this.request('GET', `/rules-engine/templates${q ? `?${q}` : ''}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** One template's full detail, including its paramsSchema. */
  getRuleTemplate(templateId: string, entityId?: string): Promise<GetRuleTemplateResponse> {
    return this.request('GET', `/rules-engine/templates/${encodeURIComponent(templateId)}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** Turn a template into a real rule (always DRAFT) — call getRuleTemplate() first to see the exact params expected. */
  instantiateRuleTemplate(templateId: string, input: InstantiateRuleTemplateInput): Promise<InstantiateRuleTemplateResponse> {
    const { entityId, params } = input;
    return this.request('PUT', `/rules-engine/templates/${encodeURIComponent(templateId)}`, { params }, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** This key's own scope tuple's reference datasets. */
  listRulesEngineDatasets(entityId?: string): Promise<ListRulesEngineDatasetsResponse> {
    return this.request('GET', '/rules-engine/datasets', undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** Create a reference dataset — composite keys via keyColumns (e.g. ["glAccount", "country"]). */
  createRulesEngineDataset(input: CreateRulesEngineDatasetInput): Promise<CreateRulesEngineDatasetResponse> {
    const { entityId, ...body } = input;
    return this.request('POST', '/rules-engine/datasets', body, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  getRulesEngineDataset(datasetId: string, entityId?: string): Promise<GetRulesEngineDatasetResponse> {
    return this.request('GET', `/rules-engine/datasets/${encodeURIComponent(datasetId)}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  listRulesEngineDatasetRows(datasetId: string, params: ListRulesEngineDatasetRowsParams = {}): Promise<ListRulesEngineDatasetRowsResponse> {
    const { entityId, ...query } = params;
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) qs.set(key, String(value));
    }
    const q = qs.toString();
    return this.request('GET', `/rules-engine/datasets/${encodeURIComponent(datasetId)}/rows${q ? `?${q}` : ''}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** Upsert one row by the dataset's own key_columns — never a separate row id. */
  upsertRulesEngineDatasetRow(datasetId: string, input: UpsertRulesEngineDatasetRowInput): Promise<UpsertRulesEngineDatasetRowResponse> {
    const { entityId, ...body } = input;
    return this.request('POST', `/rules-engine/datasets/${encodeURIComponent(datasetId)}/rows`, body, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** Remove one row by its already-joined composite key string (each row's own `rowKey`). */
  deleteRulesEngineDatasetRow(datasetId: string, rowKey: string, entityId?: string): Promise<{ ok: boolean }> {
    return this.request('DELETE', `/rules-engine/datasets/${encodeURIComponent(datasetId)}/rows/${encodeURIComponent(rowKey)}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** Two-phase CSV import — dryRun (default true) computes and returns the diff without writing; call again with dryRun:false to apply that same diff. */
  importRulesEngineDataset(datasetId: string, input: ImportRulesEngineDatasetInput): Promise<ImportRulesEngineDatasetResponse> {
    const { entityId, ...body } = input;
    return this.request('POST', `/rules-engine/datasets/${encodeURIComponent(datasetId)}/import`, body, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** Raw CSV export of a dataset's rows — text/csv, not JSON. */
  async exportRulesEngineDataset(datasetId: string, entityId?: string): Promise<string> {
    const headers: Record<string, string> = { 'x-api-key': this.apiKey, ...(entityId ? { 'x-entity-id': entityId } : {}) };
    const response = await fetch(`${this.baseUrl}/rules-engine/datasets/${encodeURIComponent(datasetId)}/export`, { method: 'GET', headers });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as Record<string, unknown>;
      throw new ClearvoError(response.status, String(data.error ?? `HTTP ${response.status}`));
    }
    return response.text();
  }

  /** An entity's own field-mapping rows for one source system (e.g. "xero") — the mapping-config replacement for that integration's hand-written normalization. */
  listFieldMappings(params: ListFieldMappingsParams): Promise<ListFieldMappingsResponse> {
    const { entityId, sourceSystem } = params;
    const qs = new URLSearchParams({ sourceSystem });
    return this.request('GET', `/rules-engine/mappings?${qs.toString()}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  getFieldMapping(mappingId: string, entityId?: string): Promise<GetFieldMappingResponse> {
    return this.request('GET', `/rules-engine/mappings/${encodeURIComponent(mappingId)}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** Edit a field-mapping row, or retire it (status: 'ARCHIVED', the only status a PATCH may ever set). */
  updateFieldMapping(mappingId: string, input: UpdateFieldMappingInput): Promise<UpdateFieldMappingResponse> {
    const { entityId, ...body } = input;
    return this.request('PATCH', `/rules-engine/mappings/${encodeURIComponent(mappingId)}`, body, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** Discard every one of this entity's own edits for one source system and re-instantiate fresh copies of the current Global starter template. */
  resetFieldMappings(sourceSystem: string, entityId?: string): Promise<ResetFieldMappingsResponse> {
    const qs = new URLSearchParams({ sourceSystem });
    return this.request('POST', `/rules-engine/mappings/reset?${qs.toString()}`, {}, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** B6 — the full rules-engine execution trace for one already-calculated record, in firing order. Never plan-gated. */
  getRulesTrace(params: GetRulesTraceParams): Promise<GetRulesTraceResponse> {
    const { entityId, recordType, recordId } = params;
    const qs = new URLSearchParams({ recordType, recordId });
    return this.request('GET', `/rules-engine/trace?${qs.toString()}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** B6 — recent Global/Tenant rule changes that apply to this key's calculations. Visible even before a change's own effectiveFrom date. */
  listPlatformRuleChanges(params: ListPlatformRuleChangesParams = {}): Promise<ListPlatformRuleChangesResponse> {
    const { entityId, limit } = params;
    const qs = limit != null ? `?${new URLSearchParams({ limit: String(limit) }).toString()}` : '';
    return this.request('GET', `/rules-engine/platform-changes${qs}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  // ── AP manual adjustments ─────────────────────────────────────────────────
  // Propose/list/read-options only — confirming is a dedicated, admin-only,
  // dashboard-only action with no SDK method.

  /** Propose a manual adjustment against an already-calculated transaction — always creates a DRAFT. Call getManualAdjustmentOptions() first for the exact allowed forcedInputs/overrides keys. */
  proposeManualAdjustment(calculationId: string, input: ProposeManualAdjustmentInput): Promise<ProposeManualAdjustmentResponse> {
    const { entityId, ...body } = input;
    return this.request('POST', `/tax/calculate/${encodeURIComponent(calculationId)}/adjustments`, body, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** Manual adjustments proposed against a tax calculation, newest first. */
  listManualAdjustments(calculationId: string, params: { status?: ManualAdjustmentStatus; entityId?: string } = {}): Promise<ListManualAdjustmentsResponse> {
    const { entityId, status } = params;
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.request('GET', `/tax/calculate/${encodeURIComponent(calculationId)}/adjustments${qs}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** The backend-owned closed option lists for proposeManualAdjustment() — call before proposing rather than guessing a property name. */
  getManualAdjustmentOptions(calculationId: string, entityId?: string): Promise<ManualAdjustmentOptions> {
    return this.request('GET', `/tax/calculate/${encodeURIComponent(calculationId)}/adjustment-options`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }
}
