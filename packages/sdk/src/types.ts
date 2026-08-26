export interface ClearvoClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export interface Entity {
  id: string;
  name: string;
  country: string;
  vatNumber: string | null;
  isDefault: boolean;
  createdAt: string;
}

export interface CreateEntityInput {
  legalName: string;
  country: string;
  vatNumber?: string;
}

export interface CreateEntityResponse {
  entityId: string;
  accountId: string;
  name: string;
  country: string;
  vatNumber: string | null;
  apiKey: string;
}

export interface UpdateEntityInput {
  name?: string;
  vatNumber?: string;
  /** Default for InvoiceRequest.notifyBuyer — applies whenever a send omits its own override. */
  notifyBuyerByDefault?: boolean;
}

export interface InvoiceSubmitResponse {
  referenceId: string;
  status: string;
  message?: string;
  /**
   * Outcome of the buyer invoice notification feature — only present for
   * countries where no authority network delivers the invoice to the buyer
   * (Spain, Portugal, France, Germany always; Italy B2C).
   */
  buyerNotification?: {
    status: 'SENT' | 'SKIPPED' | 'FAILED';
    reason?: 'NOT_APPLICABLE' | 'NOT_OPTED_IN' | 'MISSING_BUYER_EMAIL' | 'NOTIFICATIONS_NOT_CONFIGURED';
    error?: string;
  };
}

export interface InvoiceStatusResponse {
  referenceId: string;
  clearanceStatus: string;
  clearanceStatusLabel?: string;
  ksefNumber?: string;
  updatedAt: string;
}

export interface ListInvoicesParams {
  limit?: number;
  afterId?: string;
  beforeId?: string;
  country?: string;
  status?: string;
}

export interface ListInvoicesResponse {
  invoices: unknown[];
  total: number;
  nextCursor: string | null;
  prevCursor: string | null;
}

export interface TaxCalculateRequest {
  currency: string;
  commit?: boolean;
  idempotencyKey?: string;
  seller: {
    address: { country: string };
    taxId?: string;
  };
  shipFrom?: { country: string };
  /**
   * Incoterms 2020 rule for the shipment. Does not gate IOSS eligibility
   * (applies whenever ship-from is non-EU, destination is EU, and value is
   * <=EUR150, regardless of incoterms). Above that threshold — or for any
   * B2C cross-border physical-goods shipment with no applicable
   * value-threshold scheme at all — this determines import-VAT liability:
   * omitted or 'DDP' (seller is importer of record) leaves the ordinary
   * registration-based treatment unchanged; any other value (buyer is
   * importer of record) makes the line outside the scope of Clearvo tax
   * calculation (taxCode 'O', tax charged 0), since the buyer's own customs
   * process collects import VAT separately. Never affects B2B transactions.
   */
  incoterms?: 'EXW' | 'FCA' | 'FAS' | 'FOB' | 'CFR' | 'CIF' | 'CPT' | 'CIP' | 'DAP' | 'DPU' | 'DDP';
  customer: {
    type: 'B2B' | 'B2C' | 'B2G';
    taxId?: string;
    billingAddress: {
      country: string;
      region?: string;
      postalCode?: string;
    };
    shippingAddress?: { country: string; region?: string; postalCode?: string };
  };
  evidence?: {
    ipAddress?: string;
    binCountry?: string;
  };
  lineItems: Array<{
    id: string;
    amount: number;
    quantity?: number;
    productName: string;
    taxCategory?: string;
    /**
     * Caller-forced rate band for this line — names a band only, never a raw
     * rate; the engine still resolves the actual percentage for the line's
     * own jurisdiction from that band. Highest-precedence input to rate-band
     * resolution, checked before commodityCode and taxCategory. Does not
     * affect classification, place-of-supply, or upstream B2B/reverse-charge/
     * exemption logic — those run unconditionally first and are unaffected.
     */
    taxTreatmentOverride?: 'STANDARD' | 'REDUCED' | 'SECOND_REDUCED' | 'SUPER_REDUCED' | 'ZERO' | 'EXEMPT';
    /**
     * Optional tariff/customs classification code for this line (HS, CN, or
     * UK Trade Tariff — no separate scheme field needed; matching is
     * jurisdiction-scoped by the line's own resolved country). Looked up
     * hierarchy-aware (own digit precision, then progressively shorter
     * prefixes). Consulted only when taxTreatmentOverride is absent — a
     * total miss re-enters the ordinary taxCategory/classification cascade
     * exactly as if this field had never been supplied.
     */
    commodityCode?: string;
    amountIncludesTax?: boolean;
  }>;
  vatValidation?: 'full' | 'format' | 'none';
  vatUnverifiableFallback?: 'conservative' | 'permissive';
}

