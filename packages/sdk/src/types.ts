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
  /** Facts about the entity itself (not any one country registration) — e.g. legalForm. See UpdateEntityInput.entityFacts. */
  entityFacts?: Record<string, string>;
  /** Germany only. This entity's default DE invoice format (level 3 of the format resolver), or null when unset (platform default ZUGFERD). */
  defaultDeInvoiceFormat?: DeInvoiceFormat | null;
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
  /**
   * Germany only. Entity-level default for `countrySpecific.de.invoiceFormat`
   * (used when neither the request nor the stored customer picks a format).
   * `'PEPPOL'` sends the invoice over the Peppol network. null clears the
   * override (back to the platform default, ZUGFERD). Anything else is
   * rejected with 400 INVALID_DE_INVOICE_FORMAT. A self-billed invoice cannot
   * resolve to PEPPOL: with this default set, it returns 422
   * `DE_SELF_BILLED_FORMAT_CHOICE_REQUIRED` unless the request names
   * ZUGFERD or XRECHNUNG.
   */
  defaultDeInvoiceFormat?: DeInvoiceFormat | null;
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
  /**
   * Facts about the entity itself (not any one country registration) — e.g.
   * `{ legalForm: 'GMBH' }`. A MERGE, per key, same 3-state contract as
   * UpdateRegistrationInput.extraFields: a string sets that key, an explicit
   * null deletes it, an omitted key is left unchanged. legalForm gates
   * whether Germany's Handelsregister disclosures (set via
   * UpdateRegistrationInput.extraFields) are applicable — set it here, not
   * on a registration, even for a German entity.
   */
  entityFacts?: Record<string, string | null>;
}

/** Values of Germany's `countrySpecific.de.invoiceFormat` (and the customer/entity default). */
export type DeInvoiceFormat = 'ZUGFERD' | 'XRECHNUNG' | 'PEPPOL';

/**
 * The 422 body of POST /v1/send for a German invoice resolved to PEPPOL whose
 * buyer cannot be reached over Peppol. There is no silent fallback: the invoice
 * is stored NEEDS_INFO (absent on a dryRun) and `error.alternatives[]` lists
 * the formats to re-send as.
 */
