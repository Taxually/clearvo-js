import type {
  SendRejectionEntry,
  ClearvoClientOptions,
  Entity,
  CreateEntityInput,
  CreateEntityResponse,
  UpdateEntityInput,
  SendResult,
  SubmitInvoiceOptions,
  InvoiceStatusResponse,
  ListInvoicesParams,
  ListInvoicesResponse,
  SimulateReceivedInvoicesInput,
  SimulateReceivedInvoicesResponse,
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
  ListCompanyCodesParams,
  ListCompanyCodesResponse,
  CreateCompanyCodeInput,
  UpdateCompanyCodeInput,
  CompanyCodeResponse,
  CreateFieldMappingInput,
  CreateFieldMappingResponse,
  ListBankAccountsResponse,
  Webhook,
  CreateWebhookInput,
  TestWebhookInput,
  StartTestRunInput,
  StartTestRunResponse,
  TestRun,
  TestRunRecord,
  ListTestRunsResponse,
  ListTestCasesResponse,
  CreateTestCaseInput,
  UpdateTestCaseInput,
  TestCaseWriteResponse,
  TestCaseSkipResult,
  TestCaseCatalogue,
  TestWebhookResponse,
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
  ListCalculationRequestsParams,
  ListCalculationRequestsResponse,
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
  QueryFieldsParams,
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
  ListFilingsParams,
  ListFilingsResponse,
  GetFilingResponse,
  FilingActionResponse,
  ListFilingChangeRequestsResponse,
  FilingBankAccountResponse,
  GenerateSandboxFilingInput,
  ListFilingSetupsResponse,
  GetRegistrationFilingSetupResponse,
  UpdateRegistrationFilingSetupInput,
  ListFilingUploadMonthsResponse,
  GetFilingUploadMonthResponse,
  UploadFilingDataFileInput,
  UploadFilingDataFileResponse,
  DeleteFilingDataFileResponse,
  ProcessFilingUploadMonthInput,
  ProcessFilingUploadMonthResponse,
  FilingUploadErrorReportResponse,
  FilingUploadTemplate,
  FilingUploadTemplateFormat,
} from './types.js';
import { ClearvoError, isRejected } from './types.js';
import type { ClearvoErrorBody } from './types.js';

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

/** The x-entity-id header for an account-scoped key, or none. */
function entityHeaders(entityId?: string): Record<string, string> | undefined {
  return entityId ? { 'x-entity-id': entityId } : undefined;
}

