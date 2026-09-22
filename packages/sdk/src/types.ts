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
  /** Mexico only. Defaults to 'sat_pull' for every entity — meaningless (but always present) for a non-MX entity. */
  mxIngestionMode?: 'sat_pull' | 'client_push';
  /** Mexico only. ISO date (YYYY-MM-DD), or null if unset. */
  mxIngestionStartDate?: string | null;
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
  /** Default for SubmitInvoiceInput.notifyCustomer — applies whenever a send omits its own override. */
  notifyCustomerByDefault?: boolean;
  /**
   * Mexico only. 'sat_pull' (default) requires an e.firma/CSD on file first (POST /mx/credentials —
   * not yet wrapped by this SDK) or the update is rejected with MX_CREDENTIALS_REQUIRED.
   * 'client_push' needs no credential — the entity's own AP/ERP system pushes CFDI XML directly.
   */
  mxIngestionMode?: 'sat_pull' | 'client_push';
  /** Mexico only. ISO date (YYYY-MM-DD) or null — earliest CFDI issue date the SAT-pull poller's rolling lookback window considers. */
  mxIngestionStartDate?: string | null;
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
   * Outcome of the customer invoice notification feature — only present for
   * countries where no authority network delivers the invoice to the customer
   * (Spain, Portugal, France, Germany always; Italy B2C).
   */
  customerNotification?: {
    status: 'SENT' | 'SKIPPED' | 'FAILED';
    reason?: 'NOT_APPLICABLE' | 'NOT_OPTED_IN' | 'MISSING_CUSTOMER_EMAIL' | 'NOTIFICATIONS_NOT_CONFIGURED';
    error?: string;
  };
}

// ── Submit invoice (POST /v1/send) input ────────────────────────────────────
//
// Hard cut: there is no `taxCode` field anywhere on this input — on a line,
// on `shipping`, or on an allowance/charge. The EN16931/BIS category is
// ALWAYS a resolved OUTPUT (see LineTaxResolution below), never a
// caller-supplied value. Supply `clientTaxCode` (RECOMMENDED — your own ERP
// code, mapped in advance via createClientTaxCode) or an AUTHORITATIVE
// `taxTreatment` instead — mutually exclusive, at most one per line/shipping/charge.

/**
 * An explicit, AUTHORITATIVE tax treatment for a line, `shipping`, or an
 * allowance/charge — used when `clientTaxCode` is omitted. The stated
 * treatment is mapped as-is, never overridden by country inference. A
 * positive rate with no treatment maps to a domestic taxable supply at that
 * rate (the client's rate is authoritative, never rejected as unrecognised);
 * a bare 0% with no treatment is rejected with 400 ZERO_RATE_NEEDS_TAX_TREATMENT
 * (state exempt/zero_rated/reverse_charge, or a clientTaxCode) — never guessed.
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
  /** Customer only — resolve a previously-saved customer record instead of repeating its fields. */
  customerRef?: string;
}

