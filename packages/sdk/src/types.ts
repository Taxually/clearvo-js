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
  /**
   * clearanceStatus, e.g. PENDING/ACCEPTED/REJECTED/DELIVERED/UNROUTABLE/
   * UNDELIVERED/DUPLICATE, or HELD_UNMAPPED_TAX_CODE — a line/shipping/
   * allowance-charge's clientTaxCode or taxTreatment isn't configured for
   * this entity yet. Never a malformed request: the invoice is accepted
   * and held with a machine-readable reason (see errorCode/message/reason
   * below) rather than rejected. Configure the code and resubmit under a
   * new idempotency key to unblock it.
   */
  status: ClearanceStatus;
  message?: string;
  /** Present only when status is HELD_UNMAPPED_TAX_CODE — the resolver's own error code. */
  errorCode?: string;
  /** Present only when status is HELD_UNMAPPED_TAX_CODE — the machine-readable diagnostic for which code wasn't configured and where to fix it. */
  reason?: UnmappedTaxCodeReason;
  /** Echoed back only when the request set dryRun: true — no record was persisted. */
  dryRun?: boolean;
  /**
   * Per-line tax-code resolution audit trail — one entry per submitted
   * `lines[]`, in original order. Present on every real submission (and on
   * a dryRun: true preview) except a credit note.
   */
  lines?: Array<{ lineNumber: number; taxResolution: LineTaxResolution }>;
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

// ── Submit invoice (POST /v1/send) input ────────────────────────────────────
//
// Hard cut: there is no `taxCode` field anywhere on this input — on a line,
// on `shipping`, or on an allowance/charge. The EN16931/BIS category is
// ALWAYS a resolved OUTPUT (see LineTaxResolution below), never a
// caller-supplied value. Supply `clientTaxCode` (RECOMMENDED — your own ERP
// code, mapped in advance via createClientTaxCode) or a `taxTreatment` hint
// instead — mutually exclusive, at most one per line/shipping/charge.

/**
 * An explicit tax-treatment hint for a line, `shipping`, or an
 * allowance/charge — used only when `clientTaxCode` is omitted, to
 * disambiguate a genuinely 0% line (a bare 0% rate alone is ambiguous
 * between zero-rated/exempt/out-of-scope/reverse-charge).
 *
 * Re-exported from ./generated/openapi-tax-code-contract.js, which is
 * regenerated straight from clearvo-marketing's openapi.json
 * (components.schemas.TaxTreatment) — never hand-edit that file or
 * hardcode this union here; run `node scripts/generate-from-openapi.mjs`
 * at the repo root instead.
 */
export type { TaxTreatment } from './generated/openapi-tax-code-contract.js';
import type { TaxTreatment } from './generated/openapi-tax-code-contract.js';

/**
 * POST /v1/send's clearanceStatus values — same generated source as
 * TaxTreatment above (components.schemas.ClearanceStatus in openapi.json),
 * including HELD_UNMAPPED_TAX_CODE.
 */
export type { ClearanceStatus } from './generated/openapi-tax-code-contract.js';
import type { ClearanceStatus } from './generated/openapi-tax-code-contract.js';

export interface PartyInput {
  name: string;
  taxId?: string;
  taxIdCountry?: string;
  legalRegistrationId?: string;
  address: {
    street?: string;
    street2?: string;
    city: string;
    postalCode?: string;
    countyCode?: string;
    country: string;
  };
  contact?: { name?: string; phone?: string; email?: string };
  endpointId?: string;
  endpointSchemeId?: string;
  /** Buyer only — resolve a previously-saved customer record instead of repeating its fields. */
  customerRef?: string;
}

