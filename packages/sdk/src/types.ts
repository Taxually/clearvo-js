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
    iossNumber?: string;
  };
  shipFrom?: { country: string };
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