export interface PeppolCustomerUnreachableResponse {
  ok: false;
  id?: string;
  clearanceStatus?: 'NEEDS_INFO';
  error: {
    code: 'PEPPOL_CUSTOMER_UNREACHABLE';
    message: string;
    /** NO_CUSTOMER_PEPPOL_ID: no explicit Peppol address (never derived from a VAT number). NOT_REGISTERED_ON_PEPPOL: the network does not know the address. */
    reason: 'NO_CUSTOMER_PEPPOL_ID' | 'NOT_REGISTERED_ON_PEPPOL';
    isMerchantResolvable?: boolean;
    fixUrl?: string;
    retryable?: boolean;
    alternatives: Array<{
      invoiceFormat: 'ZUGFERD' | 'XRECHNUNG';
      label?: string;
      description?: string;
      /** Request fragment to re-send with; `correctsInvoiceId` reuses the invoice number. */
      resend?: Record<string, unknown>;
    }>;
    evidence: Record<string, unknown>;
  };
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
   * Germany: the generated document format. `UBL_PEPPOL_BIS` when the resolved
   * `de.invoiceFormat` is `PEPPOL` — the invoice goes over the Peppol network,
   * so `status` is PENDING (never ACCEPTED at generation) and moves to
   * DELIVERED once the receiving access point confirms.
   */
  documentFormat?: 'UBL_XRECHNUNG' | 'CII_ZUGFERD' | 'UBL_PEPPOL_BIS';
  /**
   * Present for a Peppol send (and its dryRun): how the invoice reaches the
   * buyer. `receiver` is the buyer's Peppol address as `scheme:value`
   * (e.g. `9930:DE123456789`); a German buyer's address is never derived from
   * a VAT number. `evidence` is dryRun only (what the reachability check saw).
   */
  delivery?: {
    channel: 'NETWORK';
    receiver: string | null;
    evidence?: Record<string, unknown>;
  };
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

/** The customer party of a sale: a PartyInput whose `name` is optional (Spain VeriFactu simplified invoices F2/R5 carry no customer identification). */
export type CustomerPartyInput = Omit<PartyInput, 'name'> & { name?: string };

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
  /**
   * Supplier only — resolve a previously-saved supplier record instead of
   * repeating its fields. Primarily used on a self-billed invoice
   * (countrySpecific.peppol.selfBilling: true — see SendInvoiceRequest's
   * own doc comment), where `supplier` identifies the real third-party
   * seller rather than the entity itself.
   */
  supplierRef?: string;
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

/**
 * Payment details for a `SubmitInvoiceInput`. `method: 'direct_debit'`
 * renders SEPA payment means (UBL/CII PaymentMeansCode 59, BG-19) and
 * requires `mandateReference` (BT-89) — Germany's KoSIT XRechnung-CII
 * overlay additionally requires `creditorId` and `debitedIban` (BT-90/91,
 * BR-DE-30/31). Country-agnostic — not Germany-specific.
 */
export interface PaymentInput {
  method?: 'bank_transfer' | 'direct_debit' | 'credit_card' | 'cash' | 'check' | 'other';
  /** Seller's IBAN for a `bank_transfer` invoice. */
  iban?: string;
  /** BIC/SWIFT code. Germany (DE): FORBIDDEN on a resolved-XRechnung invoice (BR-DE-25-b) — omit for DE or the call fails 422 `DE_XRECHNUNG_BIC_FORBIDDEN`. */
  bic?: string;
  reference?: string;
  prepaid?: boolean;
  /** BT-89. SEPA mandate reference identifier. Required whenever `method` is `'direct_debit'` — max 35 characters, or 422 `MANDATE_REFERENCE_TOO_LONG`. */
  mandateReference?: string;
  /** BT-90. SEPA bank-assigned creditor identifier (Gläubiger-ID) — the SELLER's own identifier, never the customer's. Germany additionally requires this whenever `method` is `'direct_debit'` (KoSIT BR-DE-30). */
  creditorId?: string;
  /** BT-91. The CUSTOMER's own IBAN the direct debit draws from — distinct from `iban` above (the seller's own account). Must be a real IBAN (checksum-validated) — malformed input fails 422 `INVALID_DEBITED_IBAN`. Germany additionally requires this whenever `method` is `'direct_debit'` (KoSIT BR-DE-31). */
  debitedIban?: string;
}

/** Words for `countrySpecific.es.customerIdType` (Spain VeriFactu buyer identification; AEAT IDType 03 to 07). */
export type EsCustomerIdType = 'passport' | 'residence_document' | 'residence_certificate' | 'other' | 'not_registered';

/** Values of the `es_tax_territory` field on a Spanish tax registration. */
export type EsTaxTerritory = 'mainland' | 'canary_islands' | 'both';

/** Spain VeriFactu fields of `SubmitInvoiceInput.countrySpecific.es` (Canary Islands IGIC and simplified invoices). */
export interface EsCountrySpecific {
  /** Explicit F1/F2/R1-R5 override. With no buyer identification, an original invoice up to EUR 400 is issued as F2 automatically. */
  tipoFactura?: string;
  /** What kind of document `customer.taxId` is when it is not a Spanish NIF or EU VAT number. */
  customerIdType?: EsCustomerIdType;
  /** Declaration that a simplified invoice is lawfully issued without identifying the recipient (RD 1619/2012 art. 6.1.d). */
  noRecipientIdentification?: boolean;
  /** Billing agreement number, at most 15 characters. */
  numRegistroAcuerdoFacturacion?: string;
  [key: string]: unknown;
}

export interface SubmitInvoiceInput {
  documentType?: 'invoice' | 'credit_note' | 'debit_note';
  invoiceNumber: string;
  issueDate: string;
  dueDate?: string;
  currency: string;
  country: string;
  /**
   * ISO 4217 currency code this invoice must be VAT-reported in, when it
   * differs from `currency` (EN16931 BT-6 — e.g. a EUR invoice for a
   * transaction whose jurisdiction reports in RON). Omit to let it resolve
   * automatically from the transaction's own tax jurisdiction; only set it to
   * override that. When the resolved reporting currency differs from
   * `currency`, you must also supply `exchangeRate` or `taxReportingAmounts`
   * below, or the call fails with 422 `TAX_REPORTING_CONVERSION_MISSING` —
   * Clearvo never fetches or computes an exchange rate itself.
   */
  taxReportingCurrency?: string;
  /**
   * `currency` -> `taxReportingCurrency` rate, applied uniformly to every
   * total (subtotal, tax-exclusive amount, tax total, grand total). Mutually
   * exclusive with `taxReportingAmounts` — 422
   * `EXCHANGE_RATE_AND_TAX_REPORTING_AMOUNTS_BOTH_SUPPLIED` if both are sent.
   */
  exchangeRate?: number;
  /**
   * Authoritative net/tax/gross totals in `taxReportingCurrency`, taken as-is
   * rather than back-derived from a single collapsed figure or exchange rate
   * — your own rounding of net+tax often isn't identical to rounding the
   * gross directly, and the tax amount specifically usually needs to
   * reconcile exactly with your own books. Mutually exclusive with
   * `exchangeRate`.
   */
  taxReportingAmounts?: {
    netAmount: number;
    taxAmount: number;
    /** Optional — computed as `netAmount + taxAmount` when omitted. */
    grossAmount?: number;
  };
  taxIncluded?: boolean;
  /**
   * Optional on an ordinary sale — auto-derived from the entity's own
   * master data when omitted. On a self-billed invoice
   * (countrySpecific.peppol.selfBilling: true), `supplier` identifies the
   * real third-party seller instead and is effectively required — omitting
   * it with no resolvable `supplierRef` fails with 422
   * MISSING_SELF_BILLING_SUPPLIER, and SUPPLIER_TAX_ID_MISMATCH never
   * applies to it (see `customer` below).
   */
  supplier?: PartyInput;
  /**
   * The counterparty. On an ordinary sale this is the customer. On a
   * self-billed invoice (countrySpecific.peppol.selfBilling: true),
   * `customer` is instead the entity's OWN identity (the buyer being
   * self-billed for) — auto-derived when omitted, tax-ID-compared against
   * the entity's own registration the same way `supplier` normally is, and
   * its endpointId/endpointSchemeId (BT-49) backfilled from the entity's
   * own confirmed Peppol Participant ID when omitted.
   *
   * `name` may be omitted only on a Spain VeriFactu simplified invoice (F2 or
   * R5, no customer identification); everywhere else it is required.
   */
  customer: CustomerPartyInput;
  /** Optional customer classification for the whole invoice. Can be overridden per line via lines[].customerType. */
  customerType?: 'B2B' | 'B2C';
  lines: LineItemInput[];
  allowances?: AllowanceChargeInput[];
  charges?: AllowanceChargeInput[];
  shipping?: ShippingInput;
  payment?: PaymentInput;
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
   * - `es.customerIdType` — Spain VeriFactu only. What kind of document
   *   `customer.taxId` is when it is not a Spanish NIF or an EU VAT number
   *   (`passport`, `residence_document`, `residence_certificate`, `other`,
   *   `not_registered`); send the buyer's country in `customer.taxIdCountry`.
   *   See {@link EsCountrySpecific}.
   * - `es.noRecipientIdentification` — Spain VeriFactu only. Your declaration
   *   that a simplified invoice is lawfully issued without identifying the
   *   recipient (RD 1619/2012 art. 6.1.d). Never inferred.
   * - `es.numRegistroAcuerdoFacturacion` — Spain VeriFactu only. Billing
   *   agreement number (max 15 characters) allowing a simplified invoice
   *   above EUR 3,000.
   * - Canary Islands: Clearvo registers Canary Islands (IGIC) invoices with
   *   the AEAT VeriFactu system under the same Spanish tax number. Set
   *   `es_tax_territory` on the Spanish registration (see
   *   {@link UpdateRegistrationInput}); Clearvo does not file IGIC returns.
   * - `hu.exchangeRate` — exchange rate to HUF for this invoice date.
   *   Required whenever `currency` is not HUF.
   * - `hu.invoiceAppearance` — one of PAPER/ELECTRONIC/EDI/UNKNOWN, overriding
   *   the default appearance (PAPER for a resolved PRIVATE_PERSON customer,
   *   ELECTRONIC otherwise).
   * - `de.invoiceFormat` — per-request override of ZUGFERD vs. XRECHNUNG vs.
   *   PEPPOL (see {@link DeInvoiceFormat}). `PEPPOL` sends the invoice over
   *   the Peppol network (Peppol BIS Billing 3.0; response `documentFormat`
   *   `UBL_PEPPOL_BIS`, status PENDING then DELIVERED). Needs the seller's
   *   confirmed Peppol ID and an explicit Peppol ID for the customer
   *   (`customer.endpointSchemeId` + `customer.endpointId`, or a confirmed one
   *   on the stored customer) — a German buyer's address is never derived
   *   from a VAT number — plus a `buyerReference` or `orderReference`. An
   *   unreachable buyer fails 422 `PEPPOL_CUSTOMER_UNREACHABLE`
   *   ({@link PeppolCustomerUnreachableResponse}). Other errors: 422
   *   `MISSING_SELLER_PEPPOL_ID`, `CREDIT_NOTE_PEPPOL_UNSUPPORTED` (credit
   *   and debit notes cannot yet go over Peppol for Singapore, Japan or the
   *   UAE; Germany supports them in all three formats), `PEPPOL_SCHEMATRON_VALIDATION_FAILED`,
   *   `XRECHNUNG_SCHEMATRON_VALIDATION_FAILED`, `VALIDATION_UNAVAILABLE`.
   *   Self-billed German invoices cannot use PEPPOL: 400
   *   `DE_SELF_BILLED_PEPPOL_NOT_SUPPORTED` when requested explicitly, 422
   *   `DE_SELF_BILLED_FORMAT_CHOICE_REQUIRED` when a stored default is PEPPOL.
   * - `de.leitwegId` — BT-10 German public-sector routing ID (XRechnung
   *   only); falls back to the top-level `buyerReference`, then to the
   *   customer's stored `LEITWEG_ID` reference, when omitted. The Leitweg-ID is
   *   only used as the customer electronic address if it passes check-digit
   *   validation. A stored, confirmed `PEPPOL_PARTICIPANT_ID` reference
   *   likewise supplies the customer's Peppol address when the request has no
   *   explicit `endpointId` + `endpointSchemeId`. German XRechnung and Peppol
   *   invoices need a customer and a seller electronic address; without one the
   *   call fails with ERROR rules `MISSING_CUSTOMER_ELECTRONIC_ADDRESS` /
   *   `MISSING_SUPPLIER_ELECTRONIC_ADDRESS` before any XML is generated. The
   *   SDK has no typed customer methods; customer `references` are managed
   *   through the REST API and MCP tools.
   * - `de.legalForm` — per-invoice override of the entity's own legal form
   *   (DE legal-form select vocabulary, e.g. GMBH, UG, AG, SE, KGAA, EG,
   *   GMBH_CO_KG, AG_CO_KG, OHG, KG, EK, GBR, FREIBERUFLER, SOLE_TRADER,
   *   FOREIGN_BRANCH, OTHER; case-sensitive) — gates whether the
   *   register-identity and managing-directors disclosure fields below
   *   apply at all (invoice-content-field-registry). Defaults from the
   *   entity's own stored `entityFacts.legalForm` (see
   *   `UpdateEntityInput.entityFacts`) when omitted; rarely needed
   *   per-invoice.
   * - `de.handelsregisternummer` — BT-30, HGB § 37a commercial-register
   *   number (e.g. "HRB 12345"). Required once `legalForm` is a
   *   Handelsregister-registered form; missing this/`registergericht`/
   *   `registeredSeat` never blocks the send — returns non-terminal
   *   `errorCode: MISSING_DE_COMPANY_REGISTER_DETAILS` (WARNING severity).
   * - `de.registergericht` / `de.registeredSeat` — HGB § 37a register court
   *   / Sitz. See `de.handelsregisternummer` for the shared gate.
   * - `de.geschaeftsfuehrer` — GmbHG § 35a / AktG § 80 managing-director or
   *   board-member names, one per line. Missing this when applicable
   *   returns `errorCode: MISSING_DE_MANAGING_DIRECTORS` (WARNING).
   * - `de.kleinunternehmer` — boolean, § 19 UStG small-business exemption
   *   flag. `true` with any line carrying a positive tax rate fails 422
   *   `DE_KLEINUNTERNEHMER_CHARGES_VAT` (a real VAT-invoice defect, unlike
   *   the company-law WARNINGs above).
   * - Each `de.*` field above falls back to the matching `de_*` extraFields
   *   value on the entity's own DE tax registration when omitted.
   * - `peppol.selfBilling` (boolean, default false) — marks this as a
   *   self-billing document (the customer issues on the seller's behalf),
   *   switching to a self-billing CustomizationID/ProfileID and UNTDID
   *   1001 type codes (389 invoice / 261 credit note). See `supplier` and
   *   `customer` above for how party semantics change. Silently ignored
   *   for SG and JP (self-billing document-type registration not yet
   *   supported for those two).
   */
  countrySpecific?: Record<string, unknown>;
  notifyCustomer?: boolean;
  rejectInsteadOfAutoCorrect?: boolean;
  metadata?: Record<string, string>;
  /**
   * ES SII block 3. Defaults to `'sale'` (this entity's own outbound/issued document —
   * LFE). `'purchase'` records a vendor's document on this entity's received side
   * (LFR) — Spain SII (received book) and France e-reporting (a purchase from a
   * vendor not established in France is declared by you as the receiving party, in
   * its own Received batch; send `supplier.taxId` and `supplier.address.country`, a
   * missing one parks NEEDS_INFO); every other live country's purchase-direction
   * submission currently resolves to no reporting mandate at all. `supplier` is
   * still required for a purchase and is the VENDOR/counterparty (the entity's own
   * Spanish registration is applied automatically, same derivation as the
   * sale-side `supplier.taxId` rule).
   */
  transactionDirection?: 'sale' | 'purchase';
  /**
   * France e-reporting, own-goods stock transfers only (client tax code with
   * movement `own_goods_movement`). Where the goods leave: the French origin for an
   * outbound transfer (`transactionDirection: 'sale'`), the origin member state for
   * an inbound one (`'purchase'`). Send ONE entry per movement, on the French leg
   * only. Ignored for every other transaction; a transfer without it parks NEEDS_INFO.
   */
  shipFrom?: { country: string };
  /** France e-reporting, own-goods stock transfers only. Where the goods arrive; needed for an outbound transfer (shipFrom in France) to name the destination member state. */
  shipTo?: { country: string };
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

/** `validation` block of a received document: what was checked and what was found. It never says a document is valid or approved. */
export interface InboundValidation {
  outcome: string | null;
  status: 'CHECKS_PASSED' | 'CHECKS_WARNINGS' | 'CHECKS_FAILED' | 'CHECKS_NOT_RUN' | null;
  /** For example "Checked against Peppol BIS Billing 3.0 (PEPPOL-EN16931-UBL 3.0.21): 0 errors, 2 warnings". */
  summary: string | null;
  ruleset: 'EN16931' | 'PEPPOL' | 'PEPPOL-SB' | 'XRECHNUNG' | null;
  artefact: { name: string; version: string } | null;
  checkedAt: string | null;
  counts: { errors: number; warnings: number } | null;
  /** Populated on the single-record read; empty on the list. */
  findings: Array<{
    rule: string;
    severity: 'error' | 'warning';
    message: string;
    bmfClass?: string;
    location?: string;
  }>;
  truncated?: boolean;
}

/** Classification of a received e-invoice (BMF three-tier taxonomy plus the Peppol checks). */
export type ValidationOutcome =
  | 'E_INVOICE'
  | 'E_INVOICE_WITH_FLAGS'
  | 'FORMAT_ERROR'
  | 'PROFILE_NOT_SUFFICIENT'
  | 'NOT_AN_EINVOICE'
  | 'BUSINESS_RULE_ERROR'
  | 'NOT_VALIDATED';

/**
 * Fields present on a RECEIVED document (direction `inbound`, e.g. inbound Peppol) in the
 * GET /v1/invoices list and GET /v1/invoices/{id}. `ListInvoicesResponse.invoices`
 * stays `unknown[]`; cast a received row to this shape.
 */
export interface ReceivedInvoiceFields {
  validationOutcome?: ValidationOutcome | null;
  /** PEPPOL_AS4, DE_INBOUND_API, DE_INBOUND_DASHBOARD, DE_INBOUND_BULK or DE_INBOUND_EMAIL. */
  intakeChannel?: string;
  /** When the platform received the document (not when it was stored). */
  receivedAt?: string;
  validation?: InboundValidation | null;
  /** The supplier's own supporting documents (BG-24), listed only; the bytes are never included. */
  attachments?: Array<{
    id: string | null;
    fileName: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    description: string | null;
    externalUrl: string | null;
    origin: 'supplier';
  }>;
  /**
   * How GET /v1/documents/{id}?format=pdf answers: `original` (the archived
   * PDF), `generated` (a labelled readable copy rendered from the structured
   * data, not an invoice in its own right) or `none` (it would answer 422).
   */
  rendition?: 'original' | 'generated' | 'none' | null;
  /**
   * On a needs-review record replaced by a corrected re-send: the replacing
   * record (`{ id }` on the list; the single-record read adds invoiceNumber,
   * status and statusLabel). null otherwise.
   */
  supersededBy?: { id: string; invoiceNumber?: string; status?: string; statusLabel?: string } | null;
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
  /**
   * Where the goods are dispatched from. With duties on, a dispatch place in a
   * different customs territory from the destination makes a customs crossing;
   * a line-level `shipFrom` overrides it for that line. `customsStatus:
   * 'bonded'` marks stock held under customs control.
   */
  shipFrom?: TaxCalcShipFrom;
  /**
   * Explicit importer of record on a customs-crossing shipment; wins over
   * `incoterms`. With duties on it decides who bears the import charges.
   */
  importerOfRecord?: 'SELLER' | 'BUYER';
  /** Consignment insurance, a customs-value component under CIF. Read only when duties are requested. */
  insurance?: { amount: number; currency?: string };
  /**
   * Estimated import duty, import VAT/GST and customs fees for a cross-border
   * consignment. Never included in `totalTax`/`totalAmountWithTax`; see
   * `summary.importChargesAtCheckout` for the one amount a checkout may add.
   * `include` overrides the account `dutiesEnabled` setting either way.
   */
  duties?: DutiesRequest;
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
     * Optional external classification codes for this line (max 5), tried in
     * order; the first that maps to a Clearvo tax category wins. Skipped when
     * `taxCategory` is supplied. A code with no mapping falls through to the
     * product cache, name classification and the entity default. The result
     * reports the decision as `classificationSource: 'CODE_MAP'` plus
     * `classificationSystem` / `classificationMatchedCode`.
     */
    classificationCodes?: ClassificationCode[];
    /**
     * Caller-forced rate band for this line — names a band only, never a raw
     * rate; the engine still resolves the actual percentage for the line's
     * own jurisdiction from that band. Highest-precedence input to rate-band
     * resolution, checked before commodityCode and taxCategory. Does not
     * affect classification, place-of-supply, or upstream B2B/reverse-charge/
     * exemption logic — those run unconditionally first and are unaffected.
     */
    taxTreatmentOverride?: 'STANDARD' | 'MIDDLE' | 'REDUCED' | 'SUPER_REDUCED' | 'SPECIAL' | 'EXEMPT' | 'ZERO';
    /**
     * Optional tariff/customs classification code for this line (HS, CN, or
     * UK Trade Tariff). For rate-band lookup, matching is
     * jurisdiction-scoped by the line's own resolved country. With duties on, this is the code the duty is priced at (see `commodityCodeScheme`). Looked up
     * hierarchy-aware (own digit precision, then progressively shorter
     * prefixes). Consulted only when taxTreatmentOverride is absent — a
     * total miss re-enters the ordinary taxCategory/classification cascade
     * exactly as if this field had never been supplied.
     */
    commodityCode?: string;
    /**
     * Scheme of `commodityCode`, read only when duties are requested. A
     * national code is exact only in its own territory; anywhere else its
     * first six digits are used. Omitted: inferred from the digit count and
     * the destination (`schemeInferred` is then true on the duty block).
     */
    commodityCodeScheme?: DutyCodeScheme;
    /** ISO 3166-1 alpha-2 country the goods were made in, read only when duties are requested. Never inferred from `shipFrom`. */
    countryOfOrigin?: string;
    /** Weight of ONE unit, for per-kilogram duties; the line weight is value x quantity. Read only when duties are requested. */
    weight?: { value: number; unit: 'kg' | 'g' | 'lb' | 'oz' };
    /** Per-line dispatch address; overrides the transaction `shipFrom` for this line (a second warehouse is a second consignment). */
    shipFrom?: TaxCalcShipFrom;
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
    /**
     * Rules-engine (M.14/RE-6) — this line's own purchase-order header id,
     * for `documentStage: 'invoice'` to link back against a previously
     * calculated `documentStage: 'purchase_order'` line (see the response's
     * `poLink`/`poComparison`). Ignored when `purchaseOrderId` is absent.
     */
    purchaseOrderId?: string;
    /** Which PO line `poLink` resolves against, when the PO header may omit it. */
    purchaseOrderLineNumber?: string;
    /**
     * Per-line custom facts a rules-engine condition/action can read/write
     * as `customProperties.<key>` — e.g. glAccount, costCenter,
     * commodityCode, accountAssignment, intendedUse (the AP buyer-side
     * inputs). Call getRulePropertyDefinitions() for the closed set.
     */
    customProperties?: Record<string, string | number | boolean>;
  }>;
  vatValidation?: 'full' | 'format' | 'none';
  vatUnverifiableFallback?: 'conservative' | 'permissive';
  /**
   * Rules-engine (M.14/RE-6) — which stage of a purchase document this
   * calculation represents. `'purchase_order'` binds `lineItems[].poLink`
   * resolution and later invoice-stage `poComparison`; `'invoice'` is the
   * ordinary default. Only meaningful on `transactionDirection: 'purchase'`.
   */
  documentStage?: 'purchase_order' | 'invoice';
  /**
   * Header-level custom facts a rules-engine condition/action can read/write
   * as `customProperties.<key>` (call getRulePropertyDefinitions() for the
   * closed set of keys visible to this key's own scope). Same contract as
   * the per-line `customProperties` below.
   */
  customProperties?: Record<string, string | number | boolean>;
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
  } & Partial<DutiesSummary>;
  /**
   * Present when duties were requested (`duties.include`, or the account
   * `dutiesEnabled` setting), or as status `'disabled'` when the cart carries
   * duty inputs while duties are off. A duty failure sets `duties.status` to
   * `'degraded'` here and never sets the calculation's own `degraded`.
   */
  duties?: DutiesBlock;
  /** One entry per customs border crossing in the cart. Estimates, never tax. */
  consignments?: DutyConsignment[];
  lineItems: Array<{
    id: string;
    /** Estimated import duty for this line; present only when duties were quoted for it. Never part of the line's tax. */
    duty?: LineDuty;
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
    classificationSource?: 'EXPLICIT' | 'CODE_MAP' | 'CACHED' | 'AI' | 'AI_FALLBACK' | null;
    /**
     * Set only when `classificationSource` is 'CODE_MAP': which classification
     * system (e.g. 'stripe', 'shopify', 'hs') decided this line.
     */
    classificationSystem?: string;
    /**
     * Set only when `classificationSource` is 'CODE_MAP': the code that
     * actually matched. For hierarchical systems this can be an ancestor of
     * the code sent (e.g. sent 'aa-1-13-5', matched 'aa-1-13').
     */
    classificationMatchedCode?: string;
    sourcingRationale?: {
      /** This line's resolved rate band (STANDARD/MIDDLE/REDUCED/SUPER_REDUCED/SPECIAL/ZERO/EXEMPT/etc). Always present when sourcingRationale is. */
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
    /**
     * `transactionDirection: 'purchase'` only — the vendor-charged-tax
     * verification result for this line (AP decision layer, lib/ap/decision.ts
     * on the backend). Always present alongside a supplied statedTaxAmount on
     * a purchase line; absent for a 'sale' line and for a genuine
     * border-paid-import line (see `reasonCode: 'IMPORT_TAX_PAID_AT_BORDER'`,
     * served with `outcome: null`, for that distinction from "never checked").
     */
    taxVerification?: {
      outcome: 'ACCEPTED_AS_CHARGED' | 'UNDERCHARGED' | 'OVERCHARGED' | 'HELD' | null;
      reasonCode:
        | 'WITHIN_TOLERANCE' | 'TRUSTED_SUPPLIER_OVERRIDE' | 'OVERCHARGE_EXCEEDS_TOLERANCE'
        | 'UNDERCHARGE_EXCEEDS_TOLERANCE' | 'PO_DISPOSITION_HOLD' | 'REVERSE_CHARGE_VAT_WRONGLY_CHARGED'
        | 'TAX_CHARGED_ON_ZERO_LIABILITY_LINE' | 'NO_TAX_DUE_NONE_CHARGED' | 'IMPORT_TAX_PAID_AT_BORDER';
      /** statedTaxAmount - calculatedTaxAmount, rounded to 2dp. */
      legalDelta: number;
      /** 0 when outcome is ACCEPTED_AS_CHARGED; equal to legalDelta otherwise — the true remaining reportable exposure. */
      appliedDelta: number;
      /** Non-null only for a reverse-charge/PVA/exempt/zero-rated line. */
      zeroLiabilityBasis: 'REVERSE_CHARGE' | 'PVA' | 'EXEMPT' | 'ZERO_RATED' | null;
      /**
       * The PO<->invoice fact-diff (M.14/RE-6) — present only when this
       * line's `poLink` (below) resolved to `'LINKED'`. A plain fact-diff,
       * never a tax-correctness verdict.
       */
      poComparison?: {
        exceedsThreshold: boolean;
        poTaxCode: string | null;
        poRate: number | null;
        poTaxAmount: number | null;
        invoiceTaxCode: string;
        invoiceRate: number;
        invoiceTaxAmount: number;
        taxAmountDelta: number | null;
      };
    };
    /**
     * `transactionDirection: 'purchase'` with `documentStage: 'invoice'`
     * only — whether this line's own `purchaseOrderId`/`purchaseOrderLineNumber`
     * resolved against a real, previously-calculated purchase_order-stage
     * line. `'NONE'` when the line carried no `purchaseOrderId` at all.
     */
    poLink?: 'NONE' | 'NOT_FOUND' | 'LINKED';
    /** This line's customProperties bag, post-rule (the effective values the engine actually used, echoing back any rule-authored writes). */
    customProperties?: Record<string, string | number | boolean>;
  }>;
  /**
   * Rules-engine (docs/features/rules-engine/discovery.md's Resolved
   * decisions #20/Q22) — every rule that fired on this calculation, in
   * firing order, scope-reduced for the public API: a Global/Tenant
   * (platform) row never carries its internal ruleId/code, only an
   * Entity/Organisation row (your own rule) keeps `ruleCode`. Absent
   * entirely (never an empty array) when no rule fired.
   */
  ruleLog?: Array<{
    ruleKind: 'NORMALIZATION' | 'ENRICHMENT' | 'ADJUSTMENT' | 'WARNING' | 'ERROR';
    /** Customer-facing group label, e.g. "Normalization". */
    label: string;
    /** Present only for an Entity-/Organisation-scoped rule (your own). */
    ruleCode?: string;
    property: string | null;
    beforeValue: unknown;
    afterValue: unknown;
  }>;
  /** true only when the full rule-log entry count exceeded the public-response cap (100) — absent (never false) otherwise. Call getRulesTrace() for the complete, uncapped trace. */
  ruleLogTruncated?: true;
  /**
   * The actual header facts (post pre-calc-rules-pass) the engine resolved
   * jurisdiction/rate/classification against — never your raw, pre-rules
   * request. Lets you see what a NORMALIZATION/ENRICHMENT rule actually
   * changed a header fact TO, complementing `ruleLog`'s "what changed".
   */
  effectiveInput?: {
    country: string | null;
    customerCountry: string | null;
    supplierCountry: string | null;
    customerType: string | null;
    currency: string | null;
  };
  /**
   * Every matched WARNING-kind rules-engine rule (pre- or post-calculation)
   * — absent entirely (never an empty array) when none fired.
   */
  warnings?: Array<{ ruleCode: string; scopeLevel: string }>;
  /**
   * Present only on a calculation replayed by a CONFIRMED FORCED_INPUT
   * manual adjustment (proposeManualAdjustment) — names the id of the
   * superseding calculation; re-fetch/re-poll that id rather than trust this
   * replayed figure. Absent on a fresh (non-replay) calculation and on a
   * replay that hasn't been superseded.
   */
  supersededBy?: string;
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

/**
 * An external classification code. `system` is lowercase `[a-z0-9_]{1,30}`.
 * Known systems: 'stripe' (Stripe product tax code, `txcd_*`), 'shopify'
 * (Shopify product taxonomy category id, e.g. `aa-1-13`), 'hs' (customs
 * commodity code).
 */
export interface ClassificationCode {
  system: string;
  code: string;
}

export interface Product {
  id: string;
  entityId: string;
  name: string;
  sku?: string;
  description?: string;
  taxCategory?: string;
  /** Classification codes stored on the product (max 5). */
  classificationCodes?: ClassificationCode[];
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
  /** External classification codes (max 5), e.g. [{ system: 'stripe', code: 'txcd_10000000' }]. */
  classificationCodes?: ClassificationCode[];
  entityId?: string;
}

export interface UpdateProductInput {
  name?: string;
  sku?: string;
  description?: string;
  taxCategory?: string;
  /** Replaces the product's classification codes (max 5). */
  classificationCodes?: ClassificationCode[];
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
  /**
   * AP decision layer full override (rules-engine B7) — when true, every
   * vendor-charged-tax verification for this supplier resolves
   * ACCEPTED_AS_CHARGED / TRUSTED_SUPPLIER_OVERRIDE regardless of delta,
   * skipping tolerance comparison entirely. Set via updateSupplier(); never
   * settable on createSupplier().
   */
  trusted?: boolean;
  /**
   * Per-supplier tolerance override for vendor-charged-tax verification —
   * takes precedence over the entity's own default apTolerance (see
   * getTaxSettings()/updateTaxSettings()). null means "no override, use the
   * entity default".
   */
  toleranceOverride?: { absoluteAmount: number; percent: number } | null;
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
  /** AP decision layer full override (lib/ap/decision.ts on the backend) — see Supplier.trusted. */
  trusted?: boolean;
  /** null clears it (falls through to the entity default again). See Supplier.toleranceOverride. */
  toleranceOverride?: { absoluteAmount: number; percent: number } | null;
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

// ── Bank Account Master Data ─────────────────────────────────────────────────
//
// Entity-owned IBAN/BIC master data, one row per currency plus an optional
// entity-wide DEFAULT (currency omitted). When an invoice's payment.iban is
// omitted, submitInvoice/calculateTax's send step falls back to the account
// matching the invoice's own currency, then to the DEFAULT account, in that
// order — a payment.iban given directly on the invoice always wins outright.

export interface BankAccount {
  id: string;
  /** ISO 4217 alpha-3, or null for the entity-wide default/fallback account. */
  currency: string | null;
  iban: string;
  bic?: string | null;
  accountHolderName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBankAccountInput {
  /** Omit to make this the entity-wide DEFAULT account. */
  currency?: string;
  /** Format/checksum-validated before storing. */
  iban: string;
  bic?: string;
  accountHolderName?: string;
  /** Entity to create the bank account under. Required for account-scoped keys; omit for entity-scoped keys. */
  entityId?: string;
}

export interface UpdateBankAccountInput {
  /** null moves this back to the entity-wide DEFAULT (no-currency) slot. */
  currency?: string | null;
  /** Re-validated (format/checksum) if provided. */
  iban?: string;
  bic?: string | null;
  accountHolderName?: string | null;
}

export interface ListBankAccountsResponse {
  bankAccounts: BankAccount[];
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
  /**
   * Secondary identifiers to merge in, per key: a string value overwrites
   * that key, an explicit `null` deletes it, an omitted key is left
   * unchanged — e.g. { fr_siret: '12345678901234' } or
   * { de_handelsregisternummer: 'HRB 12345' }. Germany (DE) accepts, in
   * addition to `de_steuernummer`: `de_registered_seat`,
   * `de_handelsregisternummer`, `de_registergericht`, `de_geschaeftsfuehrer`,
   * and `de_kleinunternehmer` ('true'/'false') — see
   * `SubmitInvoiceInput.countrySpecific`'s `de.*` doc comments for what each
   * one means and when it's enforced. Legal form is NOT here — it's an
   * entity-level fact, not scoped to any one country registration; set it
   * via `UpdateEntityInput.entityFacts.legalForm` instead. Spain (ES)
   * accepts `es_tax_territory` (`mainland`, `canary_islands` or `both`) —
   * which part of Spain you sell from; an IGIC (Canary Islands) line cannot
   * be registered with VeriFactu until it is set.
   */
  extraFields?: Record<string, string | null>;
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
export type ClientTaxCodeRateBand = 'standard' | 'middle' | 'reduced' | 'super_reduced' | 'special' | 'zero';
export type ClientTaxCodeFilingTag =
  | 'cash_accounting_settled' | 'cash_accounting_unsettled' | 'split_payment' | 'statement_of_intent'
  | 'withholding' | 'bad_debt_adjustment' | 'triangular_party_b' | 'triangular_party_c';
/** Purchase-side input-tax recoverability only. 'restricted' is the only value where recoverablePercentage carries real data — 'full'/'blocked' already imply 100/0. */
export type ClientTaxCodeRecoverabilityType = 'full' | 'blocked' | 'restricted';

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
  /** Purchase-side input-tax recoverability only. null for a sale code, or a purchase code with no recoverability position yet. */
  recoverabilityType: ClientTaxCodeRecoverabilityType | null;
  /** Decimal-fraction-free percentage (50 = 50%), set only when recoverabilityType="restricted". null otherwise. */
  recoverablePercentage: number | null;
  /** Free-text reason code for an exempt/out-of-scope row — pure metadata, never validated against an enum. Max 30 characters. */
  exemptionReasonCode: string | null;
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
  /** Purchase-side input-tax recoverability only. Omit for a sale code, or a purchase code with no recoverability position yet. */
  recoverabilityType?: ClientTaxCodeRecoverabilityType;
  /** Required (and only meaningful) when recoverabilityType="restricted" — a percentage strictly between 0 and 100 (0 and 100 are already "blocked"/"full"). */
  recoverablePercentage?: number;
  /** Free-text reason code for an exempt/out-of-scope row — pure metadata, never validated against an enum. Max 30 characters. */
  exemptionReasonCode?: string;
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

// ── GET /v1/tax/client-codes/options — valid field combinations for building/
// filtering a Client Tax Code form. Call before createClientTaxCode/
// updateClientTaxCode rather than guessing an enum value — the same source
// of truth the dashboard's own form uses.

export interface GetClientTaxCodeOptionsParams {
  /** 2- or 3-letter ISO code, e.g. "DE". Omit to get the unfiltered global option set. */
  country?: string;
  /** Sub-country scope (e.g. a US state) — refines rateBands' resolved rate percentages. Only meaningful alongside country. */
  region?: string;
  /** Further narrows movements to sale- or purchase-relevant values. */
  direction?: ClientTaxCodeDirection;
  entityId?: string;
}

export interface ClientTaxCodeOptionsResponse {
  ok: boolean;
  countries: string[];
  movements: Array<{ value: ClientTaxCodeMovement; label: string; valid: boolean }>;
  supplyTypes: Array<{ value: ClientTaxCodeSupplyType; label: string }>;
  rateBands: Array<{ value: ClientTaxCodeRateBand; label: string; valid: boolean; rate: number | null }> | null;
  regionRequired: boolean | null;
  /** Selectable sub-country regions when the country offers a fixed list (e.g. ES -> Canary Islands); null otherwise. */
  regionOptions: Array<{ value: string; label: string }> | null;
  /** Label for the empty choice when regionOptions is offered (e.g. ES -> mainland); null otherwise. */
  regionNoneLabel: string | null;
  reverseChargeRelevant: boolean | null;
  useTaxSelfAssessedRelevant: boolean | null;
  zeroRatedGuidance: string | null;
}

// ── GET /v1/tax/client-codes/exemption-reasons — candidate exemptionReasonCode
// values for an in-progress (not yet saved) client tax code.

export interface GetClientTaxCodeExemptionReasonOptionsParams {
  country?: string;
  movement?: ClientTaxCodeMovement;
  taxability?: ClientTaxCodeTaxability;
  reverseCharge?: boolean;
  supplyType?: ClientTaxCodeSupplyType;
  customerType?: ClientTaxCodeCustomerType;
  rateBand?: ClientTaxCodeRateBand;
  direction?: ClientTaxCodeDirection;
  entityId?: string;
}

export interface ClientTaxCodeExemptionReasonOptionsResponse {
  ok: boolean;
  reasons: Array<{
    code: string;
    text: string;
    /** Every output format (PEPPOL/IT/PL) that would emit this exact code for this decision — deduped by code, not repeated once per format. */
    formats: string[];
  }>;
}

// ── GET /v1/mandate-transactions — consolidated cross-jurisdiction
// transaction view. One row per resolved (or in-progress) mandate decision,
// whatever mechanism it resolved to (per-document e-invoicing clearance, an
// aggregate accumulate-then-flush e-report, or no mandate at all).

export type MandateTransactionStateFilter =
  | 'PENDING' | 'RESOLVED' | 'NEEDS_INFO' | 'HELD_UNKNOWN_MANDATE' | 'OBLIGATION_DISABLED'
  | 'HELD_UNMAPPED_DECISION' | 'RECEIVED'
  | 'HELD'
  | 'OPEN' | 'ACCUMULATED-OPEN-PERIOD'
  | 'CLOSED' | 'SUBMITTED' | 'FILED'
  | 'CLEARED';

export interface ListMandateTransactionsParams {
  /** Every row a specific bulk upload (sync or async) produced. NULL for a row from a single-document submitInvoice, so this filter naturally excludes those. */
  uploadBatchId?: string;
  /** Case-insensitive. See MandateTransactionStateFilter for the full vocabulary, including the HELD/OPEN/CLOSED aliases. */
  state?: MandateTransactionStateFilter;
  /** Exact match against the resolved Compliance Mandate, e.g. "FR_EINVOICING", "FR_EREPORTING", "ES_SII", "NONE". */
  mandate?: string;
  /** Exact match against the reporting period key, e.g. "2026-09-D1" for a France décade. */
  period?: string;
  /** ISO-3166-1 alpha-2, exact match, case-insensitive. */
  country?: string;
  /** YYYY-MM-DD — issue_date >= this date. */
  from?: string;
  /** YYYY-MM-DD — issue_date <= this date. */
  to?: string;
  page?: number;
  limit?: number;
  entityId?: string;
}

export type MandateTransactionTerminalArtifact =
  | { type: 'einvoice'; einvoicingRecordId: string; clearanceStatus: string; clearanceStatusLabel: string; terminal: boolean; referenceId: string | null; ksefNumber: string | null; clearedAt: string | null; rejectedAt: string | null }
  | { type: 'period'; periodId: string; periodKey: string; periodStatus: string; closedAt: string | null; submittedAt: string | null; filedAt: string | null }
  | { type: 'recorded_only' }
  | null;

export interface MandateTransaction {
  id: string;
  entityId: string;
  country: string;
  sourceChannel: string;
  idempotencyKey: string;
  state: string;
  issueDate: string | null;
  taxPointDate: string | null;
  paymentDate: string | null;
  currency: string | null;
  totalNet: number | null;
  totalTax: number | null;
  totalGross: number | null;
  amountDue: number | null;
  supplierTaxId: string | null;
  customerTaxId: string | null;
  isLate: boolean;
  isRectification: boolean;
  rectifiesTransactionId: string | null;
  dispatchedAt: string | null;
  createdAt: string;
  updatedAt: string;
  mandate: string | null;
  mandateClass: string | null;
  /** Free-text reason this row is held or needs info — e.g. HELD_UNMAPPED_TAX_CODE's message naming the missing client tax code. Null for a row that was never held. */
  holdReason: string | null;
  /** Who must act to clear a held/needs-info row: 'platform' (an engineering/config gap) or 'customer' (a data gap only the merchant can fill, e.g. createClientTaxCode). Null for a row that was never held. */
  actionOwner: string | null;
  reportByDate: string | null;
  provenance: {
    matchedRuleId: string | null;
    matchedRuleVersion: string | null;
    resolvedAt: string | null;
    matchedRule: { country: string; movement: string | null; customerType: string | null; description: string | null } | null;
  };
  period: {
    id: string;
    periodKey: string;
    periodStart: string | null;
    periodEnd: string | null;
    status: string;
    closedAt: string | null;
    submittedAt: string | null;
    filedAt: string | null;
    latestSubmissionAttempt: { status: string; receiptReference: string | null; error: string | null; createdAt: string | null } | null;
  } | null;
  terminalArtifact: MandateTransactionTerminalArtifact;
}

export interface ListMandateTransactionsResponse {
  transactions: MandateTransaction[];
  pagination: { total: number; page: number; limit: number; pages: number; hasNext: boolean; hasPrev: boolean };
}

// ── Bulk CSV ingestion (POST /v1/send/bulk, GET /v1/send/bulk/{batchId},
// GET /v1/send/bulk/{batchId}/errors) ───────────────────────────────────────
// The public API used to split sync/async across two endpoints (/send/bulk vs
// /send/bulk-async); that split was folded into one door 2026-09-18
// (unify-bulk-send-endpoint) — the server decides the real transport by
// request size regardless of which SDK method is called.

export type BulkUploadBatchStatus = 'UPLOADED' | 'VALIDATING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type BulkSendRowOutcome = 'ACCEPTED' | 'ACCUMULATED' | 'NEEDS_INFO' | 'HELD' | 'NO_OBLIGATION' | 'SKIPPED_DUPLICATE' | 'ERRORED';

export interface BulkSendRow {
  rowNumber: number;
  outcome: BulkSendRowOutcome;
  invoiceNumber?: string;
  sourceReference?: string | null;
  /** The transaction's Clearvo id when it reached dispatch. */
  recordId?: string;
  mandate?: string | null;
  clearanceStatus?: string | null;
  /** The idempotency key this row was dispatched under — present whenever the row passed structural validation, regardless of outcome. */
  idempotencyKey?: string;
  /** The row's own `country` CSV column — present under the same conditions as idempotencyKey. */
  country?: string;
  /** Set when outcome is ERRORED (or a per-row structural validation failure). */
  errorCode?: string;
  errorMessage?: string;
  /** Per-field detail for a rejection carrying one (validation-rules or a country-specific schema validator) — the field-level reasons behind a generic top-level errorMessage. */
  errorDetails?: Array<{ field?: string; message: string }>;
  /** Present only for a HELD outcome — why the row is held and who must act. */
  holdReason?: string | null;
  actionOwner?: string | null;
}

export interface BulkSendSummary {
  total: number;
  /** Rows that cleared (or are pending clearance) under a per-document mandate. */
  accepted: number;
  /** Rows folded into an aggregate reporting period. */
  accumulated: number;
  needsInfo: number;
  skippedDuplicate: number;
  held: number;
  noObligation: number;
  errored: number;
}

/** Present (non-null) only when the file had more data rows than the synchronous 500-row cap — the excess rows were hashed off, UNMODIFIED, to a brand-new async batch rather than discarded. */
export interface BulkSendContinuation {
  /** Rows past the first 500 that were handed off, never reflected in `rows`/`summary`. */
  rowCount: number;
  /** Present when the hand-off succeeded — poll getBulkUploadStatus(batchId). */
  batchId?: string;
  status?: string;
  /** Present when the hand-off itself failed — these rows were NEVER queued; resubmit them (a fresh call with only the unprocessed rows — already-completed ones dedupe safely by content). */
  error?: { code: string; message: string };
}

export interface SubmitInvoicesBulkInput {
  /** The raw CSV text (not base64) — header row plus up to 500 data rows for the synchronous transport. */
  csvContent: string;
  /** Required for account-scoped keys; omit for entity-scoped keys. */
  entityId?: string;
}

export interface SubmitInvoicesBulkAsyncInput {
  /** The raw CSV text (not base64) — no row-count ceiling enforced client-side (the route itself bounds total upload size). */
  csvContent: string;
  /** Optional filename to record against the batch. Ignored if the file ends up processed synchronously. */
  filename?: string;
  entityId?: string;
}

/** Returned when the upload was processed synchronously in-request (the whole file fit under the 500-row/25MB cap). */
export interface SubmitInvoicesBulkResponse {
  ok: boolean;
  summary: BulkSendSummary;
  rows: BulkSendRow[];
  continuation: BulkSendContinuation | null;
}

/** Returned by submitInvoicesBulkAsync when the file was queued rather than processed synchronously. status is 'UPLOADED' for a freshly-queued batch; on a `duplicate: true` response it reflects whatever status the pre-existing matched batch is actually in (VALIDATING/COMPLETED/FAILED/CANCELLED), not necessarily 'UPLOADED'. */
export interface SubmitInvoicesBulkAsyncQueuedResponse {
  ok: boolean;
  batchId: string;
  status: BulkUploadBatchStatus;
  /** True means this exact file was already processed by an earlier call — nothing new was queued. */
  duplicate?: boolean;
}

export interface GetBulkUploadStatusResponse {
  batchId: string;
  status: BulkUploadBatchStatus;
  filename: string | null;
  uploadedBy: string | null;
  total: number;
  /** Same keys as the synchronous response's per-row `outcome` field. Zero for any outcome this batch had no rows land in. */
  outcomeCounts: Partial<Record<BulkSendRowOutcome, number>>;
  /** e.g. "4,102 added to a filing, 12 missing information, 3 errored" — always derived from outcomeCounts. */
  summary: string;
  outcomeLabels: Record<BulkSendRowOutcome, string>;
  createdAt: string;
  validatedAt: string | null;
  completedAt: string | null;
}

export interface BulkUploadStructuralErrorRow {
  rowNumber: number;
  errorCode: string;
  errorMessage: string | null;
  rawRow: Record<string, unknown>;
  createdAt: string;
}

export interface ListBulkUploadErrorsParams {
  /** Page number, 1-based (default 1). */
  page?: number;
  /** Results per page (default 50, max 200). */
  limit?: number;
  entityId?: string;
}

export interface ListBulkUploadErrorsResponse {
  batchId: string;
  status: BulkUploadBatchStatus;
  page: number;
  limit: number;
  total: number;
  errors: BulkUploadStructuralErrorRow[];
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
  /** True when this call ran against the sandbox environment — matches the API key used, not a
   *  request field. Sandbox always reads every capability (and credentialStatus) as 'sandbox',
   *  regardless of platform configuration. */
  sandbox: boolean;
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
  /** Static follow-on actions this response documents, never performed automatically — today only ever the
   *  e-reporting PATCH, shown to every caller (seller or buyer) since this endpoint has no way to know
   *  whether the registering entity has an e-reporting obligation; read nextSteps[].applicableTo before
   *  assuming it applies. Inbound receiving starts automatically once einvoicing shows active — no separate
   *  step needed (code review finding, 2026-09-22: the previous wording told every buyer-side integrator to
   *  disregard e-reporting for every client, which this endpoint cannot determine on the caller's behalf). */
  nextSteps: FrNextStep[];
  /** One plain-language sentence summarising both capabilities. */
  message: string;
  /** When this entity's French tax registration was first created. */
  createdAt: string | null;
  /** When this entity's French tax registration was last written — this POST, if it changed
   *  anything. Null only on a GET for an entity with no French registration yet. */
  updatedAt: string | null;
}

// ── Italy profile field (Regime Fiscale) ────────────────────────────────────
// Not a credential — Clearvo (Blue Arrow Solutions) is the accredited SDI
// intermediary, so Italy has no per-entity credential to register at all.
// Regime Fiscale is a required PROFILE field the FatturaPA generator reads
// at send time; this is the SDK's way to set it ahead of time instead of
// discovering the gap as a failed send.

export interface ItRegimeFiscaleOption {
  value: string;
  label: string;
}

export interface SetItProfileInput {
  /** Regime Fiscale code, e.g. 'RF01'. Call getItProfile first to see the full option list. */
  regimeFiscale: string;
  /** Entity to configure. Required for account-scoped keys; omit for entity-scoped keys. */
  entityId?: string;
}

export interface ItProfileResponse {
  entityId: string;
  /** False when the entity has no current Italy tax registration on file at all — setItProfile
   *  is guaranteed to reject with 422 MISSING_IT_REGISTRATION in that state; register one via
   *  the Tax Registrations API first. */
  hasItRegistration: boolean;
  /** True once regimeFiscale is set. */
  configured: boolean;
  /** null until a value has been set. */
  regimeFiscale: string | null;
  /** The full set of valid Regime Fiscale codes with labels. */
  options: ItRegimeFiscaleOption[];
}

// ── Business (customer-lifecycle) status ────────────────────────────────────
// Mirrors PATCH /v1/invoices/{id}/business-status — the one shared route
// every registered regime goes through: France (partner push via the
// Marosa/PPF bridge), Germany (platform-only decision, no partner push),
// and Brazil (Manifestação do Destinatário, committed synchronously through
// a signed SEFAZ event registration). Only valid for an INBOUND (received)
// invoice — the calling entity is the customer recording their own
// decision on it. Only the values belonging to the invoice's own
// country/regime are ever a valid transition for it — check
// businessStatusActions on the invoice itself before guessing from this
// union alone.

export type BusinessStatus =
  | 'IN_HAND'
  | 'APPROVED'
  | 'PARTIALLY_APPROVED'
  | 'DISPUTED'
  | 'SUSPENDED'
  | 'REFUSED'
  | 'COMPLETED'
  | 'PAYMENT_SENT'
  | 'PAYMENT_RECEIVED'
  /** Brazil: acknowledge receipt (Ciência da Operação). Auto-registered by Clearvo when autoCiencia is on. */
  | 'CIENCIA'
  /** Brazil: confirm the operation occurred (Confirmação da Operação). */
  | 'CONFIRMACAO'
  /** Brazil: the operation did not occur — rejectionDetail.message required (15–255 characters). */
  | 'OPERACAO_NAO_REALIZADA'
  /** Brazil: "I don't recognize this transaction" — rejectionDetail is forbidden (SEFAZ's own event schema has no field for one). */
  | 'DESCONHECIMENTO'
  /** Brazil only, never a valid PATCH target: the day-90 deemed-acceptance presumption SEFAZ's own statutory silence writes, not a customer request. Readable on GET, listed here only so a caller checking `=== 'PRESUMIDA'` type-checks. */
  | 'PRESUMIDA';

/** The shared, regime-agnostic bucket every registered regime's native BusinessStatus value maps onto. */
export type CanonicalBusinessStatus = 'RECEIVED' | 'ACKNOWLEDGED' | 'ACCEPTED' | 'DISPUTED';

export interface UpdateBusinessStatusInput {
  /** Invoice id or referenceId of a received (inbound) invoice. */
  id: string;
  status: BusinessStatus;
  /** Required when status is DISPUTED, REFUSED, or SUSPENDED (FR/DE — reason required), or
   *  OPERACAO_NAO_REALIZADA (Brazil — message required, 15–255 characters; reason accepted but never
   *  required). Forbidden for Brazil's DESCONHECIMENTO. Also accepted as a bare string (treated as message). */
  rejectionDetail?: { reason?: string; message?: string } | string;
  /** Entity that owns the invoice. Required for account-scoped keys; omit for entity-scoped keys. */
  entityId?: string;
}

export interface UpdateBusinessStatusResponse {
  ok: boolean;
  /** The invoice's new native status value. */
  businessStatus: BusinessStatus;
  /** The shared, regime-agnostic bucket this new value maps onto. Brazil: CIENCIA→ACKNOWLEDGED,
   *  CONFIRMACAO/PRESUMIDA→ACCEPTED, OPERACAO_NAO_REALIZADA/DESCONHECIMENTO→DISPUTED. */
  canonicalBusinessStatus?: CanonicalBusinessStatus;
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

// ── Rules Engine (B7 propagation, docs/features/rules-engine/discovery.md) ──
// SDK twins of every /v1/rules-engine/* operation (docs/openapi/rules-engine.yaml
// on the backend) plus the AP manual-adjustments surface
// (/v1/tax/calculate/{id}/adjustments, /adjustment-options). Scope (Entity vs
// Organisation) is always derived server-side from the API key — never a
// request field here.

export type RuleDomain = 'ap' | 'ar';
export type RuleRecordType = 'calculation' | 'purchase_order' | 'invoice';
export type RuleKind = 'NORMALIZATION' | 'ENRICHMENT' | 'ADJUSTMENT' | 'WARNING' | 'ERROR';
export type RuleStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type RuleLegalBasisTag = 'LEGAL_MANDATE' | 'BUSINESS_POLICY';

export interface RuleCondition {
  property: string;
  operator: string;
  value?: unknown;
}

export interface RuleAction {
  property: string;
  /** A literal value to write. Mutually exclusive with `fn`. */
  value?: unknown;
  /** A closed function dispatch (see getRulesEngineSchema()'s `fns`). Mutually exclusive with `value`. */
  fn?: string;
  args?: Record<string, unknown>;
}

/** The one Rule shape returned by every rules-engine mutation/read — createRule/updateRule/activateRule/moveRule/getRule/each entry of listRules(). */
export interface Rule {
  id: string;
  tenantId: string | null;
  organisationId: string | null;
  entityId: string | null;
  domain: RuleDomain;
  recordType: RuleRecordType;
  ruleKind: RuleKind;
  code: string;
  name: string;
  description: string | null;
  status: RuleStatus;
  enabled: boolean;
  legalBasisTag: RuleLegalBasisTag;
  sortOrder: number;
  conditions: RuleCondition[];
  actions: RuleAction[];
  templateId: string | null;
  isSystem: boolean;
  version: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /** A citation link (legal basis, internal policy doc, ticket) — never required. */
  documentUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListRulesParams {
  /** Deprecated — prefer direction. */
  domain?: RuleDomain;
  /** Deprecated. */
  recordType?: RuleRecordType;
  /** Inclusive — returns a row explicitly conditioned on this transactionDirection PLUS every direction-less row (which applies to both). */
  direction?: 'purchase' | 'sale';
  /** Only rules with a condition on this catalog property. */
  conditionProperty?: string;
  /** Combined with conditionProperty — narrows to a condition whose value equals this. */
  conditionValue?: string;
  /** Also return this scope's Global platform-default rules as `defaults[]`/`defaultsCount` (e.g. to find one worth suppressRule()-ing). */
  includeDefaults?: boolean;
  entityId?: string;
}

export interface ListRulesResponse {
  ok: true;
  rules: Rule[];
  /** Only present when `includeDefaults: true` was passed. */
  defaults?: DefaultRuleItem[];
  /** Only present when `includeDefaults: true` was passed. */
  defaultsCount?: number;
}

/** One row of a GET listRules({ includeDefaults: true }) `defaults[]` projection — a Global platform-default the caller's scope can see and, in some cases, opt out of. */
export interface DefaultRuleItem {
  id: string;
  code: string;
  name: string;
  /** Which system authored this default — a client renders the two sources identically (same DTO shape) but never conflates their write paths: a rules_engine row can be suppressed via suppressRule(); a validation_rules row never can (readOnly is always true for it). */
  source: 'rules_engine' | 'validation_rules';
  ruleKind: string;
  /** A rules_engine default's legalBasisTag can be 'PLATFORM_INVARIANT' (never settable via createRule()/updateRule(), only ever system-authored) in addition to the two caller-settable values. */
  legalBasisTag: RuleLegalBasisTag | 'PLATFORM_INVARIANT';
  scopeLabel: string;
  /** Always true for a validation_rules row (a separate, older system with no suppression/edit path from here at all); true for a rules_engine row only when its legalBasisTag is LEGAL_MANDATE or PLATFORM_INVARIANT (nothing here can ever weaken either). */
  readOnly: boolean;
  canSuppress: boolean;
  /** Effectively suppressed for the caller RIGHT NOW (ancestor-inclusive — matches evaluator behaviour), not just "did this exact scope suppress it". */
  suppressed: boolean;
  /** True when `suppressed` is true but NOT via the caller's own exact scope — a wider scope (this entity's organisation, or its tenant) suppressed it instead. The caller cannot toggle this off directly (canSuppress is also false whenever this is true); they'd need to act from that wider scope. */
  suppressedByAncestor: boolean;
  cannotDisableReason: string | null;
  /** Rule-list-item-shaped fields so a default row can render exactly like any other rule row. A validation_rules row has no rules-engine status/enabled/conditions concept at all — it's a standing legal-mandate check, always ACTIVE/enabled, never scoped by transactionDirection, so those three are fixed rather than derived. */
  status: RuleStatus;
  enabled: boolean;
  appliesTo: { directions: ('sale' | 'purchase')[]; label: string };
}

export interface GetRuleResponse {
  ok: true;
  rule: Rule;
}

export interface CreateRuleInput {
  domain: RuleDomain;
  /** Default 'calculation'. */
  recordType?: RuleRecordType;
  ruleKind: RuleKind;
  /** Letters, numbers, underscore, dot, hyphen only. Unique per (domain, recordType, scope) — re-POSTing the same code+scope with a byte-identical body returns the EXISTING rule (200, created: false), not an error; a different body with the same code is a 409 RULE_CODE_EXISTS. */
  code: string;
  name: string;
  description?: string;
  /** Default 'BUSINESS_POLICY'. */
  legalBasisTag?: RuleLegalBasisTag;
  sortOrder?: number;
  /** Flat, ANDed array — empty (or omitted) means "always matches". */
  conditions?: RuleCondition[];
  actions?: RuleAction[];
  templateId?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  entityId?: string;
}

export interface CreateRuleResponse {
  ok: true;
  rule: Rule;
  /** false on the idempotent-replay 200 path (byte-identical re-POST of an existing code+scope). */
  created?: boolean;
}

export interface UpdateRuleInput {
  /** Optimistic concurrency — read from getRule()/listRules() first. A stale version returns a 409 ClearvoError naming the current version. */
  version: number;
  name?: string;
  description?: string;
  legalBasisTag?: RuleLegalBasisTag;
  sortOrder?: number;
  conditions?: RuleCondition[];
  actions?: RuleAction[];
  effectiveFrom?: string;
  effectiveTo?: string;
  enabled?: boolean;
  /** The only status this may ever set — a one-way, terminal retirement. Reaching ACTIVE is only ever done via activateRule(). */
  status?: 'ARCHIVED';
  entityId?: string;
}

export interface SuppressRuleParams {
  /** Optional free-text note on why this scope opted out (1-2000 chars if present). */
  reason?: string;
  entityId?: string;
}

export interface SuppressRuleResponse {
  ok: true;
  suppressed: true;
}

export interface UnsuppressRuleResponse {
  ok: true;
  suppressed: false;
}

export interface RuleVersionSnapshot {
  id: string;
  ruleId: string;
  version: number;
  snapshot: Record<string, unknown>;
  changedBy: string | null;
  createdAt: string;
}

export interface ListRuleVersionsResponse {
  ok: true;
  versions: RuleVersionSnapshot[];
}

export interface SimulateSampleEntry {
  recordId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface SimulateConflict {
  ruleId: string;
  ruleCode: string;
  property: string;
}

export interface SimulateRuleDraft {
  domain?: RuleDomain;
  recordType?: RuleRecordType;
  ruleKind?: RuleKind;
  conditions?: RuleCondition[];
  actions?: RuleAction[];
}

export interface SimulateRuleInput {
  /** How many of the most recent records to sample against (1-500, default 50). */
  sampleSize?: number;
  /** Required when simulating a not-yet-saved rule (no ruleId in simulateRule's own argument); optional override when simulating an existing rule's in-flight edit. */
  draft?: SimulateRuleDraft;
  entityId?: string;
}

export interface SimulateRuleResponse {
  ok: true;
  matchedCount: number;
  sampleSize: number;
  sample: SimulateSampleEntry[];
  conflicts: SimulateConflict[];
}

export interface RulePropertyDefinition {
  id: string;
  tenantId: string | null;
  organisationId: string | null;
  entityId: string | null;
  /** The catalog path a condition/action actually names, e.g. "customProperties.glAccount". */
  property: string;
  propertyKey: string;
  label: string;
  dataType: 'string' | 'number' | 'boolean';
  appliesTo: 'line' | 'header';
  isWritable: boolean;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListRulePropertyDefinitionsResponse {
  ok: true;
  definitions: RulePropertyDefinition[];
}

export interface CreateRulePropertyDefinitionInput {
  /** Must start with a letter; letters/numbers/underscore only. */
  propertyKey: string;
  label: string;
  dataType: 'string' | 'number' | 'boolean';
  /** Default 'line'. */
  appliesTo?: 'line' | 'header';
  /** Default true. false marks a derived-output fact no rule action may ever target. */
  isWritable?: boolean;
  entityId?: string;
}

export interface CreateRulePropertyDefinitionResponse {
  ok: true;
  definition: RulePropertyDefinition;
}

export type TemplateDisplayMode = 'settings_field' | 'add_row_table' | 'raw';
export type TemplateCardinality = 'single' | 'many';

export interface TemplateParamDto {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options?: readonly string[];
  helpText?: string;
  suffix?: string;
}

export interface TemplateInstanceDto {
  ruleId: string;
  status: RuleStatus;
  enabled: boolean;
  params: Record<string, unknown>;
  version: number;
}

export interface RuleTemplate {
  id: string;
  tenantId: string | null;
  organisationId: string | null;
  entityId: string | null;
  domain: RuleDomain;
  recordType: RuleRecordType;
  templateKey: string;
  name: string;
  description: string | null;
  displayMode: TemplateDisplayMode;
  cardinality: TemplateCardinality;
  surface: string | null;
  params: TemplateParamDto[];
  /** Only set for an 'add_row_table' template backed by a reference dataset (RE-5). */
  dataset: { id: string; name: string; keyColumns: string[] } | null;
  /** Every rule this scope already has for this template (0 for an unused 'many' template, 0 or 1 for 'single'). */
  instances: TemplateInstanceDto[];
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListRuleTemplatesParams {
  domain?: RuleDomain;
  recordType?: RuleRecordType;
  entityId?: string;
}

export interface ListRuleTemplatesResponse {
  ok: true;
  templates: RuleTemplate[];
}

export interface GetRuleTemplateResponse {
  ok: true;
  template: RuleTemplate;
}

export interface InstantiateRuleTemplateInput {
  /** Keyed by the template's own paramsSchema field names — call getRuleTemplate() first to discover them. */
  params: Record<string, unknown>;
  entityId?: string;
}

export interface InstantiateRuleTemplateResponse {
  ok: true;
  rule: Rule;
  /** false when this call reused an existing 'single'-cardinality instance rather than creating a new rule. */
  created: boolean;
}

export interface RulesEngineDataset {
  id: string;
  tenantId: string | null;
  organisationId: string | null;
  entityId: string | null;
  datasetKey: string;
  name: string;
  keyColumns: string[];
  rowCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListRulesEngineDatasetsResponse {
  ok: true;
  datasets: RulesEngineDataset[];
}

export interface CreateRulesEngineDatasetInput {
  datasetKey: string;
  name: string;
  /** 1-10 column names forming this dataset's composite key. */
  keyColumns: string[];
  entityId?: string;
}

export interface CreateRulesEngineDatasetResponse {
  ok: true;
  dataset: RulesEngineDataset;
  created: boolean;
}

export interface GetRulesEngineDatasetResponse {
  ok: true;
  dataset: RulesEngineDataset;
}

export interface DatasetRow {
  id: string;
  datasetId: string;
  /** The already-joined composite key string — pass back to deleteRulesEngineDatasetRow(). */
  rowKey: string;
  rowData: Record<string, unknown>;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /** Citation — required for a Global row. */
  source: string | null;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListRulesEngineDatasetRowsParams {
  /** Default 1. */
  page?: number;
  /** Default 50, max 500. */
  limit?: number;
  entityId?: string;
}

export interface ListRulesEngineDatasetRowsResponse {
  ok: true;
  rows: DatasetRow[];
  total: number;
  page: number;
  limit: number;
}

export interface UpsertRulesEngineDatasetRowInput {
  /** Must include a value for every one of the dataset's own keyColumns. */
  rowData: Record<string, unknown>;
  source?: string;
  verified?: boolean;
  entityId?: string;
}

export interface UpsertRulesEngineDatasetRowResponse {
  ok: true;
  row: DatasetRow;
  created: boolean;
}

export interface ImportRowDiff {
  rowKey: string;
  rowData: Record<string, unknown>;
}

export interface ImportRulesEngineDatasetInput {
  /** Raw CSV text — header row + data rows. */
  csv: string;
  /** Default true — computes and returns the diff without writing anything. Call again with dryRun:false to apply that same diff (recomputed fresh, never a stale snapshot). */
  dryRun?: boolean;
  entityId?: string;
}

/** dryRun:true (or omitted) response — the computed diff, nothing written yet. */
export interface ImportRulesEngineDatasetDryRunResponse {
  ok: true;
  dryRun: true;
  adds: ImportRowDiff[];
  changes: ImportRowDiff[];
  deletes: ImportRowDiff[];
}

/** dryRun:false response — the diff has been applied. */
export interface ImportRulesEngineDatasetAppliedResponse {
  ok: true;
  dryRun: false;
  added: number;
  changed: number;
  deleted: number;
}

export type ImportRulesEngineDatasetResponse = ImportRulesEngineDatasetDryRunResponse | ImportRulesEngineDatasetAppliedResponse;

export type MappingStatus = 'ACTIVE' | 'ARCHIVED';

export interface FieldMappingTransform {
  fn: string;
  args?: Record<string, unknown>;
}

/** One field-mapping row — the mapping-config replacement for an integration's hand-written date/address/country normalization (e.g. source system "xero"). */
export interface FieldMapping {
  id: string;
  tenantId: string | null;
  organisationId: string | null;
  entityId: string | null;
  sourceSystem: string;
  targetShape: string;
  fieldPath: string;
  sourcePath: string | null;
  transform: FieldMappingTransform | null;
  status: MappingStatus;
  enabled: boolean;
  /** false once a customer has edited it. */
  isDefault: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Field mappings are inherently per-entity — entityId is required (either directly, or via an entity-scoped key). */
export interface ListFieldMappingsParams {
  /** e.g. "xero". */
  sourceSystem: string;
  entityId?: string;
}

export interface ListFieldMappingsResponse {
  ok: true;
  rules: FieldMapping[];
}

export interface UpdateFieldMappingInput {
  sourcePath?: string;
  transform?: FieldMappingTransform;
  enabled?: boolean;
  sortOrder?: number;
  /** The only status a PATCH may ever set — retires the row. */
  status?: 'ARCHIVED';
  entityId?: string;
}

export interface GetFieldMappingResponse {
  ok: true;
  mapping: FieldMapping;
}

export interface UpdateFieldMappingResponse {
  ok: true;
  mapping: FieldMapping;
}

export interface ResetFieldMappingsResponse {
  ok: true;
  rules: FieldMapping[];
}

export interface RulesTraceEntry {
  ruleId: string;
  ruleCode: string;
  ruleVersion: number;
  ruleKind: RuleKind;
  ruleKindLabel: string;
  scopeLevel: string;
  scopeLabel: string;
  property: string | null;
  propertyLabel: string | null;
  beforeValue: unknown;
  afterValue: unknown;
  /** 'pre_calc' (this row shaped the calculation) or 'post_calc' (a read-only WARNING/ERROR observation). */
  phase: string;
  channel: string;
  createdAt: string;
  /** Backend-composed, customer-facing prose — never the raw property/kind names. */
  sentence: string;
  /** true when a more-specific same-code rule shadowed this one and its actions did NOT apply — the full trace still lists every shadowed row, explicitly marked. */
  shadowed: boolean;
}

export interface GetRulesTraceParams {
  recordType: RuleRecordType;
  /** The tax_calculations/einvoicing_records id (or purchase-order record id) to trace. */
  recordId: string;
  entityId?: string;
}

export interface GetRulesTraceResponse {
  ok: true;
  recordType: string;
  recordId: string;
  entries: RulesTraceEntry[];
}

export interface PlatformRuleChange {
  ruleId: string;
  version: number;
  code: string;
  name: string;
  domain: string;
  recordType: RuleRecordType;
  ruleKind: RuleKind;
  ruleKindLabel: string;
  /** Only 'global' or 'tenant' ever appears here. */
  scopeLevel: 'global' | 'tenant';
  scopeLabel: string;
  effectiveFrom: string | null;
  documentUrl: string | null;
  changedAt: string;
}

export interface ListPlatformRuleChangesParams {
  /** Default 50, max 200. */
  limit?: number;
  entityId?: string;
}

export interface ListPlatformRuleChangesResponse {
  ok: true;
  changes: PlatformRuleChange[];
}

/** getRulesEngineSchema()'s response — describe the rules-engine's own vocabulary. Call before authoring any rule. */
export interface RulesEngineSchema {
  ok: true;
  schema: {
    schemaVersion: string;
    domains: readonly string[];
    recordTypes: readonly string[];
    evaluatedRecordTypesByDomain: Record<string, readonly string[]>;
    ruleKinds: readonly string[];
    statuses: readonly string[];
    operators: readonly string[];
    /** @deprecated use `fns` instead, which carries `simulatesOutcome` per entry. */
    functions: readonly string[];
    fns: Array<{ fn: string; simulatesOutcome: boolean; [key: string]: unknown }>;
    properties: Array<{
      property: string;
      type: string;
      operators: readonly string[];
      writable: boolean;
      taxDeterminative: boolean;
      [key: string]: unknown;
    }>;
    source: {
      values: readonly string[];
      labels: Record<string, string>;
      /** A channel not yet populated everywhere is 'partial'. */
      coverage: Record<string, 'full' | 'partial'>;
    };
  };
}

// ── AP manual adjustments (lib/ap/manual-adjustments.ts on the backend) ────
// Propose/list/read-options only — there is no SDK method (or MCP tool) to
// confirm/revert/reject: confirming is a dedicated, admin-only, dashboard-
// only action.

export type ManualAdjustmentMode = 'FORCED_INPUT' | 'POST_CALCULATION_OVERRIDE';
export type ManualAdjustmentTargetType = 'tax_calculation' | 'tax_calculation_line' | 'einvoicing_record';
export type ManualAdjustmentStatus = 'DRAFT' | 'CONFIRMED' | 'REJECTED' | 'REVERTED';

export interface ProposeManualAdjustmentInput {
  /** FORCED_INPUT only — {property: value}, keyed by catalog property name (e.g. taxCategory, customerType). See getManualAdjustmentOptions() for the exact allowed set. */
  forcedInputs?: Record<string, unknown>;
  /** POST_CALCULATION_OVERRIDE only — {column: value}, keyed by DB column name (e.g. total_tax, tax_code). See getManualAdjustmentOptions() for the exact allowed set. */
  overrides?: Record<string, unknown>;
  mode: ManualAdjustmentMode;
  /** What the engine actually computed for the field(s) being changed — captured for audit comparison. */
  originalValue: Record<string, unknown>;
  /** Mandatory — why this adjustment is being made. */
  reason: string;
  /** Effectively required for POST_CALCULATION_OVERRIDE. */
  documentUrl?: string;
  /** Default 'tax_calculation'. */
  targetType?: ManualAdjustmentTargetType;
  /** Overrides the calculationId path segment as the actual target id — only needed when targeting something other than the calculation itself. */
  targetId?: string;
  /** Set for a line-level FORCED_INPUT adjustment — the line's own wire id from the original calculateTax() request. */
  targetLineId?: string;
  entityId?: string;
}

export interface ProposeManualAdjustmentResponse {
  ok: true;
  adjustmentId: string;
}

export interface ManualAdjustment {
  id: string;
  entityId: string;
  targetType: ManualAdjustmentTargetType;
  targetId: string;
  targetLineId: string | null;
  mode: ManualAdjustmentMode;
  forcedInputs: Record<string, unknown> | null;
  overrides: Record<string, unknown> | null;
  originalValue: Record<string, unknown>;
  resultingRecordId: string | null;
  status: ManualAdjustmentStatus;
  reason: string | null;
  documentUrl: string | null;
  createdBy: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  revertedBy: string | null;
  revertedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
}

export interface ListManualAdjustmentsResponse {
  ok?: true;
  adjustments: ManualAdjustment[];
}

/** The backend-owned closed option lists for proposeManualAdjustment() — call before proposing rather than guessing a property name. */
export interface ManualAdjustmentOptions {
  modes: ManualAdjustmentMode[];
  targetTypes: ManualAdjustmentTargetType[];
  forcedInputProperties: {
    header: string[];
    line: string[];
  };
  overrideColumns: string[];
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

// ── Customs duties (POST /v1/duties/quote and the duties block on calculate) ────

/** Scheme of a customs commodity code. */
export type DutyCodeScheme = 'HS6' | 'CN8' | 'TARIC10' | 'UK10' | 'HTS10';

/** A dispatch address on a calculation. */
export interface TaxCalcShipFrom {
  country: string;
  region?: string;
  postalCode?: string;
  line1?: string;
  line2?: string;
  city?: string;
  /** `'bonded'`: goods held under customs control, so leaving them is a customs crossing even within one territory. Default `'free_circulation'`. */
  customsStatus?: 'free_circulation' | 'bonded';
}

/** Request-side duty controls (`TaxCalculateRequest.duties`). */
export interface DutiesRequest {
  /** Quote duties on this call; false suppresses them even when `dutiesEnabled` is on. */
  include: boolean;
  /** Ask for the estimated import charges to be collected at checkout. Requires `include: true`. */
  collectDeposit?: boolean;
  /** ISO 3166-1 alpha-2 origin for lines that name none. */
  defaultCountryOfOrigin?: string;
  /** How a six-digit code spanning several national tariff lines is resolved. A collected deposit always uses the highest rate. */
  ratePolicyForHs6?: 'modal' | 'highest';
}

/**
 * How a duty measure is charged: a closed union discriminated by `type`.
 * Ad valorem values are percent (16.5 = 16.5%). Nested nodes go at most six
 * levels deep. The root node may carry `not_if_measure_type_in`.
 */
export type DutyRateExpression = (
  | { type: 'ad_valorem_pct'; value: number }
  | { type: 'top_up_to_pct'; value: number }
  | { type: 'flat'; amount: number; currency: string }
  | { type: 'specific'; amount: number; currency: string; per: string }
  | { type: 'compound'; parts: DutyRateExpression[] }
  | { type: 'alternative'; mode: 'greater_of' | 'lesser_of'; options: DutyRateExpression[] }
  | { type: 'min_max'; base: DutyRateExpression; min?: DutyRateExpression; max?: DutyRateExpression }
) & { not_if_measure_type_in?: string[] };

/** Why `estimate` is true. Empty if and only if `estimate` is false. */
export type DutyEstimateReason =
  | 'precision_below_tariff_line' | 'origin_unknown' | 'origin_measures_apply' | 'fx_static' | 'measure_not_in_force'
  | 'preference_not_considered' | 'entry_type_assumed' | 'regime_threshold_near_boundary' | 'tax_treatment_mismatch'
  | 'quantity_missing' | 'b2c_personal_value_factor' | 'import_tax_rate_missing' | 'delegated_fee_missing';

/** How exactly a line was priced. The last three are never collected from a buyer. */
export type DutyPrecision =
  | 'TARIFF_LINE' | 'HS6_EXACT' | 'HS6_AMBIGUOUS' | 'PLATFORM_CODE' | 'CATEGORY_PROXY' | 'CHAPTER_PROXY' | 'UNRESOLVED';

export type DutyCodeSource = 'request' | 'catalogue' | 'platform_code' | 'category_proxy' | 'chapter_proxy' | 'none';
export type DutyOriginSource = 'request' | 'catalogue' | 'entity_default' | 'unknown';
export type DutyDegradedReason = 'fx_rate_missing' | 'territory_content_missing' | 'content_unavailable' | 'internal_error';
export type DutyNotApplicableReason = 'no_customs_crossing' | 'ship_from_unknown';
export type DutyCollectionReason =
  | 'collected' | 'not_requested' | 'precision_too_low' | 'seller_responsible' | 'importer_of_record_unresolved'
  | 'regime_vat_at_checkout' | 'measures_not_evaluated';

/** Outcome of the duty calculation. */
export interface DutiesBlock {
  status: 'quoted' | 'not_applicable' | 'degraded' | 'disabled';
  /** Present when `status` is not `'quoted'`. */
  reason?: DutyNotApplicableReason | DutyDegradedReason | 'no_goods_lines' | 'credit_note' | 'classification_unresolved' | 'not_enabled';
  /** The duty content version the quote was computed from; omitted when degraded or not applicable. */
  contentVersion?: number;
  /** Present when any amount used the static FX table, which is not live. */
  fx?: { source: 'static' };
}

/** A measure family that exists but could not be evaluated; it blocks collection. */
export interface DutyNotEvaluated {
  familyCode: string;
  measureType: string;
  reason: 'not_in_force' | 'origin_unknown' | 'invalid_rate_expression';
  legalStatus?: string;
}

/** One duty measure applied to a line. `type` is content-driven and open (MFN, SECTION_301_LIST_4A, ...). */
export interface DutyMeasure {
  type: string;
  /** Decimal fraction (0.165 = 16.5%) for a pure ad valorem expression; null otherwise. */
  rate: number | null;
  rateExpression: DutyRateExpression;
  /** In the transaction currency, rounded to its minor unit. */
  amount: number;
  legalBasis: string | null;
  effectiveFrom: string;
}

/** Estimated duty for one line. Never part of the line's tax. */
export interface LineDuty {
  consignmentId: string;
  commodityCode: string | null;
  scheme: DutyCodeScheme | null;
  /** Present (true) only when the scheme was inferred because the request omitted `commodityCodeScheme`. */
  schemeInferred?: true;
  codeSource: DutyCodeSource;
  /** Null when a flat or zero regime set the duty. */
  precision: DutyPrecision | null;
  origin: string | null;
  originSource: DutyOriginSource;
  customsValue: number;
  /** Sum of `measures[].amount`, or the regime's allocated flat amount. */
  amount: number;
  measures: DutyMeasure[];
  notEvaluated: DutyNotEvaluated[];
  policyApplied?: 'modal' | 'highest';
  rateRange?: { min: number; max: number };
  /** Inputs that would tighten the estimate, e.g. weight or quantity for a per-kilogram duty. */
  missingInputs: string[];
  estimateReasons: DutyEstimateReason[];
}

/** A priced consignment. Everything here is an estimate and none of it is tax. */
export interface QuotedDutyConsignment {
  id: string;
  lineIds: string[];
  status: 'quoted';
  dispatchTerritory: string | null;
  destinationTerritory: string | null;
  customsStatus: 'free_circulation' | 'bonded';
  valuation: { basis: 'FOB' | 'CIF'; goods: number; freight: number; insurance: number; customsValue: number; currency: string } | null;
  /** The low-value regime that applied (EU IOSS or Special Arrangements up to EUR 150, UK GBP 135, ...), when one did. */
  regime: {
    code: string;
    name: string;
    basis: 'intrinsic_value' | 'consignment_value';
    thresholdAmount: number;
    thresholdCurrency: string;
    comparedValue: number;
    nearThreshold: boolean;
    consequence: { vat: 'checkout' | 'border' | 'none'; duty: 'tariff' | 'zero' | 'flat_per_item' | 'flat_per_order' };
    feeCode: string | null;
    taxTreatmentMismatch: boolean;
    mismatchReason?: 'shipping_in_tax_threshold' | 'fx_nominal_in_tax_threshold' | 'seller_not_ioss_registered';
    notes: string[];
  } | null;
  duty: { total: number; source: 'tariff' | 'regime' | 'fee_rule'; feeCode?: string; estimate: boolean };
  /** Import VAT/GST estimate. Under IOSS the VAT is already in `totalTax`, so `amount` is 0 with `collection: 'checkout'`. */
  importTax: {
    label: string | null;
    collection: 'checkout' | 'border' | 'uncollected' | 'none';
    base: number;
    rate: number | null;
    amount: number;
    baseIncludes: string[];
    sellerRegistrationRequired: boolean;
    notes: string[];
  } | null;
  /** Customs-authority fees (US Merchandise Processing Fee, ...). A seller cost, never part of the buyer's amount due. */
  fees: Array<{
    code: string;
    label: string;
    amount: number;
    currency: string;
    basis: 'flat' | 'percent' | 'percent_minimum' | 'percent_maximum';
    entryType: 'formal' | 'informal' | null;
    entryTypeAssumed: boolean;
    incidence: string;
  }>;
  /** Who is the importer of record: request, then incoterms (DDP seller, else buyer), then the account default, else unresolved. */
  responsibleParty: 'seller' | 'buyer' | 'unresolved';
  responsiblePartySource: 'request' | 'incoterms' | 'entityDefault' | 'regime' | 'unresolved';
  /** Short form of `collection.collected`. */
  collectedAtCheckout: boolean;
  collection: { requested: boolean; collected: boolean; reason: DutyCollectionReason };
  /** goods + freight + insurance + duty + import tax + fees. A pricing figure, never a charge. */
  landedCost: number;
  /** The buyer-payable estimate a checkout may add for this consignment; 0 unless `collectedAtCheckout`. */
  importChargesAtCheckout: number;
  sellerBorne: { duty: number; importTax: number; fees: number; total: number };
  precision: DutyPrecision | null;
  /** False means only "no modelled source of variance"; it is never a guarantee. */
  estimate: boolean;
  estimateReasons: DutyEstimateReason[];
  notEvaluated: DutyNotEvaluated[];
  fxSource: 'static' | null;
  sellerRegistrationGap: boolean;
}

/** The consignment could not be priced. Tax is unaffected. */
export interface DegradedDutyConsignment {
  id: string;
  lineIds: string[];
  status: 'degraded';
  reason: DutyDegradedReason;
  dispatchTerritory: string | null;
  destinationTerritory: string | null;
  customsStatus: 'free_circulation' | 'bonded';
  collectedAtCheckout: false;
  estimate: true;
}

export interface NotApplicableDutyConsignment {
  id: string;
  lineIds: string[];
  status: 'not_applicable';
  reason: DutyNotApplicableReason;
  dispatchTerritory: string | null;
  destinationTerritory: string | null;
}

/** One consignment, discriminated by `status`. */
export type DutyConsignment = QuotedDutyConsignment | DegradedDutyConsignment | NotApplicableDutyConsignment;

/** Duty totals across the quoted consignments. Estimates; none of it is part of `totalTax` or `totalAmountWithTax`. */
export interface DutiesSummary {
  totalDuty: number;
  totalImportTax: number;
  totalImportFees: number;
  /** goods + freight + insurance + duty + import tax + fees. A merchant pricing figure, never a charge. */
  totalLandedCost: number;
  /** Duty, import tax and fees the seller bears (seller-responsible consignments); never part of any amount due. */
  sellerBorneImportCosts: number;
  /** Present only when some consignment is `collectedAtCheckout`. Show it as its own line, "Estimated import charges"; never as tax. */
  importChargesAtCheckout: number;
  /** Present only alongside `importChargesAtCheckout`: `totalAmountWithTax` + `importChargesAtCheckout`. Charge this when present. */
  totalAmountDue: number;
}

/**
 * Estimated import duty, import VAT/GST and customs fees for a cross-border
 * consignment. Never included in `totalTax`/`totalAmountWithTax`; see
 * `summary.importChargesAtCheckout` for the one amount a checkout may add.
 * The response of `quoteDuties()`; on `calculateTax()` the same blocks are
 * `duties`, `consignments`, `lineItems[].duty` and the duty fields of
 * `summary`. Every figure is an estimate and is not guaranteed: reconcile any
 * difference with the carrier or broker invoice.
 */
export interface DutiesResult {
  /** Every amount is in this currency (the request's currency). */
  currency: string;
  duties: DutiesBlock;
  consignments?: DutyConsignment[];
  /** Only the lines that carry a duty block. */
  lineItems: Array<{ id: string; duty: LineDuty }>;
  summary?: Partial<DutiesSummary>;
}

/**
 * Body of `quoteDuties()`: the `calculateTax()` body without `commit`,
 * credit-note fields, `transactionDirection: 'purchase'` and `idempotencyKey`.
 * `duties.include` is implied.
 */
export type QuoteDutiesInput = Omit<TaxCalculateRequest, 'commit' | 'idempotencyKey' | 'transactionDirection' | 'documentStage' | 'duties'> & {
  duties?: Omit<DutiesRequest, 'include'> & { include?: true };
};