export interface LineItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
  /** Required unless clientTaxCode is supplied (or resolved from the header-level clientTaxCode). */
  taxRate?: number;
  /**
   * RECOMMENDED. Your own ERP tax code (e.g. a SAP two-digit code),
   * configured in advance via createClientTaxCode. Mutually exclusive with
   * `taxTreatment`. An unrecognised code for this entity is never
   * rejected outright — the invoice is held (status HELD_UNMAPPED_TAX_CODE)
   * with a machine-readable reason instead.
   */
  clientTaxCode?: string;
  /** Mutually exclusive with `clientTaxCode`. See TaxTreatment. */
  taxTreatment?: TaxTreatment;
  /** Per-line override of the invoice-level buyerType, consulted only when this line has no clientTaxCode. */
  buyerType?: 'B2B' | 'B2C';
  /** Consulted only when this line has no clientTaxCode. Defaults to 'goods'. */
  supplyType?: 'goods' | 'digital_service' | 'general_service';
  discount?: number;
  unit?: string;
  itemCode?: string;
}

export interface ShippingInput {
  amount: number;
  carrier?: string;
  trackingNumber?: string;
  /** Same resolution as LineItemInput.clientTaxCode — RECOMMENDED. */
  clientTaxCode?: string;
  /**
   * Same resolution as LineItemInput.taxTreatment. Unlike a line item,
   * shipping with neither this nor clientTaxCode set defaults to
   * zero-rated rather than an error — shipping never drives Compliance
   * Mandate resolution.
   */
  taxTreatment?: TaxTreatment;
}

export interface AllowanceChargeInput {
  /** Absolute amount, always positive — sign is implied by whether this is under `allowances` or `charges`. */
  amount: number;
  reason: string;
  /** Same resolution as LineItemInput.clientTaxCode — RECOMMENDED. */
  clientTaxCode?: string;
  /** Same resolution as LineItemInput.taxTreatment. Same zero-rated-by-default carve-out as ShippingInput.taxTreatment. */
  taxTreatment?: TaxTreatment;
}

export interface SubmitInvoiceInput {
  documentType?: 'invoice' | 'credit_note' | 'debit_note';
  invoiceNumber: string;
  issueDate: string;
  dueDate?: string;
  currency: string;
  country: string;
  taxIncluded?: boolean;
  supplier?: PartyInput;
  buyer: PartyInput;
  /** Optional buyer classification for the whole invoice. Can be overridden per line via lines[].buyerType. */
  buyerType?: 'B2B' | 'B2C';
  lines: LineItemInput[];
  allowances?: AllowanceChargeInput[];
  charges?: AllowanceChargeInput[];
  shipping?: ShippingInput;
  /**
   * RECOMMENDED. Header-level counterpart to lines[].clientTaxCode —
   * applied to every line that supplies neither its own taxTreatment/
   * taxRate nor its own lines[].clientTaxCode; a line's own value always
   * wins.
   */
  clientTaxCode?: string;
  /**
   * Preview the resolved per-line tax decision without creating a record,
   * generating XML, or enqueueing anything to an authority. The response
   * echoes dryRun: true plus `lines[]` (including a would-be
   * HELD_UNMAPPED_TAX_CODE outcome).
   */
  dryRun?: boolean;
  prepaidAmount?: number;
  originalInvoiceRef?: { invoiceNumber: string; issueDate: string };
  correctsInvoiceId?: string;
  customerReference?: string;
  /**
   * ES SII block 3: `{ es: { duaNumber } }` — NumeroDUA, required and only
   * meaningful when a `transactionDirection: 'purchase'` line's tipoFactura
   * resolves to F5 (import). Missing on an import produces NEEDS_INFO naming
   * `countrySpecific.es.duaNumber`.
   */
  countrySpecific?: Record<string, unknown>;
  notifyBuyer?: boolean;
  rejectInsteadOfAutoCorrect?: boolean;
  metadata?: Record<string, string>;
  /**
   * ES SII block 3. Defaults to `'sale'` (this entity's own outbound/issued document —
   * LFE). `'purchase'` records a vendor's document on this entity's received side
   * (LFR) — Spain SII only; every other live country's purchase-direction submission
   * currently resolves to no reporting mandate at all. `supplier` is still required
   * for a purchase and is the VENDOR/counterparty (the entity's own Spanish
   * registration is applied automatically, same derivation as the sale-side
   * `supplier.taxId` rule).
   */
  transactionDirection?: 'sale' | 'purchase';
  /**
   * PURCHASE documents only, Spain SII, YYYY-MM-DD. The accounting-entry date
   * (FechaRegContable) — anchors both the compliance-mandate effective-date gate
   * and the received-book (LFR) submission deadline. Optional even for a purchase
   * (falls back to `issueDate` when omitted), but the vendor's own `issueDate` is
   * legally the wrong date for this gate — supply it whenever the entity books on
   * receipt.
   */
  accountingDate?: string;
  /**
   * PURCHASE documents only, Spain SII. CuotaDeducible — the deductible portion of
   * input VAT on this purchase, always taken as given, never derived from the
   * lines' own charged amounts. An explicit `0` is a valid, distinct declaration
   * (an exempt/non-deductible purchase) — NOT the same as omitting the field, which
   * produces `NEEDS_INFO` naming this field.
   */
  deductibleVatAmount?: number;
  /**
   * Received book only, Spain SII. The VAT declaration period this deduction is
   * actually taken in, when it differs from `accountingDate`'s own month. Optional
   * — omitted, the liquidation period defaults to `accountingDate`'s own month.
   */
  deductionPeriod?: { ejercicio: string; periodo: string };
}