export interface TaxCalculateResponse {
  calculationId: string;
  entityId: string;
  committed: boolean;
  sandbox: boolean;
  degraded: boolean;
  degradedReason?: string;
  currency: string;
  taxTreatment: string;
  taxCode: string;
  jurisdiction: {
    country: string;
    region: string | null;
    method: string;
    precision: string;
  };
  summary: {
    totalAmount: number;
    totalTax: number;
    totalAmountWithTax: number;
  };
  lineItems: Array<{
    id: string;
    taxCode: string;
    rate: number;
    rateBand: string;
    taxableAmount: number;
    taxAmount: number;
    totalAmount: number;
    classification: {
      slug: string;
      confidence: number;
      status: string;
    };
    /**
     * HOW this line's tax category was resolved — the provenance signal
     * alongside `classification`. Always populated when classification data
     * is present, even when taxTreatmentOverride or commodityCode later
     * determined the line's actual rate band (classification runs
     * unconditionally before jurisdiction/rate-band resolution).
     * AI_FALLBACK: no real classification signal existed — confidence
     * carries no real meaning and must never be presented as a percentage.
     */
    classificationSource?: 'EXPLICIT' | 'STRIPE_CODE' | 'CACHED' | 'AI' | 'AI_FALLBACK' | null;
    sourcingRationale?: {
      /** This line's resolved rate band (STANDARD/REDUCED/ZERO/EXEMPT/etc). Always present when sourcingRationale is. */
      rateBand?: string;
      /**
       * Which resolution tier decided `rateBand` above. 'OVERRIDE' confirms
       * taxTreatmentOverride was honoured; 'COMMODITY_CODE' confirms
       * commodityCode matched a row. Any other value means neither field
       * applied and the band came from the ordinary taxCategory-driven
       * chain instead.
       */
      bandTier?: 'OVERRIDE' | 'COMMODITY_CODE' | 'EXPLICIT' | 'COUNTRY' | 'SCOPE_EU' | 'SCOPE_US' | 'SCOPE_GLOBAL' | 'FALLBACK' | 'DEGRADED';
      [key: string]: unknown;
    };
  }>;
}

export interface TaxNumberValidateResponse {
  valid: boolean;
  country: string;
  taxNumber: string;
  name?: string;
  address?: string;
  status: 'VALID' | 'INVALID' | 'UNVERIFIED';
}

export interface CountryRequirements {
  country: string;
  countryName: string;
  eInvoicingMandatory: boolean;
  mandatoryFrom?: string;
  supportedDocumentTypes: Array<{ code: string; name: string }>;
  peppolScheme?: string;
  vatNumberRequired: boolean;
  vatNumberFormat?: string;
  vatNumberRegex?: string;
  authority?: string;
  authorityPortal?: string;
  notes?: string;
}

export type ProductTier = 'CONFIRMED' | 'STANDARD_MAPPING' | 'AI_CLASSIFIED' | 'UNCLASSIFIED';