export interface LineItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
  /**
   * Tax rate as a percentage, 0–100 (e.g. 22 for 22%) — VAT, GST or sales
   * tax alike. ALWAYS required, even when clientTaxCode is supplied: a
   * missing or out-of-range value is a 400 naming this field. A positive
   * rate with no clientTaxCode/taxTreatment is reported as a domestic
   * taxable supply at that rate; a 0% rate with neither is rejected with
   * 400 ZERO_RATE_NEEDS_TAX_TREATMENT. The retired `vatRate` name is
   * rejected with 422 UNKNOWN_FIELD_VAT_RENAMED — there is no silent alias.
   */
  taxRate: number;
  /**
   * Optional tax amount for this line; computed as taxRate × line total
   * when omitted. The retired `vatAmount` name is rejected by the API with
   * 422 UNKNOWN_FIELD_VAT_RENAMED.
   */
  taxAmount?: number;
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
  /** Per-line override of the invoice-level customerType, consulted only when this line has no clientTaxCode. */
  customerType?: 'B2B' | 'B2C';
  /** Consulted only when this line has no clientTaxCode. Defaults to 'goods'. */
  supplyType?: 'goods' | 'digital_service' | 'general_service';
  /**
   * Optional 1-based position of this line on the invoice. Defaults to the
   * line's index in `lines[]` when omitted.
   */
  lineNumber?: number;
  /**
   * Line discount as a percentage (0–100). Mutually exclusive with
   * `discountAmount` — set at most one. Replaces the retired `discount`
   * (rejected by the API with 422 UNKNOWN_FIELD_LINE_RENAMED).
   */
  discountPercent?: number;
  /**
   * Line discount as an absolute amount in the invoice currency, always
   * positive. Mutually exclusive with `discountPercent` — set at most one.
   */
  discountAmount?: number;
  /** UN/ECE Recommendation 20 unit-of-measure code (e.g. "EA", "HUR", "KGM"). Replaces the retired `unit` (422 UNKNOWN_FIELD_LINE_RENAMED). */
  unitOfMeasure?: string;
  /** Your own item identifier / SKU for this line (EN16931 BT-155). Replaces the retired `itemCode` (422 UNKNOWN_FIELD_LINE_RENAMED). */
  sellerItemId?: string;
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
  customer: PartyInput;
  /** Optional customer classification for the whole invoice. Can be overridden per line via lines[].customerType. */
  customerType?: 'B2B' | 'B2C';
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
  /**
   * Id (from a prior submit response) of the invoice this submission corrects
   * — either a fiscal credit/debit note reversing it, or a plain resubmission
   * re-attempting it. As of 2026-09-14, a REJECTED, UNROUTABLE, or NEEDS_INFO
   * invoice can all be corrected this way (previously only REJECTED/
   * UNROUTABLE could) — a NEEDS_INFO record is no longer a dead end. Submit
   * under a fresh idempotency key alongside this field.
   */
  correctsInvoiceId?: string;
  customerReference?: string;
  /**
   * Country-specific fields, keyed by lowercase ISO country code. Known keys:
   * - `es.duaNumber` — NumeroDUA (Documento Único Administrativo), required
   *   and only meaningful when a `transactionDirection: 'purchase'` line's
   *   tipoFactura resolves to F5 (import). Missing on an import produces
   *   NEEDS_INFO naming `countrySpecific.es.duaNumber`.
   * - `hu.exchangeRate` — exchange rate to HUF for this invoice date.
   *   Required whenever `currency` is not HUF.
   * - `hu.invoiceAppearance` — one of PAPER/ELECTRONIC/EDI/UNKNOWN, overriding
   *   the default appearance (PAPER for a resolved PRIVATE_PERSON customer,
   *   ELECTRONIC otherwise).
   * - `de.invoiceFormat` — per-request override of ZUGFERD vs. XRECHNUNG.
   * - `de.leitwegId` — BT-10 German public-sector routing ID (XRechnung
   *   only); falls back to the top-level `buyerReference` when omitted.
   */
  countrySpecific?: Record<string, unknown>;
  notifyCustomer?: boolean;
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

/** Which tier resolved a line: an entity-configured client_tax_codes row, a connector's own system_enum row, or the facts tier. The facts tier is MAP-ONLY: an AUTHORITATIVE taxTreatment is mapped as-is, a positive taxRate with no treatment becomes a domestic taxable supply at that rate, and a bare 0% with no treatment is rejected with 400 ZERO_RATE_NEEDS_TAX_TREATMENT — movement is never inferred from the customer/seller countries. */
export type ResolvedBy = 'client_tax_code' | 'source_system_code' | 'facts';

/**
 * The full Tax Decision behind one line's resolution — how the caller's
 * clientTaxCode/taxTreatment/taxRate input became an EN16931/BIS category.
 */