export class ClearvoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly throwOnRejected: boolean;

  constructor(options: ClearvoClientOptions) {
    if (!options.apiKey) throw new Error('apiKey is required');
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.throwOnRejected = options.throwOnRejected ?? true;
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

    if (!response.ok) throw await this.errorFrom(response);

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  /** The ClearvoError for a non-2xx response. */
  private async errorFrom(response: Response): Promise<ClearvoError> {
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    // `error` is a string on most routes and an object ({ code, message }) on a /v1/send rejection.
    const errObj = data.error !== null && typeof data.error === 'object' ? data.error as Record<string, unknown> : null;
    // The Filings routes put the stable code in `error` and the sentence in `message` or `detail`.
    const filingsCode = !errObj && typeof data.error === 'string' && (typeof data.message === 'string' || typeof data.detail === 'string') ? data.error : undefined;
    return new ClearvoError(
      response.status,
      errObj ? String(errObj.message ?? errObj.code ?? `HTTP ${response.status}`) : String(filingsCode ? (data.message ?? data.detail) : (data.error ?? `HTTP ${response.status}`)),
      typeof data.hint === 'string' ? data.hint : undefined,
      typeof data.field === 'string' ? data.field : undefined,
      typeof data.code === 'string' ? data.code : typeof errObj?.code === 'string' ? errObj.code : filingsCode,
      Array.isArray(data.errors) ? data.errors as SendRejectionEntry[] : undefined,
      Object.keys(data).length > 0 ? data as ClearvoErrorBody : undefined
    );
  }

  /** A GET that returns a file (CSV, XLSX, PDF/image), not JSON. */
  private async requestFile(path: string, extraHeaders?: Record<string, string>): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, { method: 'GET', headers: { 'x-api-key': this.apiKey, ...extraHeaders } });
    if (!response.ok) throw await this.errorFrom(response);
    return response;
  }

  // ── E-Invoicing ──────────────────────────────────────────────────────────────

  /**
   * `idempotencyKey` is optional and is only YOUR retry hint. Every document gets a system-generated
   * identity key from its own fields (sale: documentType + country + invoiceNumber; purchase: also
   * supplier.taxId + issueDate), returned in the `X-Idempotency-Key` response header; that, not your
   * key, is what deduplicates. A re-send of the same identity with different content is refused
   * 409 IDEMPOTENT_BODY_MISMATCH (unless the earlier attempt is NEEDS_INFO or REJECTED, which re-run
   * in place). Reusing your key for a DIFFERENT document is no longer a 409: the send is processed and the response carries the
   * warning IDEMPOTENCY_KEY_REUSED_ACROSS_DOCUMENTS (a document lacking identity fields gets NO_IDENTITY_NO_DEDUP).
   * A 200 means the document is STORED, not accepted: read `outcome`, `clearanceStatus`, `statusClass` and `terminal`, and act on
   * `nextStep` for a hold. Poll getInvoiceStatus until terminal, or subscribe to the `invoice.status_changed` webhook.
   *
   * A rejection is a stored outcome and answers 200 with `ok: false`. With `throwOnRejected` true (the default for this SDK major,
   * set on the client or per call) a REJECTED or NEEDS_INFO outcome throws a {@link ClearvoError} (status 422, `code`, `errors`,
   * and the whole body on `body`), as it did before the 200 flip. With false it returns the body. 4xx and 5xx always throw: 400
   * malformed, 401/403 auth or plan, 409 edited resend, 429 rate limit, 503 INGEST_UNAVAILABLE (nothing stored: retry with the same body).
   */
  async submitInvoice(input: SubmitInvoiceInput, idempotencyKey?: string, options: SubmitInvoiceOptions = {}): Promise<SendResult> {
    const headers: Record<string, string> = {};
    if (idempotencyKey) headers['x-idempotency-key'] = idempotencyKey;
    const result = await this.request<SendResult>('POST', '/send', input, headers);
    if ((options.throwOnRejected ?? this.throwOnRejected) && isRejected(result)) throw this.rejectionError(result);
    return result;
  }

  /** The ClearvoError for a stored REJECTED / NEEDS_INFO outcome: status 422, as before the 200 flip. */
  private rejectionError(result: SendResult): ClearvoError {
    const data = result as unknown as ClearvoErrorBody;
    const err = result.error;
    return new ClearvoError(
      422,
      String(err?.message ?? err?.code ?? `Document ${result.outcome ?? result.clearanceStatus}`),
      typeof data.hint === 'string' ? data.hint : undefined,
      typeof err?.field === 'string' ? err.field : undefined,
      err?.code,
      result.errors,
      data
    );
  }

  getInvoiceStatus(referenceId: string, country: string): Promise<InvoiceStatusResponse> {
    return this.request(
      'GET',
      `/status?id=${encodeURIComponent(referenceId)}&country=${encodeURIComponent(country)}`
    );
  }

  /**
   * Sandbox only (a csk_test_ key; a live key gets 403 SANDBOX_ONLY). Creates sample received invoices or credit notes
   * from a fictional supplier through the same pipeline as a real received document: stored, archived and announced
   * with the invoice.received webhook. With no input it creates one invoice for the entity's own country.
   */
  simulateReceivedInvoices(input: SimulateReceivedInvoicesInput = {}): Promise<SimulateReceivedInvoicesResponse> {
    const { entityId, ...body } = input;
    return this.request('POST', '/receive/simulate', body, entityHeaders(entityId));
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

  // ── Company codes (Enterprise) ───────────────────────────────────────────────

  /** GET /company-codes — the entity's company codes (archived included unless `status: 'active'`). 403 `company_codes_not_included` below Enterprise. */
  listCompanyCodes(params: ListCompanyCodesParams = {}): Promise<ListCompanyCodesResponse> {
    const { entityId, status } = params;
    return this.request('GET', `/company-codes${status === 'active' ? '?status=active' : ''}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** POST /company-codes responds 201 with `{ ok, companyCode }`. */
  createCompanyCode(input: CreateCompanyCodeInput): Promise<CompanyCodeResponse> {
    const { entityId, ...body } = input;
    return this.request('POST', '/company-codes', body, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** PATCH /company-codes/{id} — rename, archive or reactivate, or set/clear (`null`) the `validFrom`/`validTo` dates. There is no delete and `code` never changes. */
  updateCompanyCode(companyCodeId: string, input: UpdateCompanyCodeInput): Promise<CompanyCodeResponse> {
    const { entityId, ...body } = input;
    return this.request('PATCH', `/company-codes/${encodeURIComponent(companyCodeId)}`, body, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  // ── Bank Account Master Data ─────────────────────────────────────────────────
  // Entity-owned IBAN/BIC master data (exactly one account is the default) so it
  // doesn't need to be resent on every invoice — see BankAccount's own doc comment
  // (types.ts) for the precedence.

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

  /** Sends one signed test event to a webhook you registered and reports what your endpoint did. Nothing is stored. */
  testWebhook(input: TestWebhookInput): Promise<TestWebhookResponse> {
    return this.request('POST', '/webhooks/test', input);
  }

  // ── Integration tests (sandbox only) ───────────────────────────────────────────

  /** Starts a run of your integration tests in the sandbox and returns at once; poll getTestRun(runId). One run at a time (409 RUN_IN_PROGRESS). */
  startTestRun(input: StartTestRunInput = {}): Promise<StartTestRunResponse> {
    const { idempotencyKey, ...body } = input;
    return this.request('POST', '/test-runs', body, idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : undefined);
  }

  /** One run: status (queued, running, waiting, passed, failed or cancelled), counts and each test's outcome. */
  getTestRun(runId: string): Promise<TestRun> {
    return this.request('GET', `/test-runs/${encodeURIComponent(runId)}`);
  }

  /** The record of one run to keep: per test what was expected, what was observed and whether they matched, with the test version, evidence ids and a content digest. No bodies are kept. */
  exportTestRun(runId: string): Promise<TestRunRecord> {
    return this.request('GET', `/test-runs/${encodeURIComponent(runId)}/export`);
  }

  listTestRuns(): Promise<ListTestRunsResponse> {
    return this.request('GET', '/test-runs');
  }

  listTestCases(): Promise<ListTestCasesResponse> {
    return this.request('GET', '/test-cases');
  }

  createTestCase(input: CreateTestCaseInput): Promise<TestCaseWriteResponse> {
    return this.request('POST', '/test-cases', input);
  }

  /** Changes one of your own tests; this creates a new version. Standard tests cannot be changed. */
  updateTestCase(caseId: string, input: UpdateTestCaseInput): Promise<TestCaseWriteResponse> {
    return this.request('PATCH', `/test-cases/${encodeURIComponent(caseId)}`, input);
  }

  /** Removes one of your own tests from new runs; past runs keep showing it. */
  archiveTestCase(caseId: string): Promise<{ id: string; archived: true }> {
    return this.request('DELETE', `/test-cases/${encodeURIComponent(caseId)}`);
  }

  /** Skips a test you do not need: it is not run, counts nowhere, and every run and export lists it as skipped. */
  skipTestCase(caseId: string): Promise<TestCaseSkipResult> {
    return this.request('PUT', `/test-cases/${encodeURIComponent(caseId)}/skip`, { skipped: true });
  }

  /** Puts a skipped test back so new runs include it again. */
  unskipTestCase(caseId: string): Promise<TestCaseSkipResult> {
    return this.request('PUT', `/test-cases/${encodeURIComponent(caseId)}/skip`, { skipped: false });
  }

  /** The closed choices for adding a test: checks and their settings, who it applies to, and the limits. */
  getTestCaseCatalogue(): Promise<TestCaseCatalogue> {
    return this.request('GET', '/test-cases/catalogue');
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

  /**
   * The calculation request ledger: every calculation request for the entity, including commit=false quotes and
   * rejected requests, with each committed calculation's link to its last matching quote.
   */
  listCalculationRequests(params: ListCalculationRequestsParams = {}): Promise<ListCalculationRequestsResponse> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
    const q = qs.toString();
    return this.request('GET', `/tax/calculation-ledger${q ? `?${q}` : ''}`);
  }

  listTaxCalculations(params: ListTaxCalculationsParams = {}): Promise<ListTaxCalculationsResponse> {
    const qs = new URLSearchParams();
    if (params.entityId) qs.set('entityId', params.entityId);
    if (params.country)  qs.set('country',  params.country);
    if (params.documentStage) qs.set('documentStage', params.documentStage);
    if (params.direction) qs.set('direction', params.direction);
    if (params.purchaseOrderId) qs.set('purchaseOrderId', params.purchaseOrderId);
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
   * (400 REGISTRATION_REQUIRED — RegistrationRequiredError body with fixUrl). es_sii accepts
   * submissionMode 'immediate' | 'batch_auto' | 'batch_review'; fr_ereporting accepts 'batch_review' | 'batch_auto'
   * (a batch_auto period you have not confirmed is sent the day before its filing deadline). Default 'batch_review'. Disabling es_sii while a batch is open / ready_for_review /
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
   * Filtered, paginated query over einvoicing_records, tax_calculations or tax_calculation_line_items (purchase decision fields:
   * apOutcome, apReasonCode, useTaxReviewRequired, poLinkStatus, statedTaxAmount).
   * Fields, operators, and enum values are allowlisted per dataset — call
   * getQueryFields() to discover what's currently supported before building
   * `filters`/`columns`. Read access is enough — this is the dashboard's
   * Explore tool, available to every member role.
   */
  queryData(params: QueryRequestParams): Promise<QueryResponse> {
    const { dataset, filters, columns, limit, from, to, cursor } = params;
    return this.request('POST', '/query', { dataset, filters, columns, limit, from, to, cursor });
  }

  /**
   * Discoverable schema for queryData(): allowlisted fields, operators, enums, and limits per dataset. With no
   * parameters it returns every dataset with every enum inlined (about 70 KB); pass `dataset`, `compact` or `field` to narrow it.
   */
  getQueryFields(params: QueryFieldsParams = {}): Promise<QueryFieldsResponse> {
    const qs = new URLSearchParams();
    if (params.dataset) qs.set('dataset', params.dataset);
    if (params.compact !== undefined) qs.set('compact', String(params.compact));
    if (params.field) qs.set('field', params.field);
    const q = qs.toString();
    return this.request('GET', `/query/fields${q ? `?${q}` : ''}`);
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

  /** Custom property definitions of this key's own scope. Built-in fields (glAccount, costCenter, intendedUse, accountAssignment, commodityCode, ...) are not custom properties; getRulesEngineSchema() lists them. */
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
      const errObj = data.error !== null && typeof data.error === 'object' ? data.error as Record<string, unknown> : null;
      throw new ClearvoError(response.status, errObj ? String(errObj.message ?? errObj.code ?? `HTTP ${response.status}`) : String(data.error ?? `HTTP ${response.status}`));
    }
    return response.text();
  }

  /** An entity's own field-mapping rows for one source system (e.g. "xero") — the mapping-config replacement for that integration's hand-written normalization. */
  listFieldMappings(params: ListFieldMappingsParams): Promise<ListFieldMappingsResponse> {
    const { entityId, sourceSystem } = params;
    const qs = new URLSearchParams({ sourceSystem });
    return this.request('GET', `/rules-engine/mappings?${qs.toString()}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
  }

  /** Add one row to a source that maps a whole calculation request (today "coupa"): `companyCode` or a defined custom property. 409 `mapping_exists` if the field is already mapped. */
  createFieldMapping(input: CreateFieldMappingInput): Promise<CreateFieldMappingResponse> {
    const { entityId, ...body } = input;
    return this.request('POST', '/rules-engine/mappings', body, entityId ? { 'x-entity-id': entityId } : undefined);
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

  // ── Filings ───────────────────────────────────────────────────────────────────
  // Tax returns Clearvo prepares and files, for any country or scheme the filing service supports (US states are one example). The key needs the `filings` product; every change needs a write key.
  // Account-scoped keys pass `entityId` (sent as x-entity-id). Display labels in the responses are written to be shown as is.

  /** GET /filings/setups: where filing setup stands for each registration, and the next step. */
  listFilingSetups(entityId?: string): Promise<ListFilingSetupsResponse> {
    return this.request('GET', '/filings/setups', undefined, entityHeaders(entityId));
  }

  /** GET /tax/registrations/{id}/filing: the full filing setup of one registration (frequency options, start periods, bank requirement). */
  getRegistrationFilingSetup(registrationId: string, entityId?: string): Promise<GetRegistrationFilingSetupResponse> {
    return this.request('GET', `/tax/registrations/${encodeURIComponent(registrationId)}/filing`, undefined, entityHeaders(entityId));
  }

  /**
   * PUT /tax/registrations/{id}/filing: request filing (`frequencyCode`, `frequencyAttested: true`, `startChoice`),
   * defer the first period (`deferFirstPeriodTo`) or stop filing (`stop: true`). Send exactly one of the three bodies.
   * Requesting without a subscription is refused 402 `plan_required`.
   */
  updateRegistrationFilingSetup(registrationId: string, input: UpdateRegistrationFilingSetupInput, entityId?: string): Promise<GetRegistrationFilingSetupResponse> {
    return this.request('PUT', `/tax/registrations/${encodeURIComponent(registrationId)}/filing`, input, entityHeaders(entityId));
  }

  /** GET /filings/bank-account: the account the tax authority debits (last four digits only). Bank details are changed in the dashboard. */
  getFilingBankAccount(entityId?: string): Promise<FilingBankAccountResponse> {
    return this.request('GET', '/filings/bank-account', undefined, entityHeaders(entityId));
  }

  /** GET /filings: your returns. `entityId` in the params is sent as x-entity-id. */
  listFilings(params: ListFilingsParams = {}): Promise<ListFilingsResponse> {
    const { entityId, ...query } = params;
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) qs.set(key, String(value));
    }
    const q = qs.toString();
    return this.request('GET', `/filings${q ? `?${q}` : ''}`, undefined, entityHeaders(entityId));
  }

  /** GET /filings/{id}: one return with totals, lines by tax authority, scope notes and a timeline. `allowedActions` says what is possible now. */
  getFiling(filingId: string, entityId?: string): Promise<GetFilingResponse> {
    return this.request('GET', `/filings/${encodeURIComponent(filingId)}`, undefined, entityHeaders(entityId));
  }

  /**
   * POST /filings/{id}/approve. For a stored filing `snapshotVersion` is the one from getFiling or listFilings; a mismatch is 409 FILING_STALE.
   * For a live return (id `ret_...`) it is ignored and may be omitted: the approval cannot be undone or withdrawn, and the answer carries `message` and the refreshed return.
   * Repeating on an approved filing returns `alreadyApplied: true`.
   */
  approveFiling(filingId: string, snapshotVersion?: number, entityId?: string): Promise<FilingActionResponse> {
    return this.request('POST', `/filings/${encodeURIComponent(filingId)}/approve`, snapshotVersion === undefined ? {} : { snapshotVersion }, entityHeaders(entityId));
  }

  /** GET /filings/{id}/documents/{docId}: one document of a live return (id `ret_...`), from `getFiling().filing.documents`. Nothing is stored; other ids answer 404. */
  async downloadFilingDocument(filingId: string, documentId: string, entityId?: string): Promise<{ contentType: string; data: ArrayBuffer }> {
    const response = await this.requestFile(`/filings/${encodeURIComponent(filingId)}/documents/${encodeURIComponent(documentId)}`, entityHeaders(entityId));
    return { contentType: response.headers.get('content-type') ?? 'application/octet-stream', data: await response.arrayBuffer() };
  }

  /** POST /filings/{id}/undo: take an approval back to PENDING_APPROVAL before the filing is submitted (409 ALREADY_SUBMITTED afterwards). */
  undoFilingApproval(filingId: string, snapshotVersion: number, entityId?: string): Promise<FilingActionResponse> {
    return this.request('POST', `/filings/${encodeURIComponent(filingId)}/undo`, { snapshotVersion }, entityHeaders(entityId));
  }

  /**
   * POST /filings/{id}/pause: hold back our finalising of a return that is waiting for approval. Limited per year; the on-time filing commitment is lost while paused.
   * For a stored filing `snapshotVersion` is required. For a live return (id `ret_...`) it is ignored and may be omitted; `endDate` (yyyy-mm-dd) is the last day of the
   * pause, within `pause.allowedEnd` on the return (omit it for the latest allowed day). Offer it only when `pause.canPause` is true.
   */
  pauseFiling(filingId: string, snapshotVersion?: number, entityId?: string, endDate?: string): Promise<FilingActionResponse> {
    const body = { ...(snapshotVersion === undefined ? {} : { snapshotVersion }), ...(endDate === undefined ? {} : { endDate }) };
    return this.request('POST', `/filings/${encodeURIComponent(filingId)}/pause`, body, entityHeaders(entityId));
  }

  /**
   * POST /filings/{id}/resume: a PAUSED filing returns to PENDING_APPROVAL; a live return (id `ret_...`) has its open pause ended early and needs no `snapshotVersion`.
   * Offer it only when `pause.canResume` is true.
   */
  resumeFiling(filingId: string, snapshotVersion?: number, entityId?: string): Promise<FilingActionResponse> {
    return this.request('POST', `/filings/${encodeURIComponent(filingId)}/resume`, snapshotVersion === undefined ? {} : { snapshotVersion }, entityHeaders(entityId));
  }

  /** POST /filings/{id}/skip: the filing becomes NOT_FILED and is not filed. Only before submission. `reason` is required (up to 500 characters). */
  skipFiling(filingId: string, input: { snapshotVersion: number; reason: string }, entityId?: string): Promise<FilingActionResponse> {
    return this.request('POST', `/filings/${encodeURIComponent(filingId)}/skip`, input, entityHeaders(entityId));
  }

  /** POST /filings/{id}/prepayment: record an amount already paid for the period. Only before approval. */
  setFilingPrepayment(filingId: string, input: { snapshotVersion: number; amount: number }, entityId?: string): Promise<FilingActionResponse> {
    return this.request('POST', `/filings/${encodeURIComponent(filingId)}/prepayment`, input, entityHeaders(entityId));
  }

  /** GET /filings/{id}/change-requests: the requests already sent to Clearvo for this filing, oldest first. */
  listFilingChangeRequests(filingId: string, entityId?: string): Promise<ListFilingChangeRequestsResponse> {
    return this.request('GET', `/filings/${encodeURIComponent(filingId)}/change-requests`, undefined, entityHeaders(entityId));
  }

  /** POST /filings/{id}/change-requests: ask Clearvo to change something that cannot be edited directly (the transactions in a filing are frozen). Up to 2000 characters. */
  requestFilingChange(filingId: string, message: string, entityId?: string): Promise<{ ok: boolean }> {
    return this.request('POST', `/filings/${encodeURIComponent(filingId)}/change-requests`, { message }, entityHeaders(entityId));
  }

  /** GET /filings/{id}/csv: the summary by authority, ending in a TOTAL row. */
  async getFilingSummaryCsv(filingId: string, entityId?: string): Promise<string> {
    return (await this.requestFile(`/filings/${encodeURIComponent(filingId)}/csv`, entityHeaders(entityId))).text();
  }

  /** GET /filings/{id}/transactions.csv: the transaction lines frozen into the filing. */
  async getFilingTransactionsCsv(filingId: string, entityId?: string): Promise<string> {
    return (await this.requestFile(`/filings/${encodeURIComponent(filingId)}/transactions.csv`, entityHeaders(entityId))).text();
  }

  /** GET /filings/{id}/proof: the proof-of-filing document (PDF, PNG or JPEG). 404 PROOF_NOT_AVAILABLE until it is attached. */
  async getFilingProof(filingId: string, entityId?: string): Promise<{ contentType: string; data: ArrayBuffer }> {
    const response = await this.requestFile(`/filings/${encodeURIComponent(filingId)}/proof`, entityHeaders(entityId));
    return { contentType: response.headers.get('content-type') ?? 'application/octet-stream', data: await response.arrayBuffer() };
  }

  /** POST /filings/sandbox/generate: sandbox keys only. Build a filing on demand for a registration whose filing frequency is set (a live key gets 409 SANDBOX_ONLY). */
  generateSandboxFiling(input: GenerateSandboxFilingInput): Promise<{ ok: boolean; created?: boolean; filing?: unknown }> {
    const { entityId, ...body } = input;
    return this.request('POST', '/filings/sandbox/generate', body, entityHeaders(entityId));
  }

  // ── Filings: data upload ────────────────────────────────────────────────────────
  // Add your own transaction data to a filing month: one or several files per month, then confirm and process the month once.
  // A month takes data from when its period closes until the end of the day the return is approved automatically
  // (the 5th of the following month by default).

  /** GET /filings/upload/months: the months you can add data to, newest first, with their window state. */
  listFilingUploadMonths(entityId?: string): Promise<ListFilingUploadMonthsResponse> {
    return this.request('GET', '/filings/upload/months', undefined, entityHeaders(entityId));
  }

  /** GET /filings/upload/months/{month}: the files (with counts), window, `canUpload` / `canConfirm` and the `declaration` to accept. `month` is yyyy-MM. */
  getFilingUploadMonth(month: string, entityId?: string): Promise<GetFilingUploadMonthResponse> {
    return this.request('GET', `/filings/upload/months/${encodeURIComponent(month)}`, undefined, entityHeaders(entityId));
  }

  /**
   * POST /filings/upload/months/{month}/files: add a data file (.csv, .xlsx or .xls, up to 25 MB) to the month. Call it again for each
   * further file; every file in the month is processed together. A file with the same name or content as one already added is 409
   * FILE_ALREADY_ADDED (`ClearvoError.body.existingId` is the id of the file already there): to replace a file, delete it and upload the new one.
   */
  uploadFilingDataFile(month: string, input: UploadFilingDataFileInput, entityId?: string): Promise<UploadFilingDataFileResponse> {
    const lower = input.fileName.toLowerCase();
    const type = input.contentType ?? (lower.endsWith('.csv') ? 'text/csv' : lower.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.ms-excel');
    const part = input.content instanceof Blob ? input.content : new Blob([input.content as never], { type });
    const form = new FormData();
    form.append('file', part, input.fileName);
    return this.request('POST', `/filings/upload/months/${encodeURIComponent(month)}/files`, form, entityHeaders(entityId));
  }

  /** DELETE /filings/upload/months/{month}/files/{fileId}: remove a file you added while the month is open. The calculated (system) file cannot be removed. */
  deleteFilingDataFile(month: string, fileId: string, entityId?: string): Promise<DeleteFilingDataFileResponse> {
    return this.request('DELETE', `/filings/upload/months/${encodeURIComponent(month)}/files/${encodeURIComponent(fileId)}`, undefined, entityHeaders(entityId));
  }

  /**
   * POST /filings/upload/months/{month}/process: confirm that all data for the month is added and process it once. The person confirming
   * accepts the declaration shown with the month: send `declarationAccepted: true` and its `declarationVersion` (otherwise 422
   * DECLARATION_REQUIRED / DECLARATION_VERSION_MISMATCH, with `body.currentVersion` and `body.declaration`). If any row in a file has an error, the whole file is not used: while any file in the month has errors the call is
   * 409 FILE_ERRORS (`body.filesWithErrors`), or 409 SYSTEM_FILE_ERRORS (with `body.contactUrl`) when a file prepared for you has errors; fix the file
   * and upload it again, or delete it, then confirm. Warnings never block. Resolves with 202 while processing runs: poll getFilingUploadMonth until
   * `state` is `done` or `errors`. A month is finished by approving the return.
   */
  processFilingUploadMonth(month: string, input: ProcessFilingUploadMonthInput, entityId?: string): Promise<ProcessFilingUploadMonthResponse> {
    return this.request('POST', `/filings/upload/months/${encodeURIComponent(month)}/process`, input, entityHeaders(entityId));
  }

  /** GET /filings/upload/months/{month}/files/{fileId}/error-report: a fresh download link (https only) for the error and warning report of a processed file (404 no_error_report when it has neither). Do not store the link. */
  getFilingUploadErrorReport(month: string, fileId: string, entityId?: string): Promise<FilingUploadErrorReportResponse> {
    return this.request('GET', `/filings/upload/months/${encodeURIComponent(month)}/files/${encodeURIComponent(fileId)}/error-report`, undefined, entityHeaders(entityId));
  }

  /** GET /filings/upload/template: the columns Clearvo expects. `json` (default here) is the definition, `csv` the template text, `xlsx` the workbook. */
  getFilingUploadTemplate(format?: 'json', entityId?: string): Promise<FilingUploadTemplate>;
  getFilingUploadTemplate(format: 'csv', entityId?: string): Promise<string>;
  getFilingUploadTemplate(format: 'xlsx', entityId?: string): Promise<ArrayBuffer>;
  async getFilingUploadTemplate(format: FilingUploadTemplateFormat = 'json', entityId?: string): Promise<FilingUploadTemplate | string | ArrayBuffer> {
    const response = await this.requestFile(`/filings/upload/template?format=${format}`, entityHeaders(entityId));
    if (format === 'json') return (await response.json()) as FilingUploadTemplate;
    if (format === 'csv') return response.text();
    return response.arrayBuffer();
  }
}