export interface Product {
  id: string;
  entityId: string;
  name: string;
  sku?: string;
  description?: string;
  taxCategory?: string;
  /** AI classification confidence (0-1). Only populated when tier is 'AI_CLASSIFIED'. */
  confidence?: number | null;
  /** Trust tier derived from the classification source — see ProductTier. */
  tier?: ProductTier;
  /** Ready-to-render display label for `tier`, e.g. "Confirmed". */
  tierLabel?: string;
  /** Ready-to-render description of how/when this product was added, e.g. "Synced from WooCommerce". */
  addedLabel?: string;
  /** Ready-to-render description of who confirmed this classification, or null if unconfirmed. */
  confirmedByLabel?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductInput {
  name: string;
  sku?: string;
  description?: string;
  taxCategory?: string;
  entityId?: string;
}

export interface UpdateProductInput {
  name?: string;
  sku?: string;
  description?: string;
  taxCategory?: string;
}

export interface ListProductsParams {
  entityId?: string;
  limit?: number;
  page?: number;
  /** Sort order. 'newest' (default) = most recently created first. 'name' = A-Z. 'confidence' = highest AI confidence first (unconfirmed/non-AI products sort last). */
  sort?: 'newest' | 'name' | 'confidence';
}

export interface ListProductsResponse {
  products: Product[];
  total: number;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  entityId: string | null;
  active: boolean;
  createdAt: string;
}

export interface CreateWebhookInput {
  url: string;
  events?: string[];
}

export interface CreateWebhookResponse extends Webhook {
  secret: string;
}

export interface ListWebhooksResponse {
  webhooks: Webhook[];
  pagination: { total: number; page: number; limit: number; pages: number; hasNext: boolean; hasPrev: boolean };
}

export interface TaxNumberBatchItem {
  countryCode: string;
  taxNumber: string;
}

export interface TaxNumberBatchResult {
  results: Array<{ index: number; countryCode: string; taxNumber: string; format: { valid: boolean; error?: string }; authority: { checked: boolean; valid?: boolean; name?: string }; error?: string }>;
  total: number;
  valid: number;
  invalid: number;
  errors: number;
  sandbox: boolean;
}

export interface TaxRegistration {
  country: string;
  scheme: string;
  taxNumber: string | null;
  taxType: string | null;
  taxNumberId: string | null;
  obligationId: string | null;
  registrationStatus: string;
  obligationStatus: string | null;
  threshold: { amount: number; currency: string } | null;
  currentPeriodAmount: number | null;
  collectFromDate: string | null;
  collectionStatus: 'COLLECTING' | 'DEFERRED' | 'SETUP_NEEDED' | null;
  canCollectTax: boolean;
}

export interface ListRegistrationsResponse {
  ok: boolean;
  entityId: string;
  entityName: string;
  homeCountry: string;
  iossNumber: string | null;
  taxCalcEnabled: boolean;
  taxCalcSetupRequired: boolean;
  registrations: TaxRegistration[];
}

export interface SetCollectionInput {
  collectFromDate: string | null;
}

export interface SetCollectionResponse {
  ok: boolean;
  collectionStatus: 'COLLECTING' | 'DEFERRED';
  collectFromDate: string;
}

export interface AddRegistrationInput {
  type: 'VAT' | 'IOSS' | 'UNION_OSS' | 'NON_UNION_OSS' | 'VOEC';
  country?: string;
  taxNumber?: string;
  iossNumber?: string;
  entityId?: string;
}

export interface TaxCalculationSummary {
  id: string;
  entityId: string | null;
  jurisdictionCountry: string;
  jurisdictionRegion: string | null;
  transactionType: string;
  totalAmount: number | null;
  totalTax: number | null;
  currency: string | null;
  customerType: string | null;
  merchantRef: string | null;
  degraded: boolean;
  resolvedAt: string;
  createdAt: string;
  sandbox: boolean;
}

export interface ListTaxCalculationsParams {
  entityId?: string;
  country?: string;
  limit?: number;
  page?: number;
}

export interface ListTaxCalculationsResponse {
  calculations: TaxCalculationSummary[];
  pagination: { page: number; limit: number; total: number };
}

export type SiiInvoiceType = 'LFE' | 'LFR';

export type SiiRecordStatus = 'PENDING' | 'VALIDATED' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'ERROR';

export interface SubmitSiiRecordInput {
  invoiceType: SiiInvoiceType;
  invoiceNumber: string;
  invoiceDate: string;
  counterpartyNif?: string | null;
  counterpartyName?: string | null;
  baseAmount: number;
  taxAmount: number;
  totalAmount: number;
  /** Régimen especial / clave key, '01'..'16'. */
  claveRegimen: string;
}

export interface CorrectSiiRecordInput extends SubmitSiiRecordInput {
  /** id of the SII record being corrected. */
  originalRecordId: string;
}

export interface SubmitSiiRecordResponse {
  ok: boolean;
  id: string;
  status: string;
  aeatCsv: string | null;
  reportingDeadline: string;
}

export interface SiiRecord {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceType: SiiInvoiceType;
  counterpartyNif: string | null;
  counterpartyName: string | null;
  baseAmount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  claveRegimen: string;
  status: SiiRecordStatus;
  /** A0 = original submission, A1 = correction. */
  tipoComunicacion: 'A0' | 'A1';
  /** Set only on a correction record — the id of the SII record it corrects. */
  originalRecordId: string | null;
  /** 0 for an original submission, incremented by 1 per correction. */
  correctionSeq: number;
  reportingDeadline: string;
  submittedAt: string | null;
  aeatCsv: string | null;
  aeatStatusCode: string | null;
  aeatErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Full detail for a single SII record. Superset of SiiRecord. */
export interface SiiRecordDetail extends SiiRecord {
  /** Full AEAT error message, present when aeatErrorCode is set. */
  aeatErrorDetail: string | null;
}

export interface ListSiiRecordsParams {
  status?: SiiRecordStatus;
  invoiceType?: SiiInvoiceType;
  /** invoiceDate >= this value, YYYY-MM-DD. */
  dateFrom?: string;
  /** invoiceDate <= this value, YYYY-MM-DD. */
  dateTo?: string;
  page?: number;
  limit?: number;
}

export interface ListSiiRecordsResponse {
  records: SiiRecord[];
  pagination: { total: number; page: number; limit: number; pages: number; hasNext: boolean; hasPrev: boolean };
}

export interface GetSiiRecordResponse {
  record: SiiRecordDetail;
}

// ── Data Query Tool ──────────────────────────────────────────────────────────

export type QueryDataset = 'einvoicing_records' | 'tax_calculations';

export type QueryFilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';

export interface QueryFilter {
  field: string;
  operator: QueryFilterOperator;
  /** Required for every operator except 'in', which uses `values` instead. */
  value?: string | number | boolean;
  /** Only valid with operator 'in'. */
  values?: Array<string | number | boolean>;
}

export interface QueryRequestParams {
  dataset: QueryDataset;
  filters?: QueryFilter[];
  /** Allowlisted field names to return per row. Omit for the dataset's default column set. */
  columns?: string[];
  /** Rows per page. Default 25, max 100. */
  limit?: number;
  /** Inclusive lower bound on the dataset's canonical timestamp field (ISO date or datetime). */
  from?: string;
  /** Inclusive upper bound on the dataset's canonical timestamp field (ISO date or datetime). */
  to?: string;
  /** Opaque keyset cursor from a previous response's nextCursor. */
  cursor?: string;
}

export interface QueryResponse {
  ok: true;
  rows: Array<Record<string, unknown>>;
  hasMore: boolean;
  nextCursor: string | null;
  asOf: string;
}

export interface QueryFieldDefinition {
  field: string;
  type: string;
  operators: QueryFilterOperator[];
  enumValues?: string[];
  indexed: boolean;
  computed?: boolean;
  currencySemantics?: string;
}

export interface QueryDatasetSchema {
  dataset: QueryDataset;
  timestampField: string;
  limits: { defaultPageSize: number; maxPageSize: number; maxSpanDays: number };
  dateSemantics: { field: string; timezone: string; description: string };
  fields: QueryFieldDefinition[];
  defaultColumns: string[];
}

export interface QueryFieldsResponse {
  schemaVersion: string;
  datasets: Record<QueryDataset, QueryDatasetSchema>;
}

export type ClientTaxCodeDirection = 'sale' | 'purchase';

export interface ClientTaxCode {
  id: string;
  entityId: string;
  /** Your own ERP tax code, e.g. "A1". Unique per entity. */
  code: string;
  /** 2- or 3-letter ISO country code. */
  country: string;
  /** Sub-national scope (e.g. a US state), or null for a country-wide code. */
  region: string | null;
  /** EN16931 tax category code: S, AA, AB, AC, AE, K, G, E, O, or Z. */
  taxCode: string;
  /** Optional scope. null (default) means the code applies to both sale and purchase. */
  direction: ClientTaxCodeDirection | null;
  /**
   * Response-only, computed live from country + taxCode (and, for a US row,
   * the region's own state sales tax rate) — never a stored or
   * caller-supplied value. Decimal fraction (0.19 = 19%). null when the rate
   * can't currently be determined.
   */
  rate: number | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateClientTaxCodeInput {
  code: string;
  country: string;
  region?: string;
  taxCode: string;
  direction?: ClientTaxCodeDirection;
  description?: string;
  /** Required for account-scoped keys; omit for entity-scoped keys. */
  entityId?: string;
}

export interface UpdateClientTaxCodeInput {
  code?: string;
  country?: string;
  region?: string;
  taxCode?: string;
  direction?: ClientTaxCodeDirection;
  description?: string;
}

export interface DuplicateTreatmentWarning {
  code: 'DUPLICATE_TREATMENT';
  message: string;
  conflictingCodeId: string;
  conflictingCode: string;
}

export interface ListClientTaxCodesResponse {
  ok: boolean;
  clientTaxCodes: ClientTaxCode[];
}

export interface ClientTaxCodeResponse {
  ok: boolean;
  clientTaxCode: ClientTaxCode;
  /** Present only when another code for this entity already maps to the identical treatment — the write still succeeds. */
  warning?: DuplicateTreatmentWarning;
}

export class ClearvoError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly hint?: string,
    public readonly field?: string
  ) {
    super(message);
    this.name = 'ClearvoError';
  }
}