export interface LineTaxResolution {
  resolvedBy: ResolvedBy;
  input: {
    clientTaxCode?: string;
    sourceSystemCode?: { system: string; code: string };
    facts?: {
      customerCountry: string;
      customerTaxId?: string;
      customerType?: 'b2b' | 'b2c';
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
  /** ISO 8601 timestamp — only invoices whose Clearvo-side created_at is strictly after this. A monotonic ingestion cursor, distinct from issueDate; most relevant for Mexico CFDIs given SAT's own multi-day publishing lag. */
  receivedAfter?: string;
}

export interface ListInvoicesResponse {
  invoices: unknown[];
  total: number;
  nextCursor: string | null;
  prevCursor: string | null;
}

/**
 * A `supplier`/`customer` party on a TaxCalculateRequest. Only `taxId` and
 * `billingAddress.country` are meaningful for a `supplier` party — `name`/
 * `b2bOverride`/`exemptionRef`/`shippingAddress` are accepted but ignored
 * there (those matter only for a `customer` party on a `sale`).
 */
export interface TaxCalcPartyInput {
  /** Free-text display name. Optional and unused for tax determination. */
  name?: string;
  /**
   * Force B2B treatment regardless of VAT verification result. Meaningful
   * only for `customer`; accepted but ignored on `supplier`.
   */
  b2bOverride?: boolean;
  /** This party's VAT/tax ID. */
  taxId?: string;
  /**
   * Reference to an exemption certificate stored in Clearvo ECM (the
   * `certificate_ref`, not the party's tax ID). Meaningful only for
   * `customer` on a `sale`; accepted but ignored on `supplier`.
   */
  exemptionRef?: string;
  /**
   * Your own reference for this party. `supplier.ref` (on a `purchase`)
   * resolves saved supplier master data (see `listSuppliers`/
   * `createSupplier` etc.) — the vendor's name/taxId/address are filled
   * in from the stored record, and any fields you also supply directly
   * take precedence over it. An unknown `supplier.ref` is rejected with
   * 422 `SUPPLIER_REF_NOT_FOUND` rather than silently falling through.
   *
   * `customer.ref` (on a `sale`) does NOT resolve customer master data —
   * it does not fill in name/taxId/address the way `supplier.ref` does.
   * Its only effect is auto-applying a US exemption certificate: when the
   * transaction's jurisdiction is the US and this entity uses Exemption
   * Certificate Management (ECM), Clearvo looks up an active certificate
   * on file for this `ref` and applies it. Elsewhere, or with no matching
   * certificate, `customer.ref` has no effect on the calculation.
   */
  ref?: string;
  billingAddress?: { country: string; region?: string; postalCode?: string };
  /** Meaningful only for `customer`; accepted but ignored on `supplier`. */
  shippingAddress?: { country: string; region?: string; postalCode?: string };
}

/**
 * `supplier` and `customer` are both optional, direction-aware party
 * fields — the counterparty for the resolved `transactionDirection` is
 * required, the entity side is optional (auto-enriched from your entity's
 * own master data, or validated against it if you supply it).
 *
 * **Direction rule** (`transactionDirection`, default `'sale'`):
 * - `'sale'` — an outgoing transaction: the entity is the `supplier`, and
 *   the counterparty goes in `customer`, which is REQUIRED (422
 *   `CUSTOMER_REQUIRED` if omitted). `supplier` is OPTIONAL — omit it and
 *   Clearvo auto-fills it from your entity's own master data; supply it
 *   and it must be one of the entity's registered tax IDs (any country),
 *   rejecting a mismatch with 422
 *   `SUPPLIER_TAX_ID_MISMATCH` (the registered value is never silently
 *   substituted). `seller` is accepted as a deprecated alias for
 *   `supplier` on a sale only.
 * - `'purchase'` — an incoming, input-tax transaction: party roles
 *   invert. The entity is the `customer` (buyer) and the counterparty is
 *   the `supplier` (vendor), which is REQUIRED (422 `SUPPLIER_REQUIRED`
 *   if omitted). `customer` is now OPTIONAL and entity-side — omit it and
 *   Clearvo auto-fills it from your entity's own master data; supply it
 *   and it is validated the same way, rejecting a mismatch with 422
 *   `CUSTOMER_TAX_ID_MISMATCH`. `seller` has no meaning on a purchase and
 *   is rejected outright with 422 `SELLER_ALIAS_NOT_ALLOWED_FOR_PURCHASE`
 *   — use `supplier`, which already means the vendor.
 *
 * The response's top-level `entityRole` (`'supplier'` for a sale,
 * `'customer'` for a purchase) tells you which response party block is
 * your own entity.
 */
export interface TaxCalculateRequest {
  currency: string;
  commit?: boolean;
  idempotencyKey?: string;
  /**
   * `'sale'` (default) — an outgoing transaction: the entity is the
   * supplier and `customer` (the counterparty) is required. `'purchase'`
   * — an incoming transaction: the entity is the customer and `supplier`
   * (the counterparty) is required. See this interface's own doc comment
   * for the full direction rule.
   */
  transactionDirection?: 'sale' | 'purchase';
  /**
   * @deprecated Use `supplier` instead. Deprecated alias for `supplier`
   * on a `transactionDirection: 'sale'` calculation only — normalised to
   * `supplier` before validation runs. Rejected with 422
   * `SELLER_ALIAS_NOT_ALLOWED_FOR_PURCHASE` when sent alongside
   * `transactionDirection: 'purchase'` (there is no sensible mapping —
   * use `supplier` there, which already means the vendor).
   */
  seller?: {
    address: { country: string };
    taxId?: string;
  };
  /**
   * The supplier party. Required when `transactionDirection` is
   * `'purchase'` — the actual vendor on the purchase invoice (422
   * `SUPPLIER_REQUIRED` if missing). Optional when `transactionDirection`
   * is `'sale'` or omitted — there it is the entity side, auto-enriched
   * from your entity's own master data when omitted; if supplied, it
   * must be one of the entity's registered tax IDs (any country) (422
   * `SUPPLIER_TAX_ID_MISMATCH` on a mismatch).
   */
  supplier?: TaxCalcPartyInput;
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
  /**
   * The customer party. Required when `transactionDirection` is `'sale'`
   * or omitted — the counterparty on a sale (422 `CUSTOMER_REQUIRED` if
   * missing). Optional when `transactionDirection` is `'purchase'` —
   * there it is the entity side, auto-enriched from your entity's own
   * master data when omitted; if supplied, it must be one of the
   * entity's registered tax IDs (any country) (422
   * `CUSTOMER_TAX_ID_MISMATCH` on a mismatch).
   *
   * B2B/B2C is inferred from `taxId` (present + verified = B2B) rather
   * than declared with an explicit `type` field — use `b2bOverride` to
   * force B2B treatment when you know the buyer is a business but don't
   * have their VAT ID at checkout time.
   */
  customer?: TaxCalcPartyInput;
  evidence?: {
    ipAddress?: string;
    binCountry?: string;
  };
  lineItems: Array<{
    id: string;
    /**
     * Line total in the transaction currency. Supply EITHER `amount` OR
     * `unitPrice` together with `quantity` — never both forms, and never
     * neither (the API rejects both cases). When you supply `unitPrice`
     * instead, the engine derives `amount = round2(unitPrice * quantity)` and
     * taxes that.
     */
    amount?: number;
    /**
     * Per-unit price in the transaction currency — the alternative to
     * supplying `amount` directly. When present, `quantity` is REQUIRED and
     * the line total is computed once as `round2(unitPrice * quantity)` and
     * taxed as `amount`, so you do not pre-multiply and absorb per-unit
     * rounding error. Mutually exclusive with `amount`; a `unitPrice` with no
     * `quantity` is rejected (never silently assumed to be 1). Non-negative.
     */
    unitPrice?: number;
    /**
     * Number of units. REQUIRED when `unitPrice` is supplied (the two together
     * define the line total); otherwise informational only — when `amount` is
     * supplied directly, quantity is not consumed by the engine. Non-negative.
     */
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
    /**
     * When true, the customer claims exemption for this line item with no
     * ECM certificate on file yet. A real certificate — matched via a
     * direct certificate reference, or auto-looked-up by `customer.ref` —
     * always takes precedence when one covers the line; this only fires
     * when none does.
     */
    exempt?: boolean;
    /**
     * Self-asserted reason for THIS line's exempt claim — only meaningful
     * alongside `exempt: true` on this SAME line; supplying it without
     * `exempt: true` on that line returns a 422. Different lines in one
     * request may carry different reasons. Omit while `exempt: true` to
     * default to `'BLANKET_OTHER'`. Echoed back on the response line item's
     * own `exemptionReason` field.
     */
    exemptionReason?: 'RESALE' | 'MANUFACTURING' | 'AGRICULTURAL' | 'ENERGY' | 'EXEMPT_ORG' | 'GOVERNMENT' | 'DIRECT_PAY' | 'BLANKET_OTHER';
  }>;
  vatValidation?: 'full' | 'format' | 'none';
  vatUnverifiableFallback?: 'conservative' | 'permissive';
}

/**
 * One resolved party (`supplier` or `customer`) on a TaxCalculateResponse.
 * The entity-side block never carries validation fields; the counterparty
 * block additionally carries `b2bOverride`/`taxIdValidated`/
 * `taxIdValidationStatus`. See `TaxCalculateResponse.entityRole` for which
 * block is which.
 */
export interface TaxCalcParty {
  /** This party's resolved country. */
  country: string | null;
  /** State/region code, when resolved (e.g. a US party). Omitted, not null, when absent. */
  region?: string;
  /** Omitted, not null, when absent. */
  postalCode?: string;
  /** This party's tax/VAT ID, when known. Omitted, not null, when absent. */
  taxId?: string;
  /**
   * True when this block is your own entity (auto-enriched from master
   * data, or matched against it if you supplied it); false when it is the
   * counterparty.
   */
  isEntity: boolean;
  /** Present only on the counterparty block. Echoes the request's `b2bOverride`, if supplied. */
  b2bOverride?: boolean;
  /** Present only on the counterparty block. True when the supplied `taxId` passed live-authority (e.g. VIES) verification. */
  taxIdValidated?: boolean;
  /** Present only on the counterparty block. Outcome of taxId verification, e.g. VALID, INVALID, UNVERIFIED, SKIPPED. */
  taxIdValidationStatus?: string;
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
  /**
   * The supplier party for this calculation. On a `'sale'` this is your
   * own entity (`isEntity: true`, no validation fields). On a
   * `'purchase'` this is the counterparty — the vendor (`isEntity: false`,
   * with `b2bOverride`/`taxIdValidated`/`taxIdValidationStatus`). See
   * `entityRole`.
   */
  supplier: TaxCalcParty;
  /**
   * The customer party for this calculation. On a `'sale'` this is the
   * counterparty — the buyer (`isEntity: false`, with
   * `b2bOverride`/`taxIdValidated`/`taxIdValidationStatus`). On a
   * `'purchase'` this is your own entity (`isEntity: true`, no validation
   * fields). See `entityRole`.
   */
  customer: TaxCalcParty;
  /**
   * Which of the two party blocks above is your own entity — `'supplier'`
   * for a `'sale'`, `'customer'` for a `'purchase'`. The other block is
   * the counterparty.
   */
  entityRole: 'supplier' | 'customer';
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
    /**
     * US only: this line's tax broken out per taxing authority (state / county
     * / district / city / local), summing to this line's `taxAmount`. Surfaces
     * the same per-authority split the engine persists and reports at the
     * transaction level, so a filing/reconciliation integrator can see and
     * file each authority's share. Present only when this line was taxed at
     * exactly the resolved combined rate — absent for non-US lines, lines with
     * a rate override, a partial taxable basis, or a home-rule city-component
     * split (where the components would not reconcile to the charged tax), and
     * on the engine-error fallback path.
     */
    jurisdictionBreakdown?: Array<{
      /** STATE, COUNTY, DISTRICT (county district), CITY, or LOCAL (city district). */
      level: string;
      /** Taxing-authority name as reported by the rate source, e.g. "CALIFORNIA". */
      name: string;
      /** Rate-source tax_type code: 01 state, 02 county, 03 county district, 04 city, 05 city district. */
      taxType: string;
      /** This authority's own rate as a fraction, e.g. 0.0725 for 7.25%. */
      rate: number;
      /** This authority's share of the line's tax. */
      taxAmount: number;
    }>;
    /**
     * Present only when this line's exemption came from an inline
     * `exempt: true` claim with NO certificate on file — the request's own
     * `exemptionReason`, or `'BLANKET_OTHER'` if omitted. A plain echo; it
     * never implies a certificate record exists (unlike a real certificate
     * match, which this SDK does not yet type separately — see
     * `pendingCertificates` below for the audit-trail record a real
     * certificate match would instead attach to).
     */
    exemptionReason?: 'RESALE' | 'MANUFACTURING' | 'AGRICULTURAL' | 'ENERGY' | 'EXEMPT_ORG' | 'GOVERNMENT' | 'DIRECT_PAY' | 'BLANKET_OTHER';
  }>;
  /**
   * Present when one or more inline `exempt: true` claims (with no matching
   * active ECM certificate) created new PENDING_CERTIFICATE
   * exemption-certificate records on this call — only when `customer.ref`
   * was also supplied.
   */
  pendingCertificates?: Array<{
    certId: string;
    certRef: string;
    /** Link to review/upload the actual certificate in the Clearvo dashboard. */
    ecmUrl: string;
    /** The reason recorded on this row — that line's own `exemptionReason`, or `'BLANKET_OTHER'` if it omitted one. */
    certificateType: 'RESALE' | 'MANUFACTURING' | 'AGRICULTURAL' | 'ENERGY' | 'EXEMPT_ORG' | 'GOVERNMENT' | 'DIRECT_PAY' | 'BLANKET_OTHER';
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

// ── Supplier Master Data ──────────────────────────────────────────────────
// Mirrors Customer for the other side of a transaction. A received inbound
// e-invoice is linked to a supplier master row (matched by entity/country/
// tax ID), and `supplier.ref` on a `transactionDirection: 'purchase'` tax
// calculation resolves this record exactly like `customer.ref` resolves a
// saved customer.

export type SupplierSource = 'manual' | 'API' | 'bulk_import' | 'auto_captured';

export interface SupplierTaxIdEntry {
  country: string;
  taxId: string;
}

export interface Supplier {
  /** Clearvo's internal supplier ID. */
  id: string;
  /**
   * Your own reference for this supplier (e.g. an ERP vendor id). Pass as
   * `supplier.ref` on `calculateTax()` (transactionDirection: 'purchase')
   * to reuse a saved supplier without resending full details.
   */
  supplierRef?: string | null;
  name: string;
  /**
   * ISO 3166-1 alpha-2 country code of the PRIMARY tax registration
   * (taxIds[0]). Required together with taxId; a supplier with no known
   * VAT registration may have neither.
   */
  country?: string | null;
  /**
   * Tax ID of the primary registration, format-validated and normalized
   * against country. See taxIds for a supplier registered in more than
   * one country.
   */
  taxId?: string | null;
  /**
   * Every tax registration on file for this supplier, primary first
   * (mirrors country/taxId above). A supplier registered in more than one
   * country has more than one entry here.
   */
  taxIds?: SupplierTaxIdEntry[];
  /**
   * ISO 3166-1 alpha-2 country code of this supplier's own place of
   * establishment — independent of `country` (the primary tax
   * registration's country above). Defaults to the primary tax
   * registration's country when not given explicitly.
   */
  establishmentCountry?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  /**
   * How this record was created: entered manually on the dashboard,
   * created via this API, bulk/CSV-imported, or auto-captured from a
   * received inbound e-invoice's supplier details.
   */
  source?: SupplierSource;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSupplierInput {
  name: string;
  /** Required together with taxId. Mutually exclusive with taxIds. */
  country?: string;
  /** Required together with country; format-validated and normalized. Mutually exclusive with taxIds. */
  taxId?: string;
  /**
   * A supplier registered in more than one country: the full ordered list
   * of registrations, first entry is the primary (mirrored onto
   * country/taxId in the response). Mutually exclusive with the flat
   * country/taxId fields above.
   */
  taxIds?: SupplierTaxIdEntry[];
  /** Your own reference (e.g. ERP vendor id). Must be unique per entity. */
  supplierRef?: string;
  establishmentCountry?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  /** Entity to create the supplier under. Required for account-scoped keys; omit for entity-scoped keys. */
  entityId?: string;
}

export interface UpdateSupplierInput {
  name?: string;
  country?: string | null;
  taxId?: string | null;
  /**
   * Full replacement list of this supplier's tax registrations (pass []
   * to clear every one); first entry becomes the primary, mirrored onto
   * country/taxId in the response. Mutually exclusive with the flat
   * country/taxId fields. Omit this field entirely to leave existing
   * registrations untouched.
   */
  taxIds?: SupplierTaxIdEntry[];
  supplierRef?: string | null;
  /** Omit to leave unchanged; null clears it. */
  establishmentCountry?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
}

export interface ListSuppliersParams {
  entityId?: string;
  /** Case-insensitive substring match against the stored name. */
  search?: string;
  /** Page number, 1-based (default 1). */
  page?: number;
  /** Results per page (default 25, max 100). */
  limit?: number;
}

export interface ListSuppliersResponse {
  suppliers: Supplier[];
  total: number;
  page?: number;
  limit?: number;
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

export interface RegistrationSecondaryIdentifier {
  key: string;
  label: string;
  value: string;
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
  /** Jurisdiction-specific secondary identifiers on file (e.g. France's SIRET, Germany's Steuernummer). */
  secondaryIdentifiers: RegistrationSecondaryIdentifier[];
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

export interface UpdateRegistrationInput {
  /** New registration/VAT number. Pass null or '' to clear it. Omit entirely to leave it unchanged. */
  taxNumber?: string | null;
  /** Secondary identifiers to merge in, e.g. { fr_siret: '12345678901234' } — only the keys you pass are changed. */
  extraFields?: Record<string, string>;
}

export interface UpdateRegistrationResponse {
  ok: boolean;
  taxNumber?: string | null;
  secondaryIdentifiers?: RegistrationSecondaryIdentifier[];
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
  /** Free-text exemption wording, only meaningful for an exempt/out-of-scope/reverse-charge code — passed through verbatim onto every invoice using this code. Never derived or auto-generated. */
  exemptionReasonText: string | null;
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
  /** Only meaningful for an exempt/out-of-scope/reverse-charge code — passed through verbatim onto every invoice using this code. Never derived or auto-generated. */
  exemptionReasonText?: string;
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

// ── France platform credentials (POST/GET /v1/fr/credentials) ──────────────
// No secret is stored here — this is a status-visibility endpoint for the
// entity's own French VAT number (numéro de TVA intracommunautaire), not a
// per-entity credential like the other countries' set*Credentials calls.
// Status is reported per capability because the platform's connection to
// its interim France delivery partner is granted per capability, not
// all-or-nothing. Mirrors components.schemas.FrCapabilityPresentation and
// the POST/GET /fr/credentials response shape in clearvo-marketing's
// public/openapi.json — keep in sync by hand (this endpoint is out of scope
// for scripts/generate-from-openapi.mjs, which only covers the
// TaxTreatment/ClearanceStatus tax-code-mapping contract).

/** Per-capability outcome. `active` — the platform's own France connection is configured, this tax number is
 *  authorised for this capability, and the platform's France channel is the production gateway. `pending_activation`
 *  — any of those is not yet true; nothing is needed from the caller unless contacted. `sandbox` — a sandbox API
 *  key; sandbox sends work now regardless of the production verdict either way. */
export type FrCapabilityStatus = 'active' | 'pending_activation' | 'sandbox';

/** Top-level rollup: the less-advanced of the two capabilities, or `not_registered` when the entity has no French
 *  tax number on file at all yet (GET only — POST always writes one). */
export type FrCredentialStatus = FrCapabilityStatus | 'not_registered';

export interface FrCapabilityPresentation {
  status: FrCapabilityStatus;
  /** Plain-language capability name, ready to render verbatim. */
  label: string;
  /** Ready-to-render, calm, partner-neutral one-liner for this capability. */
  message: string;
  /** Who owes the next step. Always 'platform' while pending; null once active. */
  actionOwner: 'platform' | null;
}

/** One field inside FrNextStep.body the caller must replace with a real value before sending —
 *  the platform has no way to determine it (it's a fact about the entity's own tax position, not
 *  something derivable from the registration itself). `options` is present only for a field with
 *  a closed set of valid values (currently only vatRegime). */
export interface FrNextStepRequiredInput {
  field: string;
  description: string;
  options?: readonly { value: string; label: string }[];
}

/** A static follow-on call this response documents, not one it performs itself — registering a French VAT number
 *  never flips a reporting obligation on its own. */
export interface FrNextStep {
  action: string;
  method: string;
  path: string;
  body: Record<string, unknown>;
  applicableTo: string;
  /** Fields inside `body` that are null placeholders, not real values — sending `body` verbatim
   *  will 400 (e.g. EFFECTIVE_FROM_REQUIRED); the caller must replace each one with a real fact
   *  about the entity before calling. Omitted when `body` needs no such replacement. */
  requiredInputs?: FrNextStepRequiredInput[];
}

export interface SetFrCredentialsInput {
  /** French VAT number. FR-prefixed, lowercase, spaced/punctuated, or the bare 11-character SIREN+key form are all
   *  accepted and normalised. Rejected as 400 INVALID_FORMAT if the shape, SIREN check digit, or key don't match. */
  taxNumber: string;
  /** Entity to configure. Required for account-scoped keys; omit for entity-scoped keys. */
  entityId?: string;
}

export interface FrCredentialsResponse {
  ok: boolean;
  entityId: string;
  /** null only on a GET for an entity with no French registration yet. */
  taxNumber: string | null;
  /** Read-through of the stored fr_siret extra field, if one was set via the general registrations API. */
  siret?: string | null;
  /** Present only when a POST changed an already-stored tax number — the value it replaced. */
  previousTaxNumber?: string;
  /** The less-advanced of the two capabilities below, or 'not_registered'. */
  credentialStatus: FrCredentialStatus;
  capabilities: {
    einvoicing: FrCapabilityPresentation;
    ereporting: FrCapabilityPresentation;
  };
  /** States what kind of check this is, and when — never a claim that the tax authority or the platform's France
   *  delivery partner was actually asked. */
  verification: { method: 'platform_configuration'; checkedAt: string };
  /** The last 9 digits of taxNumber, derived read-only — null only when nothing is registered yet. */
  siren: string | null;
  /** Static follow-on actions this response documents, never performed automatically — currently always the
   *  seller e-reporting step, shown to every caller since this endpoint has no way to know whether the
   *  registering entity is buyer-only; buyers can disregard it, since inbound receiving needs nothing further
   *  from them. */
  nextSteps: FrNextStep[];
  /** One plain-language sentence summarising both capabilities. */
  message: string;
}

// ── Business (customer-lifecycle) status ────────────────────────────────────
// Mirrors PATCH /v1/invoices/{id}/business-status. Only valid for an INBOUND
// (received) invoice — the calling entity is the customer recording their
// own decision on it. FR is the only country with a wired-up partner push
// today (via the Marosa/PPF bridge); DE records the same state machine as a
// platform-only decision with no partner push.

export type BusinessStatus =
  | 'IN_HAND'
  | 'APPROVED'
  | 'PARTIALLY_APPROVED'
  | 'DISPUTED'
  | 'SUSPENDED'
  | 'REFUSED'
  | 'COMPLETED'
  | 'PAYMENT_SENT'
  | 'PAYMENT_RECEIVED';

export interface UpdateBusinessStatusInput {
  /** Invoice id or referenceId of a received (inbound) invoice. */
  id: string;
  status: BusinessStatus;
  /** Required when status is DISPUTED, REFUSED, or SUSPENDED. */
  rejectionDetail?: { reason: string; message?: string };
  /** Entity that owns the invoice. Required for account-scoped keys; omit for entity-scoped keys. */
  entityId?: string;
}

export interface UpdateBusinessStatusResponse {
  ok: boolean;
  businessStatus: BusinessStatus;
  updatedAt: string;
}

// ── France inbound poll (Marosa interim bridge) ─────────────────────────────
// Mirrors POST /v1/fr/inbound/poll's entity-API-key mode: resolves status on
// this entity's own PENDING outbound submissions and discovers newly
// RECEIVED inbound documents. DELIBERATELY TEMPORARY, part of the Marosa
// interim bridge while Taxually's own DGFiP PA accreditation is pending —
// see the clearvo-fr-marosa skill.

export interface FrInboundPollResult {
  entityId: string;
  resolved: number;
  newInvoices: number;
  errors: string[];
}

export interface FrInboundPollResponse {
  ok: boolean;
  results: FrInboundPollResult[];
  totalNewInvoices: number;
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