/** Which tier resolved a line: an entity-configured client_tax_codes row, a connector's own system_enum row, or the facts tier (buyer/seller country pair + vatRate, optionally with a taxTreatment hint). */
export type ResolvedBy = 'client_tax_code' | 'source_system_code' | 'facts';

/**
 * The full Tax Decision behind one line's resolution — how the caller's
 * clientTaxCode/taxTreatment/vatRate input became an EN16931/BIS category.
 */
export interface LineTaxResolution {
  resolvedBy: ResolvedBy;
  input: {
    clientTaxCode?: string;
    sourceSystemCode?: { system: string; code: string };
    facts?: {
      buyerCountry: string;
      buyerTaxId?: string;
      buyerType?: 'b2b' | 'b2c';
      supplyType?: 'goods' | 'digital_service' | 'general_service';
      taxTreatment?: string;
    };
  };
  mappingRowId: string | null;
  mappingVersion: number | null;
  category: string;
  exemptionReason: string | null;
  band: string | null;
  rate: number;
}

/**
 * The machine-readable diagnostic returned when a line/shipping/
 * allowance-charge's clientTaxCode or taxTreatment isn't configured for
 * this entity yet — sets status to HELD_UNMAPPED_TAX_CODE rather than
 * rejecting the request.
 */
export interface UnmappedTaxCodeReason {
  source_system: string | null;
  code: string | null;
  country: string | null;
  direction: 'sale' | 'purchase' | null;
  /** Dashboard deep link, pre-filled, for configuring this code. */
  deepLink: string;
}

export interface InvoiceStatusResponse {
  referenceId: string;
  clearanceStatus: ClearanceStatus;
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

// ── Tax Reporting obligations ────────────────────────────────────────────────

/** Customer-toggleable reporting regimes surfaced by GET /tax/reporting-obligations. */
export type ReportingObligationRegime = 'fr_ereporting' | 'es_sii';

/**
 * Any regime code the platform knows — accepted as a key on PATCH (e.g. enabling
 * es_verifactu alongside es_sii), not only the toggleable subset GET surfaces.
 */
export type RegimeCode =
  | ReportingObligationRegime
  | 'es_verifactu' | 'fr_einvoicing' | 'it_einvoicing' | 'pl_einvoicing' | 'sa_einvoicing'
  | 'pt_einvoicing' | 'de_einvoicing' | 'ro_einvoicing' | 'hu_einvoicing' | 'gr_einvoicing'
  | 'my_einvoicing' | 'il_einvoicing' | 'eg_einvoicing' | 'ar_einvoicing' | 'jo_einvoicing'
  | 'peppol_einvoicing';

export type RegimeSubmissionMode = 'immediate' | 'batch_auto' | 'batch_review';

export type RegimeSetupStatus = 'not_started' | 'awaiting_customer' | 'awaiting_authority' | 'ready' | 'blocked';

export interface ReportingObligation {
  obligation: ReportingObligationRegime;
  /** ISO 3166-1 alpha-2 country the regime applies to. */
  country: string;
  /** false when no row exists — never derived, never defaulted on. */
  enabled: boolean;
  /**
   * Whether the entity holds a current STANDARD tax registration in that country.
   * false means an enabling PATCH is refused 400 REGISTRATION_REQUIRED — see
   * `registrationGate` for the fixUrl to send the user to first. Disabling is never gated.
   */
  registered: boolean;
  /** Date the obligation started (or starts) applying; null when never enabled. */
  effectiveFrom: string | null;
  /**
   * es_sii and fr_ereporting allow 'immediate' | 'batch_auto' | 'batch_review'
   * (default 'batch_review' — nothing is filed until a human confirms the batch).
   * Null when never set.
   */
  submissionMode: RegimeSubmissionMode | null;
  /** Ops-maintained setup progress — read-only on the public surface. */
  setupStatus: RegimeSetupStatus | null;
  setupStatusNote: string | null;
  /** Display label for the regime, e.g. "Spain · SII". */
  label: string;
  /** Plain-language description of the regime. */
  help: string;
  /** Modes PATCH accepts for this regime (SUBMISSION_MODE_NOT_ALLOWED otherwise). */
  allowedSubmissionModes: RegimeSubmissionMode[];
  /** Mode a new enable starts on when none is chosen — 'batch_review' for es_sii/fr_ereporting. */
  defaultSubmissionMode: RegimeSubmissionMode | null;
  submissionModeLabel: string | null;
  setupStatusLabel: string | null;
  setupStatusNextStep: string | null;
  setupStatusTone: 'neutral' | 'warning' | 'info' | 'success' | 'danger' | null;
  /** Plain-language facts about this row's current state. */
  notes: string[];
  /**
   * Non-null whenever `registered` is false (regardless of `enabled`): the row cannot be
   * enabled yet. `fixUrl` is an absolute, tenant-aware URL to the Registrations page.
   */
  registrationGate: { message: string; fixUrl: string } | null;
  /**
   * Non-null only when the row is ENABLED but the registration has since lapsed —
   * submissions are held until it is restored. `fixUrl` is a tenant-relative path.
   */
  registrationWarning: { message: string; fixUrl: string } | null;
  /** True when a Spain SII batch is currently OPEN for this regime (see listReportingBatches). */
  openBatch: boolean;
  /** Non-null exactly when openBatch is true — a mode change won't affect the running batch. */
  modeChangeNotice: string | null;
}

export interface ReportingObligationsVocabulary {
  submissionModes: Array<{ code: RegimeSubmissionMode; label: string; description: string }>;
  setupStatuses: Array<{ code: RegimeSetupStatus; label: string; nextStep: string | null; tone: string }>;
}

export interface ListReportingObligationsResponse {
  ok: boolean;
  entityId: string;
  obligations: ReportingObligation[];
  vocabulary: ReportingObligationsVocabulary;
}

/**
 * One value in the PATCH `obligations` map. A bare boolean is shorthand for
 * `{ enabled }` and only ever succeeds for a disable — enabling requires the
 * object form with `effectiveFrom` (EFFECTIVE_FROM_REQUIRED otherwise).
 */
export type ReportingObligationPatch =
  | boolean
  | {
      enabled: boolean;
      /** Required when enabled is true. YYYY-MM-DD. */
      effectiveFrom?: string;
      /**
       * Must be one the regime allows — SUBMISSION_MODE_NOT_ALLOWED otherwise. es_sii and
       * fr_ereporting allow all three; omitted on a first enable, the regime's default
       * ('batch_review') applies. A change never affects a batch that is already open.
       */
      submissionMode?: RegimeSubmissionMode;
    };

export interface UpdateReportingObligationsInput {
  obligations?: Partial<Record<RegimeCode, ReportingObligationPatch>>;
  /** Stamp the entity's tax-reporting confirmation, even when obligations is empty. */
  confirm?: boolean;
  /**
   * Disable es_sii even though a reporting batch still needs attention (bypasses the
   * 409 OBLIGATION_HAS_PENDING_BATCH). The batch is left completely untouched.
   */
  force?: boolean;
}

/**
 * 400 body when enabling fr_ereporting/es_sii for a country the entity has no current
 * registration in. `fixUrl` deep-links to the Registrations page for `country`.
 */
export interface RegistrationRequiredError {
  ok: false;
  code: 'REGISTRATION_REQUIRED';
  message: string;
  country: string;
  entityId: string;
  fixUrl: string;
}

/** 409 body when disabling es_sii while a batch is open / ready_for_review / overdue. */
export interface ObligationHasPendingBatchError {
  ok: false;
  code: 'OBLIGATION_HAS_PENDING_BATCH';
  error: string;
  message: string;
  batchIds: string[];
  reportByDates: (string | null)[];
  fixUrl: string;
}

/**
 * 422 body from POST /send when a caller-supplied supplier.taxId differs from the entity's
 * own registration for the resolved mandate's country (every regime). Omit supplier.taxId to
 * have the registered value applied automatically.
 */
export interface SupplierTaxIdMismatchError {
  ok: false;
  code: 'SUPPLIER_TAX_ID_MISMATCH';
  message: string;
  country: string;
  entityId: string;
  fixUrl: string;
  mandateCountry: string;
  registeredTaxId: string;
  suppliedTaxId: string;
}

export interface UpdateReportingObligationsResponse {
  ok: boolean;
  entityId: string;
  /** Regime code -> enabled, for every regime this request touched. */
  obligations: Record<string, boolean>;
  /** Present only when a non-blocking warning applies — today only SII_EXEMPTS_VERIFACTU. */
  warnings?: Array<{ code: 'SII_EXEMPTS_VERIFACTU' | string; message: string }>;
}

// ── Spain SII reporting batches ──────────────────────────────────────────────

export type ReportingBatchStatus = 'open' | 'closed' | 'ready_for_review' | 'submitted' | 'filed';
export type ReportingBatchSubmissionMode = 'batch_auto' | 'batch_review';
export type SiiBook = 'issued' | 'received';
/** AEAT per-record estado, PENDING before submission, or EXCLUDED for a record moved out of this batch. */
export type ReportingBatchRecordState = 'PENDING' | 'Correcto' | 'AceptadoConErrores' | 'Incorrecto' | 'EXCLUDED';

export interface ReportingBatch {
  /** Batch UUID — the path parameter for getReportingBatch/confirm/exclude. */
  id: string;
  /** Human-readable batch key — the `batchId` POST /send returns and the reporting_batch.* webhooks carry. */
  batchId: string;
  entityId: string;
  country: string;
  obligation: string;
  book: SiiBook | null;
  status: ReportingBatchStatus;
  statusLabel: string;
  /** Fixed for the life of the batch — a later obligation change applies from the next batch. */
  submissionMode: ReportingBatchSubmissionMode | string | null;
  submissionModeLabel: string | null;
  periodStart: string | null;
  /** The batch's filing deadline — same value as reportBy. */
  periodEnd: string | null;
  /** Earliest AEAT report-by date across the batch's records. */
  reportBy: string | null;
  /** Server-computed "N Spanish business day(s) overdue"; null when not overdue. */
  overdueLabel: string | null;
  recordCount: number;
  submittedLate: boolean;
  closedAt: string | null;
  submittedAt: string | null;
  filedAt: string | null;
  readyAt: string | null;
  createdAt: string;
}

export interface ReportingBatchRecordWarning {
  ruleCode: string;
  fieldPath: string;
  errorCode: string;
  suggestedAction: string;
  checkFamily: string;
  legalBasisTag: string;
  fixUrl: string | null;
  createdAt: string;
}

export interface ReportingBatchRecord {
  /** Mandate transaction id — the `transactionId` for excludeFromReportingBatch. */
  id: string;
  /** Invoice record id (getInvoice), when linked. */
  recordId: string | null;
  invoiceNumber: string | null;
  counterpartyNif: string | null;
  /** AEAT TipoFactura (F1, F2, R1–R5, …). */
  tipo: string | null;
  tipoLabel: string | null;
  book: SiiBook | null;
  base: number | null;
  cuota: number | null;
  classification: { code: string | null; label: string | null };
  warnings: ReportingBatchRecordWarning[];
  reportBy: string | null;
  isLate: boolean;
  isRectification: boolean;
  overdueLabel: string | null;
  aeatOutcome: { estado: ReportingBatchRecordState | string; code: string | null; text: string | null };
  excludedBy: { reason: string; actor: string | null; at: string; movedToPeriodId: string | null } | null;
}

export interface ReportingBatchDetail extends ReportingBatch {
  reviewedBy: string | null;
  reviewedAt: string | null;
  /** Optimistic-concurrency token — echo it on confirmReportingBatch (409 BATCH_STALE otherwise). */
  snapshotVersion: number;
  snapshotHash: string | null;
  records: ReportingBatchRecord[];
}

export interface ReportingBatchVocabulary {
  periodStatuses: Record<string, { label: string; description: string }>;
  recordStates: Record<string, { label: string; description: string }>;
  submissionModes: Array<{ code: ReportingBatchSubmissionMode; label: string }>;
  books: Record<string, string>;
  tipoFactura: Record<string, string>;
  claveRegimen: { issued: Record<string, string>; received: Record<string, string> };
}

export interface ListReportingBatchesParams {
  status?: ReportingBatchStatus;
  /** Organisation-scoped keys only; must be a UUID (400 otherwise). */
  entityId?: string;
  page?: number;
  /** 1–200, default 50. */
  limit?: number;
}

export interface ListReportingBatchesResponse {
  ok: true;
  batches: ReportingBatch[];
  pagination: { total: number; page: number; limit: number; pages: number; hasNext: boolean; hasPrev: boolean };
  vocabulary: ReportingBatchVocabulary;
}

export interface GetReportingBatchResponse {
  ok: true;
  batch: ReportingBatchDetail;
  vocabulary: ReportingBatchVocabulary;
}

export interface ConfirmReportingBatchInput {
  /** The batch's CURRENT snapshotVersion from getReportingBatch(). */
  snapshotVersion: number;
}

export interface ConfirmReportingBatchResponse {
  ok: true;
  /** Present and true when the batch had already been confirmed — idempotent no-op. */
  alreadyConfirmed?: true;
  batch: { id: string; status: ReportingBatchStatus; enqueued?: boolean };
}

export interface ExcludeFromReportingBatchInput {
  /** A `records[].id` from getReportingBatch(). */
  transactionId: string;
  /** Required, non-empty — written to the audit trail. */
  reason: string;
}

export interface ExcludeFromReportingBatchResponse {
  ok: true;
  /** The batch the record now belongs to. */
  movedToPeriodId: string;
  /** The SOURCE batch's recomputed report-by deadline. */
  reportBy: string | null;
}

export interface RunReportingBatchSweepInput {
  /** YYYY-MM-DD; defaults to the entity's earliest open batch report-by date. */
  today?: string;
  /** YYYY-MM-DD Europe/Madrid clock; defaults the same way as today. */
  madridToday?: string;
}

export interface RunReportingBatchSweepResponse {
  ok: true;
  today: string | null;
  madridToday: string | null;
  closeSweep: Record<string, unknown>;
  scheduler: Record<string, unknown>;
  batchNotify: Record<string, unknown>;
}

// ── Spain SII block 3: amend (A1) / cancel (Baja) / Consulta reconciliation ─

/**
 * Identical shape to SubmitInvoiceInput (the full corrected invoice) — an amendment
 * corrects CONTENT of an already-registered registro, so `invoiceNumber`/`issueDate`
 * must exactly match the original registro; it is never a rectificativa and never
 * changes the invoice number.
 */
export type AmendReportInput = SubmitInvoiceInput;

export interface AmendReportResponse {
  ok: true;
  /** The SAME record id as the original A0 — an amendment never creates a new record. */
  id: string;
  operation: 'A1';
  /** The new AEAT communication ledger row id — distinct per attempt, so a full A0→A1→A1 history is always reconstructible. */
  communicationId: string;
  /** The communication's own lifecycle state (e.g. PENDING until AEAT's real answer comes back). */
  state: string;
  /** true only when this response is a same-idempotency-key replay of an already-recorded attempt, not a fresh one. */
  idempotentReplay?: boolean;
}

export interface CancelReportInput {
  /** Optional free text (<=100 chars) — recorded for audit, never sent to AEAT (Baja's own envelope is identity-only). */
  reason?: string;
}

/** POST /v1/invoices/{id}/cancel-report's 200 — either a fresh Baja was filed, or the invoice was already cancelled (idempotent no-op, no error). */
export type CancelReportResponse =
  | { ok: true; id: string; operation: 'BAJA'; communicationId: string; state: string; idempotentReplay?: boolean }
  | { ok: true; id: string; cancelled: true; cancelledAt: string };

export interface SiiAuthorityView {
  ranAt: string;
  /** The sandbox tier this run executed under — mock/prewww1/prod. */
  tier: string;
  /** Count of registros AEAT's own Consulta returned for this (book, ejercicio, periodo). */
  aeatCount: number;
  /** Count of this platform's own locally-registered registros for the same scope. */
  localCount: number;
  /** Count where AEAT's own state (including an Anulada observed via Consulta) was adopted locally. */
  adopted: number;
  /** Count registered locally as accepted but absent from AEAT's own Consulta response — a platform-fault alert condition, never silently ignored. */
  missingAtAeat: number;
  /** Count where AEAT's own estado disagrees with what this platform has stored. */
  mismatchedEstado: number;
  /** Number of Consulta result pages the sweep paged through. */
  pageCount: number;
  /** Non-null only when the run itself failed partway through. */
  error: string | null;
}

export interface SiiReconciliationRun extends SiiAuthorityView {
  id: string;
  entityId: string;
  book: SiiBook;
  /** 4-digit year. */
  ejercicio: string;
  /** 2-digit month. */
  periodo: string;
}

export interface GetSiiReconciliationSummaryResponse {
  ok: true;
  /** Null only when the Consulta sweep has never run for this entity. */
  id: string | null;
  authorityView: {
    status: 'never_checked' | 'matched' | 'mismatch';
    lastCheckedAt: string | null;
    matchedCount: number;
    mismatchCount: number;
  };
}

export interface GetSiiReconciliationResponse {
  ok: true;
  run: SiiReconciliationRun;
  /** The SAME run's counters restructured under a name that reads as authority-observed fact — "what AEAT's own Consulta showed us". */
  authorityView: SiiAuthorityView;
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

// A client tax code maps your own ERP tax code (e.g. a SAP two-digit code)
// to the Tax Decision it represents. The EN16931 taxCode and rate are always
// computed live from the fields below — never stored or caller-supplied.
export type ClientTaxCodeMovement = 'local' | 'intra_community' | 'export' | 'distance_sale' | 'import' | 'own_goods_movement';
export type ClientTaxCodeTaxability = 'taxable' | 'exempt' | 'out_of_scope';
export type ClientTaxCodeCustomerType = 'b2b' | 'b2c';
export type ClientTaxCodeSupplyType = 'goods' | 'digital_service' | 'general_service';
export type ClientTaxCodeRateBand = 'standard' | 'reduced' | 'second_reduced' | 'super_reduced' | 'zero';
export type ClientTaxCodeFilingTag =
  | 'cash_accounting_settled' | 'cash_accounting_unsettled' | 'split_payment' | 'statement_of_intent'
  | 'withholding' | 'bad_debt_adjustment' | 'triangular_party_b' | 'triangular_party_c';

export interface ClientTaxCode {
  id: string;
  entityId: string;
  /** Your own ERP tax code, e.g. "A1". Unique per entity. */
  code: string;
  /** 2- or 3-letter ISO country code. */
  country: string;
  /** Sub-national scope (e.g. a US state), or null for a country-wide code. */
  region: string | null;
  movement: ClientTaxCodeMovement;
  taxability: ClientTaxCodeTaxability;
  /** Null means this code applies to either b2b or b2c. */
  customerType: ClientTaxCodeCustomerType | null;
  supplyType: ClientTaxCodeSupplyType;
  /** Only meaningful when taxability=taxable and the movement/reverseCharge combination doesn't already fix the EN16931 code. */
  rateBand: ClientTaxCodeRateBand | null;
  reverseCharge: boolean;
  useTaxSelfAssessed: boolean;
  /** Pure metadata for a future Taxsure integration — never consumed by any computation. */
  filingTag: ClientTaxCodeFilingTag | null;
  /** Optional scope. null (default) means the code applies to both sale and purchase. */
  direction: ClientTaxCodeDirection | null;
  /** EN16931 tax category code: S, AA, AB, AC, AE, K, G, E, O, or Z. Response-only, computed live from the fields above — never a stored or caller-supplied value. */
  taxCode: string;
  /**
   * Response-only, computed live from country + the derived taxCode (and,
   * for a US row, the region's own state sales tax rate) — never a stored or
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
  movement: ClientTaxCodeMovement;
  taxability: ClientTaxCodeTaxability;
  /** Omit for a code that applies to either b2b or b2c. */
  customerType?: ClientTaxCodeCustomerType;
  supplyType: ClientTaxCodeSupplyType;
  /** Required when taxability=taxable and the movement/reverseCharge combination doesn't already fix the EN16931 code. */
  rateBand?: ClientTaxCodeRateBand;
  /** Defaults to false. Independent of movement. */
  reverseCharge?: boolean;
  /** Defaults to false. */
  useTaxSelfAssessed?: boolean;
  filingTag?: ClientTaxCodeFilingTag;
  direction?: ClientTaxCodeDirection;
  description?: string;
  /** Required for account-scoped keys; omit for entity-scoped keys. */
  entityId?: string;
}

/** Any subset of CreateClientTaxCodeInput's fields (minus entityId) — omitted fields keep their current value. */
export type UpdateClientTaxCodeInput = Partial<Omit<CreateClientTaxCodeInput, 'entityId'>>;

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

// ── GET /v1/tax/codes — canonical tax-code catalogue ────────────────────────
// Every tax-code row this platform knows about (Clearvo's own system_enum/
// fact content) plus this caller's own client_tax_codes rows, folded into
// one shape (vocabulary='client'). Use to validate a clientTaxCode/
// taxTreatment value before calling submitInvoice, or to build a picker.

export type TaxCodeVocabulary = 'system_enum' | 'fact' | 'client' | 'tax_calc';

export interface ListTaxCodesParams {
  /** Substring match against `code`, case-insensitive. */
  code?: string;
  /** Omit to list every vocabulary. */
  vocabulary?: TaxCodeVocabulary;
  /** ISO 3166-1 alpha-2 — narrows to this country's rows. */
  country?: string;
  /** e.g. 'xero' — narrows to one connector's system_enum rows; never matches a client row. */
  sourceSystem?: string;
  /** YYYY-MM-DD — resolves each row's live rate as of this date. Defaults to now. */
  date?: string;
  entityId?: string;
}

export interface CanonicalTaxCodeRow {
  id: string;
  vocabulary: TaxCodeVocabulary;
  country: string;
  region: string | null;
  sourceSystem: string | null;
  code: string;
  movement: string;
  taxability: string;
  customerType: string | null;
  supplyType: string;
  rateBand: string | null;
  reverseCharge: boolean;
  label: string | null;
  description: string | null;
  /** Live-resolved rate as a percent (23 = 23%) — null when this platform can't currently price this row's jurisdiction/date. */
  ratePercent: number | null;
  outputPerFormat: Array<{
    format: 'PEPPOL' | 'IT' | 'PL';
    category: string | null;
    exemptionReasonCode: string | null;
    hold: boolean;
  }> | null;
}

export interface ListTaxCodesResponse {
  ok: boolean;
  codes: CanonicalTaxCodeRow[];
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
