#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'crypto';

// White-label tenants get their own branded env var names instead of CLEARVO_*.
// CLEARVO_API_KEY always wins if set; otherwise the first matching tenant alias is used.
// The public API itself is not white-labeled yet — there is no separate api.taxually.com
// (it doesn't resolve) — every tenant's keys call the same shared api.clearvo.io surface.
interface WhitelabelTenant {
  apiKeyEnv: string;
  entityIdEnv: string;
  baseUrl: string;
}

const WHITELABEL_TENANTS: WhitelabelTenant[] = [
  { apiKeyEnv: 'TAXUALLY_API_KEY', entityIdEnv: 'TAXUALLY_ENTITY_ID', baseUrl: 'https://api.clearvo.io/v1' },
];

function resolveCredentials(): { apiKey: string | undefined; entityId: string | undefined; baseUrl: string } {
  if (process.env.CLEARVO_API_KEY) {
    return {
      apiKey: process.env.CLEARVO_API_KEY,
      entityId: process.env.CLEARVO_ENTITY_ID,
      baseUrl: process.env.CLEARVO_BASE_URL ?? 'https://api.clearvo.io/v1',
    };
  }
  for (const tenant of WHITELABEL_TENANTS) {
    const apiKey = process.env[tenant.apiKeyEnv];
    if (apiKey) {
      return {
        apiKey,
        entityId: process.env[tenant.entityIdEnv],
        baseUrl: process.env.CLEARVO_BASE_URL ?? tenant.baseUrl,
      };
    }
  }
  return { apiKey: undefined, entityId: undefined, baseUrl: process.env.CLEARVO_BASE_URL ?? 'https://api.clearvo.io/v1' };
}

const { apiKey: API_KEY, entityId: ENTITY_ID, baseUrl: BASE_URL } = resolveCredentials();

if (!API_KEY) {
  process.stderr.write(
    'Warning: no API key is configured — tools will return a configuration error until one is set.\n' +
    'Add CLEARVO_API_KEY (or TAXUALLY_API_KEY for Taxually-branded accounts) to your MCP server env config. ' +
    'Get a key at https://app.clearvo.io/settings\n'
  );
}
if (!ENTITY_ID) {
  process.stderr.write(
    'Warning: no entity ID is configured — operations that require an entity context will fail.\n' +
    'Add CLEARVO_ENTITY_ID (or TAXUALLY_ENTITY_ID) to your MCP server env config, or use an entity-scoped API key.\n' +
    'Run the list_entities tool to find your entity ID.\n'
  );
}

async function callApi(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<unknown> {
  if (!API_KEY) {
    throw new Error(
      'No API key is configured. Add CLEARVO_API_KEY (or TAXUALLY_API_KEY) to your MCP server env and restart. ' +
      'Get a key at https://app.clearvo.io/settings'
    );
  }
  // FormData (e.g. upload_exemption_document) must not get a JSON Content-Type or
  // be stringified — fetch sets the correct multipart boundary itself when the
  // body is a FormData instance, and stringifying it would send "[object FormData]".
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers: Record<string, string> = {
    'x-api-key': API_KEY,
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    'Accept': 'application/json',
    ...extraHeaders,
  };
  // An explicit per-call x-entity-id (e.g. set_pl_credentials' entityId arg,
  // forwarded via extraHeaders) must win over the env-configured default —
  // only fall back to CLEARVO_ENTITY_ID when the call didn't specify one.
  if (ENTITY_ID && !headers['x-entity-id']) headers['x-entity-id'] = ENTITY_ID;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as Record<string, unknown>;
    const errorText = String(err.error ?? 'Unknown error');
    if (res.status === 400 && errorText.toLowerCase().includes('entity context')) {
      throw new Error(
        'This operation requires an entity context. ' +
        'Set CLEARVO_ENTITY_ID (or TAXUALLY_ENTITY_ID) in your MCP server env config, or use an entity-scoped API key. ' +
        'Run the list_entities tool to find your entity ID, then add it to the env config and restart.'
      );
    }
    const msg = [
      `HTTP ${res.status}: ${errorText}`,
      err.hint ? `Hint: ${err.hint}` : null,
      err.field ? `Field: ${err.field}` : null,
    ].filter(Boolean).join('\n');
    throw new Error(msg);
  }
  return data;
}

// Matches the 5MB limit already enforced on this repo's other document-upload
// paths (e.g. the buyer collection wizard). documentBase64 travels as a JSON
// string tool argument the LLM itself holds in context, so rejecting an
// oversized payload here — before decoding/uploading — avoids a confusing
// timeout or opaque failure further down the chain.
const MAX_EXEMPTION_DOCUMENT_BYTES = 5 * 1024 * 1024;

// Bulk CSV ingestion — matches the hosted MCP connector's own client-side pre-check against
// POST /v1/send/bulk's synchronous ceiling (Taxually-Einvoicing lib/mcp/tools.ts). The public API
// used to split sync/async across two endpoints (/send/bulk vs /send/bulk-async); that split was
// folded into one door 2026-09-18 (unify-bulk-send-endpoint) — both tool names below still exist
// (a caller who wants a guaranteed-synchronous small file vs. one who doesn't want a client-side
// size check still has a reason to pick between them), but BOTH now POST to the exact same route,
// which decides the real transport by request size regardless of which tool was called.
const MAX_BULK_ROWS = 500;
const MAX_BULK_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Data-row count of a CSV's raw text (header row excluded, blank lines ignored) — used only by
 * submit_invoices_bulk's pre-check against MAX_BULK_ROWS above, entirely client-side (no API
 * call), so a caller blowing the sync cap gets pointed at submit_invoices_bulk_async instead of a
 * confusing 413/truncated response from the route itself.
 */
function countCsvDataRows(csvContent: string): number {
  const lines = csvContent.split(/\r\n|\r|\n/).filter(line => line.length > 0);
  return Math.max(0, lines.length - 1);
}

/** Builds the multipart/form-data body submit_invoices_bulk(_async) send to POST /v1/send/bulk — a single 'file' field carrying the raw CSV text, same field name the route expects. */
function csvFormData(csvContent: string, filename: string): FormData {
  const formData = new FormData();
  formData.append('file', new Blob([csvContent], { type: 'text/csv' }), filename);
  return formData;
}

// Shared sentences for set_fr_credentials/get_fr_credentials, kept word-for-word identical to
// their twins on the hosted MCP connector (Taxually-Einvoicing lib/mcp/tools.ts) — a sandbox key
// masks the real production activation state either way, and sandbox sends work but receiving
// cannot be exercised there at all (focus-ux-product.md M3/Q1).
const FR_SANDBOX_MASKS_ACTIVATION_NOTE =
  'With a sandbox key every capability reports sandbox, masking the real production activation ' +
  'state either way; to see production activation, call get_fr_credentials with a live read-scope key.';
const FR_SANDBOX_NO_RECEIVING_NOTE =
  'Sandbox sends are accepted locally, but inbound receiving cannot be exercised in sandbox.';

const TOOLS = [
  {
    name: 'submit_invoice',
    description:
      'Submit a B2B invoice to a national tax authority for clearance or registration. ' +
      'Required in Italy (SDI), Poland (KSeF), Romania (ANAF), Spain (SII or VeriFactu — ' +
      'whichever this entity\'s reporting obligations enrolled it in; the two are mutually ' +
      'exclusive per entity, resolved automatically, never chosen by the caller), ' +
      'Hungary (NAV), Greece (myDATA), and 20+ other countries. Also routes via Peppol for ' +
      'countries using the 4-corner network (Belgium, Netherlands, Germany B2G, etc.). ' +
      'Returns a referenceId — call poll_status to track the clearance outcome. Every ' +
      'response also carries a stable `outcome` (CLEARED/ACCUMULATED/NEEDS_INFO/HELD/REJECTED), ' +
      '`mandate`, and `reviewRequired`. A transaction the tax-mandate engine cannot map to any ' +
      'country\'s compliance rule (a configuration gap, never a data problem with this specific ' +
      'invoice) is held as `HELD_UNMAPPED_DECISION` for ANY country — not Spain-specific — with ' +
      '`holdReason`/`actionOwner` (\'platform\') attached; a Spain SII submission additionally ' +
      'carries `siiClassification` (book/tipoFactura/claveRegimen/ejercicio/periodo/isLate), `reportBy` ' +
      '(the AEAT deadline) and its own held/actionOwner when applicable — never the AEAT CSV, which ' +
      'only exists once AEAT answers (see get_invoice\'s siiDetail). When the entity\'s es_sii ' +
      'submissionMode is batch_auto or batch_review the response is 202 ACCUMULATED with `batchId`, ' +
      '`reportBy` and `submissionMode` — the registro joined a reporting batch instead of going to AEAT ' +
      'right away (see list_reporting_batches). ' +
      'supplier.taxId is optional — omit it and the entity\'s own registered tax ID for the ' +
      'resolved country is applied automatically (an entity can hold registrations in more than ' +
      'one country; the right one is derived per-invoice, not assumed from the entity\'s home ' +
      'country). If supplied, it must match that registered tax ID exactly (a country prefix ' +
      'is stripped before comparing) or the call fails with 422 SUPPLIER_TAX_ID_MISMATCH ' +
      '(`mandateCountry`/`registeredTaxId`/`suppliedTaxId`/`fixUrl`). A Spain SII/VeriFactu invoice for ' +
      'an entity with no current Spanish registration is held NEEDS_INFO (errorCode ' +
      'MISSING_SUPPLIER_REGISTRATION, fixUrl) — add the registration, then resubmit. ' +
      'Set countrySpecific.peppol.selfBilling=true for a self-billed invoice (you, the customer, ' +
      'issuing on the real seller\'s behalf) — supplier then identifies that real seller (required; ' +
      'supplierRef resolves a saved one) and customer becomes your OWN entity\'s identity instead ' +
      '(auto-derived, tax-ID-checked). See supplier/customer/countrySpecific.peppol.selfBilling below ' +
      'for the full behavior. ' +
      'Hungary (NAV) requires a valid Hungarian tax number and street address for the supplier, ' +
      'and — for any customer that is not a private individual — a customer street address plus (only ' +
      'if a Hungarian tax number is given at all) a validly-formatted one. As of 2026-09-14 any of ' +
      'these being missing or malformed fails with 422 (MISSING_HU_SUPPLIER_TAX_NUMBER, ' +
      'MISSING_HU_SUPPLIER_ADDRESS, INVALID_HU_CUSTOMER_TAX_NUMBER, MISSING_HU_CUSTOMER_ADDRESS) rather ' +
      'than a silent 200 NEEDS_INFO hold — the same behavior change applies to Germany\'s three ' +
      'XRechnung mandatory-field gates (MISSING_LEITWEG_ID, MISSING_DE_XRECHNUNG_SELLER_CONTACT, ' +
      'DE_XRECHNUNG_BIC_FORBIDDEN). An explicit customerType: \'B2C\' always maps this HU customer to NAV\'s ' +
      'PRIVATE_PERSON classification regardless of the customer\'s own country, exempting it from the ' +
      'customer-address requirement above. ' +
      'A request that still carries any of the retired `buyer`, `buyerType`, `lines[].buyerType`, ' +
      '`notifyBuyer`, or `countrySpecific.*.buyer*` keys (e.g. `countrySpecific.pl.buyerNip`) is rejected ' +
      'with 422 `{ error, details: [{ field, code, message }] }` — each detail carries ' +
      '`code: "UNKNOWN_FIELD_BUYER_RENAMED"` and a `message` naming the exact `customer`-named ' +
      'replacement — there is no silent alias. ' +
      'Line items carry `taxRate` and `taxAmount` (the platform is global — no tax-type-specific field names). A request ' +
      'that still uses the retired `lines[].vatRate` or `lines[].vatAmount` keys is rejected with 422 ' +
      '`{ error, details: [{ field, code: "UNKNOWN_FIELD_VAT_RENAMED", message }] }` naming the `tax`-named replacement — ' +
      'there is no silent alias. The other line fields are `lineNumber`, `discountPercent` | `discountAmount` (mutually exclusive), ' +
      '`unitOfMeasure` and `sellerItemId` — the retired `discount`/`unit`/`itemCode`/`exemption` line keys are rejected with 422 ' +
      '`code: "UNKNOWN_FIELD_LINE_RENAMED"` the same way. ' +
      'Call get_requirements first if unsure what fields are needed for a country. ' +
      'There is no taxCode field on a line — the EN16931 category is always a resolved OUTPUT, never ' +
      'caller-supplied. Instead: pass clientTaxCode (RECOMMENDED — your own ERP code, mapped in advance via ' +
      'create_client_tax_code / list_tax_codes), or an AUTHORITATIVE taxTreatment (exempt/out_of_scope/zero_rated/' +
      'reverse_charge) for a line with no configured code — a stated taxTreatment is mapped as-is, never overridden ' +
      'by country inference. A positive taxRate with neither is reported as a domestic taxable supply at that rate ' +
      '(the client\'s rate is authoritative and never rejected as unrecognised); a bare 0% with neither is rejected ' +
      'with 400 ZERO_RATE_NEEDS_TAX_TREATMENT — state exempt/zero_rated/reverse_charge or a clientTaxCode. An unrecognised ' +
      'clientTaxCode never rejects the invoice — it is accepted and held (clearanceStatus HELD_UNMAPPED_TAX_CODE) with a ' +
      'machine-readable reason until the code is configured. Set dryRun=true to preview each line\'s resolved ' +
      'tax decision (including a would-be HELD_UNMAPPED_TAX_CODE) without submitting anything for real.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        country: { type: 'string', description: 'ISO 3166-1 alpha-2 destination country (e.g. "IT", "PL", "DE")' },
        invoiceNumber: { type: 'string', description: 'Your invoice reference number' },
        issueDate: { type: 'string', description: 'Issue date in YYYY-MM-DD format' },
        currency: { type: 'string', description: 'ISO 4217 currency code (e.g. "EUR", "PLN", "GBP")' },
        supplier: {
          type: 'object',
          description: 'The issuing company (your entity). Pull name and taxId from your entity settings. On a self-billed invoice (countrySpecific.peppol.selfBilling: true — see below), this instead identifies the real third-party SELLER you are self-billing on behalf of, never your own entity — omitting it with no resolvable supplierRef fails with 422 MISSING_SELF_BILLING_SUPPLIER, and SUPPLIER_TAX_ID_MISMATCH never applies to it (see customer\'s own description).',
          properties: {
            name: { type: 'string' },
            taxId: { type: 'string', description: 'Optional — omit to use the entity\'s own registered tax ID for the resolved destination country automatically. If supplied, must match that registered tax ID (country prefix stripped before comparing) or the call fails with 422 SUPPLIER_TAX_ID_MISMATCH. Does not apply on a self-billed invoice, where this is the real seller\'s own tax ID, taken as supplied.' },
            address: {
              type: 'object',
              properties: {
                street: { type: 'string' },
                city: { type: 'string' },
                country: { type: 'string', description: 'ISO 3166-1 alpha-2' },
                postalCode: { type: 'string' },
              },
              required: ['city', 'country'],
            },
            supplierRef: {
              type: 'string',
              description: 'Your own reference for a previously-saved supplier (see the dashboard\'s Suppliers page, or create_supplier/update_supplier). When set, Clearvo fills in any of name/taxId/address you omit here from the saved record — fields you do supply still take precedence. Primarily used on a self-billed invoice, where this is the real seller being self-billed for.',
            },
          },
          required: ['name', 'address'],
        },
        customer: {
          type: 'object',
          description: 'The customer receiving the invoice. On a self-billed invoice (countrySpecific.peppol.selfBilling: true — see below), this is instead your OWN entity\'s identity (the buyer being self-billed for) — auto-derived when omitted, tax-ID-compared against your own registration the same way supplier normally is (422 CUSTOMER_TAX_ID_MISMATCH on a mismatch), and its Peppol endpoint identity backfilled from your entity\'s own confirmed Peppol Participant ID when omitted.',
          properties: {
            name: { type: 'string' },
            taxId: { type: 'string', description: 'Customer VAT number — strongly recommended for B2B to enable reverse charge treatment' },
            address: {
              type: 'object',
              properties: {
                street: { type: 'string' },
                city: { type: 'string' },
                country: { type: 'string', description: 'ISO 3166-1 alpha-2' },
                postalCode: { type: 'string' },
              },
              required: ['city', 'country'],
            },
            contact: {
              type: 'object',
              description: 'Customer contact details. contact.email is required for notifyCustomer to have any effect.',
              properties: {
                email: { type: 'string', description: 'Customer email — required if notifyCustomer is set (or your entity default is on) for a country where Clearvo does not deliver the invoice electronically.' },
              },
            },
            customerRef: {
              type: 'string',
              description: 'Your own reference for a previously-saved customer (see the dashboard\'s Customers page). When set, Clearvo fills in any of name/taxId/address you omit here from the saved record — fields you do supply still take precedence.',
            },
          },
          required: ['name', 'address'],
        },
        lines: {
          type: 'array',
          description: 'Invoice line items.',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              quantity: { type: 'number' },
              unitPrice: { type: 'number', description: 'Unit price excluding tax' },
              taxRate: { type: 'number', description: 'REQUIRED. Tax rate as a percentage, 0–100 (e.g. 22 for 22%) — VAT, GST or sales tax alike. Always required, even when clientTaxCode is supplied — missing or out of range is a 400 naming this field. Replaces the retired vatRate (rejected with 422 UNKNOWN_FIELD_VAT_RENAMED). A positive rate with no clientTaxCode/taxTreatment is reported as a domestic taxable supply at that rate — the client\'s rate is authoritative and never rejected as unrecognised. A bare 0% with neither is rejected with 400 ZERO_RATE_NEEDS_TAX_TREATMENT — state exempt/zero_rated/reverse_charge or a clientTaxCode; it is never guessed.' },
              taxAmount: { type: 'number', description: 'Optional tax amount for this line. Computed as taxRate × line total when omitted. Replaces the retired vatAmount (rejected with 422 UNKNOWN_FIELD_VAT_RENAMED).' },
              clientTaxCode: {
                type: 'string',
                description: 'RECOMMENDED. Your own ERP tax code (e.g. a SAP two-digit code), mapped in advance via create_client_tax_code — see also list_tax_codes. Mutually exclusive with taxTreatment. An unrecognised code for this entity does not reject the invoice — it is held (clearanceStatus HELD_UNMAPPED_TAX_CODE) with a machine-readable reason instead.',
              },
              taxTreatment: {
                type: 'string',
                enum: ['exempt', 'out_of_scope', 'zero_rated', 'reverse_charge'],
                description: 'Explicit, AUTHORITATIVE tax treatment for this line, used when clientTaxCode is omitted — it is mapped as-is, never overridden by country inference. REQUIRED whenever the line is 0% and has no clientTaxCode (a bare 0% is rejected with 400 ZERO_RATE_NEEDS_TAX_TREATMENT); a positive rate with no treatment maps to a domestic taxable supply at that rate. Cross-border/exempt/reverse-charge must be stated here, never inferred. Mutually exclusive with clientTaxCode.',
              },
              customerType: { type: 'string', enum: ['B2B', 'B2C'], description: 'Per-line override of the invoice-level customerType, consulted only when this line has no clientTaxCode.' },
              supplyType: { type: 'string', enum: ['goods', 'digital_service', 'general_service'], description: 'Consulted only when this line has no clientTaxCode — affects reverse-charge/place-of-supply treatment for cross-border B2B services. Defaults to "goods".' },
              lineNumber: { type: 'number', description: 'Optional 1-based position of this line on the invoice. Defaults to its index in lines[].' },
              discountPercent: { type: 'number', description: 'Line discount as a percentage (0–100). Mutually exclusive with discountAmount — set at most one. Replaces the retired `discount` (rejected with 422 UNKNOWN_FIELD_LINE_RENAMED).' },
              discountAmount: { type: 'number', description: 'Line discount as an absolute amount in the invoice currency, always positive. Mutually exclusive with discountPercent — set at most one.' },
              unitOfMeasure: { type: 'string', description: 'UN/ECE Recommendation 20 unit code, e.g. "EA", "HUR", "KGM". Replaces the retired `unit` (rejected with 422 UNKNOWN_FIELD_LINE_RENAMED).' },
              sellerItemId: { type: 'string', description: 'Your own item identifier / SKU for this line (EN16931 BT-155). Replaces the retired `itemCode` (rejected with 422 UNKNOWN_FIELD_LINE_RENAMED).' },
            },
            required: ['description', 'quantity', 'unitPrice', 'taxRate'],
          },
        },
        totalAmount: { type: 'number', description: 'Net total excluding tax' },
        taxAmount: { type: 'number', description: 'Total tax amount' },
        documentType: { type: 'string', enum: ['invoice', 'credit_note', 'debit_note'], description: 'Optional: "invoice" (default), "credit_note", or "debit_note"' },
        clientTaxCode: {
          type: 'string',
          description: 'RECOMMENDED. Header-level counterpart to lines[].clientTaxCode — applied to every line that supplies neither its own taxTreatment/taxRate nor its own lines[].clientTaxCode; a line\'s own value always wins.',
        },
        customerType: { type: 'string', enum: ['B2B', 'B2C'], description: 'Optional customer classification for the whole invoice — business vs. consumer. Can be overridden per line. Hungary (NAV): an explicit \'B2C\' always resolves to NAV\'s PRIVATE_PERSON customer classification regardless of the customer\'s own country, which also exempts the customer from HU\'s mandatory street-address requirement.' },
        payment: {
          type: 'object',
          description: 'Payment details.',
          properties: {
            method: { type: 'string', enum: ['bank_transfer', 'direct_debit', 'credit_card', 'cash', 'check', 'other'], description: '"direct_debit" renders SEPA payment means (UBL/CII PaymentMeansCode 59) and REQUIRES mandateReference (BT-89) — Germany also requires creditorId and debitedIban (BT-90/91). Omit for a plain credit-transfer invoice (bank_transfer, the default).' },
            iban: { type: 'string', description: 'Seller\'s IBAN for a bank_transfer invoice.' },
            bic: { type: 'string', description: 'BIC/SWIFT code. Germany (DE): FORBIDDEN on a resolved-XRechnung invoice (BR-DE-25-b) — omit this field entirely for DE, or the call fails with 422 DE_XRECHNUNG_BIC_FORBIDDEN.' },
            reference: { type: 'string', description: 'Payment reference/remittance information.' },
            prepaid: { type: 'boolean', description: 'True if the invoice has already been paid.' },
            mandateReference: { type: 'string', description: 'SEPA mandate reference identifier (BT-89, BG-19 Direct Debit). Required whenever method is "direct_debit" — max 35 characters, or the call fails 422 MANDATE_REFERENCE_TOO_LONG.' },
            creditorId: { type: 'string', description: 'SEPA bank-assigned creditor identifier / Gläubiger-ID (BT-90) — the SELLER\'s own identifier, never the customer\'s. Germany additionally requires this whenever method is "direct_debit" (KoSIT BR-DE-30).' },
            debitedIban: { type: 'string', description: 'The CUSTOMER\'s own IBAN the SEPA direct debit draws from (BT-91). Must be a real IBAN (checksum-validated) — malformed input fails 422 INVALID_DEBITED_IBAN. Germany additionally requires this whenever method is "direct_debit" (KoSIT BR-DE-31). Distinct from `iban` above, which is the seller\'s own account for a bank_transfer payment.' },
          },
        },
        correctsInvoiceId: {
          type: 'string',
          description: 'Id (from a prior submit_invoice response) of the invoice this submission corrects — either a fiscal credit_note/debit_note reversing it, or a plain resubmission re-attempting it. As of 2026-09-14, a REJECTED, UNROUTABLE, or NEEDS_INFO invoice can all be corrected this way (previously only REJECTED/UNROUTABLE could) — a NEEDS_INFO record is no longer a dead end. Must belong to the same entity and country; submit under a fresh idempotencyKey alongside this field.',
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview the resolved per-line tax decision without creating a record, generating XML, or submitting to an authority. The response echoes dryRun=true plus each line\'s taxResolution (including a would-be HELD_UNMAPPED_TAX_CODE outcome) so you can validate a clientTaxCode/taxTreatment setup before really submitting.',
        },
        notifyCustomer: {
          type: 'boolean',
          description: 'Only meaningful for countries where no authority network delivers the invoice to the customer (Spain, Portugal, France, Germany always; Italy only when the customer has no SDI routing code — i.e. B2C; Poland only when the customer has no Polish NIP — KSeF is pull-only and pull access requires the customer\'s own registered NIP). When true and customer.contact.email is set, Clearvo emails the customer a link to view/download the invoice. Omit to use the entity default (see update_entity\'s notifyCustomerByDefault); true/false here overrides that default for this invoice only. Silently ignored for countries Clearvo already delivers electronically (Peppol, Italy B2B/B2G, Poland when the customer has a NIP, Romania, Hungary, Greece, Argentina) — check the response\'s customerNotification field to see what happened.',
        },
        transactionDirection: {
          type: 'string',
          enum: ['sale', 'purchase'],
          description: 'ES SII block 3. Defaults to "sale" (this entity\'s own outbound/issued document — LFE). "purchase" records a vendor\'s document on this entity\'s received side (LFR) — Spain SII only; every other live country\'s purchase-direction submission currently resolves to no reporting mandate at all. supplier is still required and is the VENDOR/counterparty for a purchase (the entity\'s own Spanish registration is applied automatically, same derivation as the sale-side supplier.taxId rule).',
        },
        accountingDate: {
          type: 'string',
          description: 'PURCHASE documents only (transactionDirection: "purchase"), Spain SII, YYYY-MM-DD. The accounting-entry date (FechaRegContable) — anchors both the compliance-mandate effective-date gate and the received-book (LFR) submission deadline. Optional even for a purchase (falls back to issueDate when omitted), but the vendor\'s own issueDate is legally the wrong date for this gate, so supply it whenever the entity books on receipt.',
        },
        deductibleVatAmount: {
          type: 'number',
          description: 'PURCHASE documents only, Spain SII. CuotaDeducible — the deductible portion of input VAT on this purchase, always taken as given, never derived from the lines\' own charged amounts. An explicit 0 is a valid, distinct declaration (an exempt/non-deductible purchase) — NOT the same as omitting the field, which produces NEEDS_INFO naming this field.',
        },
        deductionPeriod: {
          type: 'object',
          description: 'Received book only, Spain SII. The VAT declaration period this deduction is actually taken in, when it differs from accountingDate\'s own month. Optional — omitted, the liquidation period defaults to accountingDate\'s own month.',
          properties: {
            ejercicio: { type: 'string', description: '4-digit year, e.g. "2026".' },
            periodo: { type: 'string', description: '2-digit month, e.g. "06".' },
          },
        },
        countrySpecific: {
          type: 'object',
          description: 'Country-specific invoice fields.',
          properties: {
            es: {
              type: 'object',
              description: 'Spain SII / VeriFactu fields.',
              properties: {
                duaNumber: {
                  type: 'string',
                  description: 'NumeroDUA (Documento Único Administrativo) — required, and only meaningful, when this purchase\'s tipoFactura resolves to F5 (import). Missing on an import produces NEEDS_INFO naming countrySpecific.es.duaNumber.',
                },
              },
            },
            peppol: {
              type: 'object',
              description: 'Peppol-routed invoice fields.',
              properties: {
                selfBilling: {
                  type: 'boolean',
                  description: 'Default false. Set true to mark this as a self-billing document (the customer issues on the seller\'s behalf) — switches to a self-billing CustomizationID/ProfileID and UNTDID 1001 type codes (389 invoice / 261 credit note), and swaps supplier/customer semantics (see their own descriptions above). AU/NZ use their own PINT-AUNZ self-billing profile; every other Peppol country except SG/JP uses the generic EU BIS Self-Billing 3.0 profile; silently ignored (falls back to regular billing) for SG/JP.',
                },
              },
            },
            de: {
              type: 'object',
              description: 'Germany ZUGFeRD/XRechnung fields, plus per-invoice overrides of the invoice-content-field-registry company-law facts (each falls back to the matching de_* extra_fields value on the entity\'s own DE tax registration when omitted — see update_registration).',
              properties: {
                invoiceFormat: { type: 'string', enum: ['ZUGFERD', 'XRECHNUNG'], description: 'Highest-precedence override of which DE format this invoice generates (falls back to a stored per-customer default, then per-entity default, then platform default ZUGFERD).' },
                leitwegId: { type: 'string', description: 'BT-10 German public-sector routing ID. XRECHNUNG only — falls back to the top-level buyerReference when omitted. Missing both on a resolved-XRechnung invoice fails 422 MISSING_LEITWEG_ID.' },
                legalForm: { type: 'string', description: 'DE legal-form select vocabulary (e.g. GMBH, UG, AG, SE, KGAA, EG, GMBH_CO_KG, AG_CO_KG, OHG, KG, EK, GBR, FREIBERUFLER, SOLE_TRADER, FOREIGN_BRANCH, OTHER) — case-sensitive. Gates whether the register-identity and managing-directors disclosure tiers below apply at all.' },
                handelsregisternummer: { type: 'string', description: 'BT-30. HGB § 37a commercial-register number (e.g. "HRB 12345"). Required once legalForm is a Handelsregister-registered form — missing this, registergericht, or registeredSeat never blocks the send, it returns a non-terminal errorCode MISSING_DE_COMPANY_REGISTER_DETAILS (WARNING severity).' },
                registergericht: { type: 'string', description: 'HGB § 37a register court (e.g. "Amtsgericht München") — see handelsregisternummer above for the shared MISSING_DE_COMPANY_REGISTER_DETAILS gate.' },
                registeredSeat: { type: 'string', description: 'HGB § 37a Sitz (registered seat city) — may differ from the invoice/delivery address. See handelsregisternummer above for the shared gate.' },
                geschaeftsfuehrer: { type: 'string', description: 'GmbHG § 35a / AktG § 80 managing-director or board-member names, one per line, for a legal form owing the "names tier" disclosure. Missing this never blocks the send — errorCode MISSING_DE_MANAGING_DIRECTORS, WARNING severity.' },
                kleinunternehmer: { type: 'boolean', description: '§ 19 UStG small-business exemption flag. When true, no invoice line may carry a positive tax rate — a line that does fails 422 DE_KLEINUNTERNEHMER_CHARGES_VAT (a real VAT-invoice defect, unlike the company-law WARNINGs above).' },
              },
            },
          },
        },
      },
      required: ['country', 'invoiceNumber', 'issueDate', 'currency', 'supplier', 'customer', 'lines', 'totalAmount', 'taxAmount'],
    },
  },
  {
    name: 'amend_sii_report',
    description:
      'File an AEAT Spain SII "A1" amendment against an already-registered SII invoice — a COMPLETE ' +
      'corrected re-registration of the document\'s content, submitted with the identical CustomerInvoiceInput ' +
      'shape as submit_invoice. This only builds and enqueues the amendment; it never calls AEAT directly ' +
      '(same P1/P2 split submit_invoice itself uses for Spain). Never falls back to a fresh A0 — every refusal ' +
      'below is terminal for this request. Refuses 409 SII_NOT_ACCEPTED_AT_AEAT (the record isn\'t currently ' +
      'Correcto/AceptadoConErrores), 409 SII_OPERATION_IN_FLIGHT (an earlier amend/cancel is still awaiting ' +
      'AEAT\'s answer), 409 SII_BATCH_IN_FLIGHT (a batch containing it is mid-dispatch), 409 ' +
      'AMEND_IS_RECTIFICATIVA (this is really a content correction to a rectificativa — submit a new one via ' +
      'submit_invoice instead; amending an invoice that is ALREADY a credit/debit note is fine), 409 ' +
      'AMEND_IDENTITY_CHANGE_NOT_ALLOWED (the corrected payload would change the IDFactura identity — supplier ' +
      'taxId, invoiceNumber, or issueDate must exactly match the original registro), and 422 for an obligation ' +
      'that is disabled or out of its effective date range. On success the record\'s own clearance status stays ' +
      'ACCEPTED (this never creates a new record or changes the invoice number) — only the AEAT communication ' +
      'ledger gains a new entry.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'The invoice ID (or referenceId) whose SII registration to amend — from submit_invoice or list_invoices.' },
        idempotencyKey: { type: 'string', description: 'Optional — a stable key so a retry with the same corrected content reuses the same amendment rather than filing a second A1. Omit to derive one automatically from id + the corrected invoiceNumber/issueDate.' },
        // The remaining properties are submit_invoice's own inputSchema (invoiceNumber,
        // issueDate, supplier, customer, lines, ...) — the FULL corrected document, not a
        // field-level patch. Not re-declared here field-by-field; see submit_invoice.
      },
      required: ['id'],
    },
  },
  {
    name: 'cancel_sii_report',
    description:
      'File an AEAT Spain SII Baja (withdrawal) against an already-registered SII invoice — identity-only, ' +
      'no invoice content is sent. This withdraws the SII REGISTRATION, not the invoice itself: if the invoice ' +
      'is wrong or was refunded, issue a credit note via submit_invoice instead. Idempotent: cancelling an ' +
      'already-cancelled invoice returns the stored cancelledAt rather than erroring, regardless of the ' +
      'idempotencyKey presented. Refuses 409 SII_NOT_REGISTERED_AT_AEAT when the record is not currently ' +
      'registered. On success clearance status moves to the terminal CANCELLED state.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'The invoice ID (or referenceId) whose SII registration to cancel — from submit_invoice or list_invoices.' },
        reason: { type: 'string', description: 'Optional free text (<=100 chars) — recorded for audit, never sent to AEAT (the Baja envelope itself is identity-only).' },
        idempotencyKey: { type: 'string', description: 'Optional — omit to derive one automatically from id. A same-key retry returns the stored ledger row instead of re-filing.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_sii_reconciliation',
    description:
      'Fetch one AEAT Spain SII Consulta reconciliation run — the scheduled sweep that compares this ' +
      'platform\'s own SII records against what AEAT itself reports for a (book, ejercicio, periodo). ' +
      'Read-only and scheduled — there is no way to trigger a run on demand from here. Surfaces adopted counts ' +
      '(AEAT\'s own state adopted locally for a sent-but-unanswered record), missingAtAeat (a platform-fault ' +
      'alert — registered locally as accepted but absent from AEAT\'s own view, never silently ignored), and ' +
      'mismatchedEstado — useful for a caller building an audit narrative. This reconciliation runs on a ' +
      'schedule (a Container Apps job); it never accepts a request to run now. GET /v1/sii/reconciliation ' +
      '(no id — not yet its own MCP tool) returns the latest run\'s id plus a condensed status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'The reconciliation run ID (a UUID).' },
      },
      required: ['id'],
    },
  },
  {
    name: 'poll_status',
    description:
      'Check the clearance or submission status of an invoice previously submitted via submit_invoice. ' +
      'Returns clearanceStatus: PENDING, ACCEPTED, REJECTED, DUPLICATE, UNROUTABLE, DELIVERED, UNDELIVERED, ' +
      'NEEDS_INFO, SETUP_NEEDED, or HELD_UNMAPPED_TAX_CODE (a line\'s clientTaxCode/taxTreatment isn\'t configured ' +
      'yet — see errorCode/message/reason on the original submit_invoice response, configure the code, then ' +
      'resubmit under a new idempotency key). ' +
      'NEEDS_INFO and SETUP_NEEDED are not dead ends: call submit_invoice again with correctsInvoiceId set to ' +
      'this invoice\'s id (a fresh idempotencyKey too) once the underlying data or setup gap is fixed. ' +
      'For Italy SDI, Poland KSeF, Romania ANAF: poll every 30 seconds for up to 5 minutes after submission. ' +
      'For Spain SII and real-time reporting countries (Hungary, Greece): status is usually immediate.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        referenceId: { type: 'string', description: 'The referenceId returned from submit_invoice' },
        country: { type: 'string', description: 'ISO 3166-1 alpha-2 destination country of the invoice (e.g. "IT", "PL")' },
      },
      required: ['referenceId', 'country'],
    },
  },
  {
    name: 'calculate_tax',
    description:
      'Calculate the correct tax (VAT, GST, sales tax) for a transaction across 100+ countries. ' +
      'Determines the applicable rate, treatment (standard, reverse charge, export, exempt, IOSS), ' +
      'and EN16931 tax code for each line item. Handles EU B2B reverse charge, OSS/IOSS schemes, ' +
      'US state-level sales tax, Canadian GST/HST/PST, and more. ' +
      'The clientTaxCode returned (when a matching one exists for this entity) maps directly to lines[].clientTaxCode in submit_invoice — no conversion needed; there is no taxCode field on submit_invoice. ' +
      'Calculations are recorded in the audit trail and count toward compliance thresholds by default (commit defaults to true) — set commit=false explicitly for a preview/quote that should not be recorded or billed. ' +
      'If the response\'s sellerRegistration.canCollectTax is false (e.g. $0 tax charged unexpectedly) and a ' +
      'reason string is present, surface it to the user verbatim — it explains why, e.g. a registration exists ' +
      'but has no collection start date set yet. Call set_registration_collection to fix it rather than guessing. ' +
      'Each line item can also carry taxTreatmentOverride (force a rate band) or commodityCode (tariff-driven ' +
      'lookup) — most-specific wins, above taxCategory. See those fields\' own descriptions for the precedence chain. ' +
      'Direction rule (transactionDirection, default "sale"): on a sale, the entity is the supplier and the ' +
      'counterparty goes in customer, which is REQUIRED (422 CUSTOMER_REQUIRED if omitted) — supplier is optional ' +
      'and auto-filled from your entity\'s own master data, validated against it if you do supply it (422 ' +
      'SUPPLIER_TAX_ID_MISMATCH on a mismatch). On a purchase, party roles invert: the entity is the customer and ' +
      'the counterparty (the vendor) goes in supplier, which is REQUIRED (422 SUPPLIER_REQUIRED if omitted) — ' +
      'customer is now optional and entity-side, validated the same way (422 CUSTOMER_TAX_ID_MISMATCH on a ' +
      'mismatch). seller is a deprecated alias for supplier, accepted on a sale only — rejected with 422 ' +
      'SELLER_ALIAS_NOT_ALLOWED_FOR_PURCHASE on a purchase. The response always carries both a supplier block and ' +
      'a customer block, plus top-level entityRole ("supplier" for a sale, "customer" for a purchase) telling you ' +
      'which block is your own entity.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        currency: { type: 'string', description: 'ISO 4217 currency code' },
        commit: { type: 'boolean', description: 'Default: true. When true (or omitted), records in the audit trail, updates compliance thresholds, and makes the transaction visible in the dashboard. Set to false explicitly for an ephemeral preview/quote that should not be recorded or billed.' },
        transactionDirection: {
          type: 'string',
          enum: ['sale', 'purchase'],
          description: '"sale" (default) — an outgoing transaction: the entity is the supplier, customer (the counterparty) is required. "purchase" — an incoming transaction: the entity is the customer, supplier (the counterparty, the vendor) is required. See this tool\'s own description for the full rule, including the 422 error codes for each direction.',
        },
        seller: {
          type: 'object',
          deprecated: true,
          description: 'Deprecated alias for `supplier`, accepted on a transactionDirection: "sale" calculation only (normalised to supplier before validation runs). Use `supplier` directly instead. Rejected with 422 SELLER_ALIAS_NOT_ALLOWED_FOR_PURCHASE when sent alongside transactionDirection: "purchase".',
          properties: {
            address: { type: 'object', properties: { country: { type: 'string', description: 'ISO 3166-1 alpha-2' } }, required: ['country'] },
            taxId: { type: 'string', description: 'Seller VAT number' },
          },
          required: ['address'],
        },
        supplier: {
          type: 'object',
          description: 'The supplier party. Required when transactionDirection is "purchase" — the actual vendor on the purchase invoice (422 SUPPLIER_REQUIRED if missing); only taxId and billingAddress.country are meaningful there. Optional when transactionDirection is "sale" or omitted — there it is the entity side, auto-enriched from your entity\'s own master data when omitted, validated against it if supplied (422 SUPPLIER_TAX_ID_MISMATCH on a mismatch). `ref` on a purchase resolves saved supplier master data (see list_suppliers/create_supplier), filling in name/taxId/address — unlike customer.ref on a sale, which does not resolve customer master data (see customer.ref\'s own description).',
          properties: {
            name: { type: 'string', description: 'Free-text display name. Accepted but unused for supplier resolution.' },
            taxId: { type: 'string', description: 'Supplier VAT or tax ID — used to determine cross-border reverse-charge/import treatment on a purchase, or validated against the entity\'s own registration when supplier is the entity side on a sale.' },
            ref: { type: 'string', description: 'Your own reference for this supplier (e.g. ERP vendor id). On a purchase, resolves saved supplier master data — see list_suppliers/create_supplier — filling in any of name/taxId/address you omit here. Ignored when supplier is the entity side (a sale).' },
            billingAddress: {
              type: 'object',
              description: 'The supplier\'s own country/address — the real dispatch/origin signal for cross-border purchase treatment.',
              properties: {
                country: { type: 'string', description: 'ISO 3166-1 alpha-2' },
                region: { type: 'string', description: 'State/province code, when relevant.' },
                postalCode: { type: 'string' },
              },
              required: ['country'],
            },
          },
        },
        customer: {
          type: 'object',
          description: 'The customer party. Required when transactionDirection is "sale" or omitted — the counterparty on a sale (422 CUSTOMER_REQUIRED if missing). Optional when transactionDirection is "purchase" — there it is the entity side, auto-enriched from your entity\'s own master data when omitted, validated against it if supplied (422 CUSTOMER_TAX_ID_MISMATCH on a mismatch).',
          properties: {
            b2bOverride: { type: 'boolean', description: 'Set true to force B2B treatment regardless of VAT number validation outcome. Use when you know the buyer is a business but do not have their VAT ID at checkout time. Omit for the normal flow — B2B is inferred automatically when a valid taxId is supplied.' },
            taxId: { type: 'string', description: 'Customer VAT number — triggers B2B reverse charge or zero-rating for cross-border sales' },
            ref: { type: 'string', description: 'Your own reference for this customer (e.g. CRM/ERP id). Unlike supplier.ref on a purchase, this does NOT resolve saved customer master data (name/taxId/address are not filled in). Its only effect: when the transaction\'s jurisdiction is the US and this entity uses Exemption Certificate Management (ECM), Clearvo looks up an active exemption certificate on file for this ref and auto-applies it. No effect outside the US or with no matching certificate.' },
            billingAddress: {
              type: 'object',
              properties: {
                country: { type: 'string', description: 'ISO 3166-1 alpha-2' },
                region: { type: 'string', description: 'State/province code — REQUIRED for US (e.g. "CA", "NY", "TX"). Optional but recommended for Canada.' },
                postalCode: { type: 'string', description: 'Used to detect special VAT territories (Canary Islands, Åland, Madeira, etc.)' },
              },
              required: ['country'],
            },
          },
        },
        lineItems: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Your line item ID' },
              amount: { type: 'number', description: 'Line total in the transaction currency. Supply either amount, or unitPrice with quantity — not both.' },
              unitPrice: { type: 'number', description: 'Per-unit price in the transaction currency. Alternative to amount: the line total is computed as unitPrice × quantity (rounded once), so you do not pre-multiply and absorb per-unit rounding. Requires quantity. Supply either amount, or unitPrice with quantity — not both.' },
              quantity: { type: 'number', description: 'Number of units. Required when unitPrice is supplied (the two define the line total); informational when amount is supplied directly.' },
              productName: { type: 'string', description: 'Product or service name — used for AI tax category classification if taxCategory not provided' },
              productCode: { type: 'string', description: 'Optional SKU or product code. When provided, the classification result is cached per account so the same product is not re-classified on every transaction.' },
              taxCategory: { type: 'string', description: 'Optional explicit category slug (e.g. saas_business, digital_general, physical_goods_general, professional_services). Skips AI classification.' },
              taxTreatmentOverride: { type: 'string', enum: ['STANDARD', 'REDUCED', 'SECOND_REDUCED', 'SUPER_REDUCED', 'ZERO', 'EXEMPT'], description: 'Caller-forced rate band for this line — names a band only, never a raw rate; the actual percentage is still resolved for the line\'s jurisdiction. Highest-precedence input to rate-band resolution, checked before commodityCode. Does not affect classification, place-of-supply, or B2B/reverse-charge/exemption logic — those still run first and are unaffected.' },
              commodityCode: { type: 'string', description: 'Optional tariff/customs code for this line (HS, CN, or UK Trade Tariff — no separate scheme field needed, matching is jurisdiction-scoped by the line\'s own resolved country). Looked up hierarchy-aware against Clearvo\'s tariff-rate data (own digit precision, then progressively shorter prefixes). Consulted only when taxTreatmentOverride is absent; a total miss re-enters the ordinary taxCategory/classification cascade unchanged.' },
              exempt: { type: 'boolean', description: 'When true, the customer claims exemption for this line item with no certificate on file yet. If your entity uses Exemption Certificate Management (ECM) and customer.ref is also set, a PENDING_CERTIFICATE record is created for later review — see the response\'s pendingCertificates[].' },
              exemptionReason: { type: 'string', enum: ['RESALE', 'MANUFACTURING', 'AGRICULTURAL', 'ENERGY', 'EXEMPT_ORG', 'GOVERNMENT', 'DIRECT_PAY', 'BLANKET_OTHER'], description: 'Self-asserted reason for THIS line\'s exempt claim (e.g. captured at your own checkout) — only meaningful alongside exempt: true on this SAME line; supplying it without exempt: true on that line returns a 422. Different lines in one call may carry different reasons. Omit while exempt: true to default to BLANKET_OTHER. Echoed back on the response line item as its own exemptionReason field (never nested under exemption, which is reserved for a real certificate match).' },
            },
            required: ['id', 'productName'],
          },
        },
      },
      required: ['currency', 'lineItems'],
    },
  },
  {
    name: 'validate_tax_number',
    description:
      'Validate a business tax number against the official authority for that country. ' +
      'Returns whether the number is valid and, when available, the registered business name and address. ' +
      'Supports EU VIES (all 27 EU member states), HMRC (UK), Brreg (Norway), ABN Lookup (Australia), ' +
      'and 100+ other countries. ' +
      'Use this before issuing B2B invoices to confirm the customer\'s tax registration status ' +
      'and determine whether reverse charge applies.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code (e.g. "DE", "GB", "AU")' },
        taxNumber: { type: 'string', description: 'The tax/VAT number to validate. Include the country prefix for EU numbers (e.g. "DE123456789", "FR12345678901").' },
        registryType: { type: 'string', enum: ['vat', 'national', 'auto'], description: 'Which registry to check. "vat" = VAT registry (EU VIES for EU countries, HMRC for GB, etc.). "national" = national business registry (CBE for BE, SIREN for FR, etc.). "auto" = let the system choose based on number format. Defaults to "vat". Use "national" for Belgian enterprise numbers not visible in VIES.' },
        force: { type: 'boolean', description: 'Bypass the 30-day result cache and perform a fresh authority check. Use when you need to confirm the current registration status, e.g. after a suspected deregistration.' },
      },
      required: ['country', 'taxNumber'],
    },
  },
  {
    name: 'list_entities',
    description:
      'List the business entities registered under this Clearvo account. ' +
      'Each entity is a legal company registered for tax compliance (one VAT registration, one country of establishment). ' +
      'Returns entity IDs, names, countries of establishment, and VAT numbers. ' +
      'Use this to discover available entityId values, or to verify which entities are set up before submitting invoices.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'create_entity',
    description:
      'Create a new business entity under this Clearvo account and receive a new entity-scoped API key. ' +
      'Use this when onboarding a new legal entity, subsidiary, or client company. ' +
      'Requires an account-scoped API key (csk_live_acct_... or csk_test_acct_...). ' +
      'The returned apiKey is shown ONLY ONCE — save it immediately to a secure location. ' +
      'After creation, use the entity\'s apiKey for all invoice and tax calculation operations for that entity.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        legalName: { type: 'string', description: 'Official registered legal name of the company' },
        country: { type: 'string', description: 'Country of establishment (ISO 3166-1 alpha-2, e.g. "DE", "IE", "FR")' },
        vatNumber: { type: 'string', description: 'VAT registration number — include country prefix (e.g. "DE123456789"). Can be added later via update.' },
      },
      required: ['legalName', 'country'],
    },
  },
  {
    name: 'update_entity',
    description:
      'Update a business entity\'s name or business profile address. ' +
      'Use this to complete the "company profile" onboarding step — a complete address ' +
      '(addressLine1, city, postalCode) is required for compliance correspondence. ' +
      'Does not support vatNumber — record or change a VAT number with add_registration instead. ' +
      'Also handles confirmNoRegistrations: set true when the entity genuinely has no tax registrations ' +
      'anywhere yet (e.g. a new or pre-nexus business that only wants Compliance Radar to monitor for a ' +
      'future threshold breach) — this satisfies the "add-registration" onboarding step without a ' +
      'fabricated registration. Rejected with 422 if the entity already has a real registration on file. ' +
      'Also handles notifyCustomerByDefault — see submit_invoice\'s notifyCustomer for what this controls. ' +
      'Also handles Mexico\'s mxIngestionMode/mxIngestionStartDate — see those two properties. ' +
      'entityFacts sets facts about the entity itself (not any one country registration) — e.g. legalForm, the ' +
      'DE legal-form code (GMBH/UG/AG/SE/KGAA/EG/GMBH_CO_KG/AG_CO_KG/OHG/KG/EK/GBR/FREIBERUFLER/SOLE_TRADER/' +
      'FOREIGN_BRANCH/OTHER — see get_entity_fact_definitions for the full option list), which gates whether ' +
      'Germany\'s Handelsregister disclosures (Sitz/Handelsregisternummer/Registergericht/managing-director ' +
      'names, set via update_registration\'s extraFields) are applicable. entityFacts is a MERGE, per key, same ' +
      '3-state contract as update_registration\'s extraFields: a string sets that key, an explicit null deletes ' +
      'it, an omitted key is left unchanged. Unlike a registration\'s extraFields, entityFacts applies to the ' +
      'entity regardless of which country it\'s registered in — set legalForm here, not via ' +
      'update_registration, even for a German entity.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        entityId: { type: 'string', description: 'The entity ID to update (from list_entities or create_entity).' },
        name: { type: 'string', description: 'Updated legal name.' },
        addressLine1: { type: 'string', description: 'Street address, line 1.' },
        addressLine2: { type: 'string', description: 'Street address, line 2 (suite, floor, etc.). Optional.' },
        city: { type: 'string', description: 'City.' },
        postalCode: { type: 'string', description: 'Postal / ZIP code.' },
        confirmNoRegistrations: { type: 'boolean', description: 'Set true to confirm this entity has no tax registrations anywhere yet (satisfies the add-registration onboarding step without a fake registration). Set false to clear a previous confirmation.' },
        notifyCustomerByDefault: { type: 'boolean', description: 'Default for submit_invoice\'s notifyCustomer behavior — see that tool\'s description. Applies whenever a submit_invoice call omits its own notifyCustomer override.' },
        mxIngestionMode: { type: 'string', enum: ['sat_pull', 'client_push'], description: 'Mexico only. sat_pull (default) — Clearvo polls SAT\'s Descarga Masiva service on this entity\'s behalf; requires an e.firma/CSD on file first (set_mx_credentials), or this is rejected with MX_CREDENTIALS_REQUIRED. client_push — the entity\'s own AP/ERP system submits CFDI XML directly (POST /mx/inbound/cfdi, not yet exposed as its own tool); no credential needed.' },
        mxIngestionStartDate: { type: 'string', description: 'Mexico only. ISO date (YYYY-MM-DD) or null — the earliest CFDI issue date (fecha de emisión) the SAT-pull poller\'s rolling lookback window considers for this entity.' },
        entityFacts: { type: 'object', additionalProperties: { type: ['string', 'null'] }, description: 'Facts about the entity itself, e.g. { "legalForm": "GMBH" } — see get_entity_fact_definitions for the known keys. A string value sets that key; an explicit null deletes it; an omitted key is left unchanged.' },
      },
      required: ['entityId'],
    },
  },
  {
    name: 'set_ar_credentials',
    description:
      'Register Argentina AFIP electronic invoicing credentials (CUIT, punto de venta, and WSFE certificate) for an entity. ' +
      'Required before submitting invoices to Argentina. ' +
      'certPem and keyPem are the AFIP-issued WSFE certificate and its private key, PEM-encoded.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        cuit: { type: 'string', description: '11-digit Argentine CUIT, no dashes or spaces.' },
        puntoDeVenta: { type: 'number', description: 'AFIP point-of-sale number, 1–9999.' },
        certPem: { type: 'string', description: 'PEM-encoded AFIP WSFE certificate, starting with -----BEGIN CERTIFICATE-----.' },
        keyPem: { type: 'string', description: 'PEM-encoded private key for the certificate.' },
        condicionIVAIssuer: { type: 'number', description: 'AFIP IVA condition code for the issuer. Defaults to 1 (Responsable Inscripto).' },
        entityId: { type: 'string', description: 'Entity to configure. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['cuit', 'puntoDeVenta', 'certPem', 'keyPem'],
    },
  },
  {
    name: 'set_pl_credentials',
    description:
      'Register Poland KSeF (Krajowy System e-Faktur) credentials for an entity: NIP and KSeF API token. ' +
      'Required before submitting invoices to Poland or polling the KSeF inbox. ' +
      'Generate the token in the KSeF taxpayer portal (ksef.mf.gov.pl) under Zarządzanie tokenami → Wygeneruj token, ' +
      'with "wysyłka faktur" and "dostęp do faktur" permissions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        nip: { type: 'string', description: '10-digit Polish NIP, no spaces or dashes.' },
        token: { type: 'string', description: 'KSeF API token from the taxpayer portal.' },
        environment: { type: 'string', enum: ['production', 'test'], description: 'Defaults to "production".' },
        entityId: { type: 'string', description: 'Entity to configure. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['nip', 'token'],
    },
  },
  {
    name: 'set_pt_credentials',
    description:
      'Register Portugal AT (Autoridade Tributária) e-invoicing credentials for an entity: the NIF, plus EITHER the ' +
      'document series registered with AT and its ATCUD validation code (invoices; optionally credit notes and debit ' +
      'notes) OR an AT webservice sub-user + password with no series — in which case FT/NC/ND series are registered ' +
      'with AT automatically (RegistarSerie/ConsultarSeries). subUser must be this entity\'s own NIF ("NIF/n") or the ' +
      'call fails with 400 PT_SUBUSER_NIF_MISMATCH. Required before issuing live Portuguese invoices — every invoice ' +
      'carries ATCUD = validationCode-sequence. Sandbox needs none of this. Re-saving without the series keeps the ' +
      'stored series (never wipes or re-registers); re-saving without the password keeps the stored password. The ' +
      'response echoes series { FT, NC, ND } (each { series, validationCode, source: manual|auto|sandbox } or null), ' +
      'seriesRegistration { status: manual|registered|pending_platform_certification|drift|none, message } and ' +
      'credentialStatus (ok|setup_needed|pending_platform_certification).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        nif:                      { type: 'string', description: '9-digit Portuguese NIF, no "PT" prefix.' },
        invoiceSeries:            { type: 'string', description: 'Series registered with AT for invoices (FT), e.g. "A2026". Letters and digits only. Omit (with subUser + password set) to have Clearvo register FT/NC/ND with AT automatically.' },
        invoiceValidationCode:    { type: 'string', description: 'ATCUD validation code AT issued for the invoice series. Required iff invoiceSeries is set.' },
        creditNoteSeries:         { type: 'string', description: 'Series registered for credit notes (NC). Without one, a live credit note holds SETUP_NEEDED (PT_SERIES_NOT_CONFIGURED) — there is no fallback onto the invoice series.' },
        creditNoteValidationCode: { type: 'string', description: 'ATCUD validation code for the credit-note series. Required iff creditNoteSeries is set.' },
        debitNoteSeries:          { type: 'string', description: 'Series registered for debit notes (ND). Without one, a live debit note holds SETUP_NEEDED (PT_SERIES_NOT_CONFIGURED) — there is no fallback onto the invoice series.' },
        debitNoteValidationCode:  { type: 'string', description: 'ATCUD validation code for the debit-note series. Required iff debitNoteSeries is set.' },
        subUser:                  { type: 'string', description: 'AT webservice sub-user in the form NIF/n (e.g. 500000000/1) — must share this entity\'s own NIF. With password and no manual series, triggers automatic AT series registration.' },
        password:                 { type: 'string', description: 'Sub-user password. Required iff subUser is set. Never returned.' },
        entityId:                 { type: 'string', description: 'Entity to configure. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['nif'],
    },
  },
  {
    name: 'set_fr_credentials',
    description:
      'Register or update the entity\'s French VAT number for e-invoicing/e-reporting onboarding. No secret is ' +
      'stored — this is a status-visibility endpoint, not a per-entity credential like the other countries below. ' +
      'The response reports status separately for two capabilities (einvoicing = sending and receiving invoices; ' +
      'ereporting = reporting sales to the tax office) since the platform connection to its interim delivery ' +
      'partner is granted per capability, not all-or-nothing. Each capability is active | pending_activation | ' +
      'sandbox; nothing further is needed from the caller while pending — re-read with get_fr_credentials to see ' +
      'when it flips. ' + FR_SANDBOX_MASKS_ACTIVATION_NOTE + ' ' + FR_SANDBOX_NO_RECEIVING_NOTE + ' ' +
      'Re-posting the same tax number is idempotent; posting a different one overwrites it and the ' +
      'response carries previousTaxNumber. The response also carries nextSteps — static, advisory follow-on ' +
      'actions this call never performs itself; applicableTo names who a step is typically for but never asserts ' +
      'a buyer-only entity is exempt — confirm the entity\'s own scope. Read each step\'s requiredInputs before ' +
      'acting on it: any field ' +
      'it lists is a null placeholder in body, not a real value — a fact about the entity\'s own tax position ' +
      'that the platform cannot determine on your behalf. effectiveFrom in particular is not the entity\'s free ' +
      'choice: it is set by the French rollout calendar according to the entity\'s own size category (or the ' +
      'later date it came into scope), and may only be brought forward, never lawfully chosen later. ' +
      'Sending that body unedited will 400; fill in a real value for each requiredInputs field first. Also ' +
      'returns sandbox (whether this write ran against the sandbox environment) and the registration\'s ' +
      'createdAt/updatedAt.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taxNumber: { type: 'string', description: 'French VAT number (numéro de TVA intracommunautaire). FR-prefixed, lowercase, spaced, or the bare 11-character SIREN+key form are all accepted and normalised.' },
        entityId: { type: 'string', description: 'Entity to configure. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['taxNumber'],
    },
  },
  {
    name: 'get_fr_credentials',
    description:
      'Read back the entity\'s French VAT number and its onboarding status — the same shape set_fr_credentials ' +
      'returns, so a caller can poll this after registering. Always returns 200, even when nothing is registered ' +
      'yet (credentialStatus "not_registered") — never 404, so a poller never has to special-case "nothing saved ' +
      'yet". Status is derived from the platform\'s own configuration, never a live check against the tax ' +
      'authority or the platform\'s delivery partner. ' + FR_SANDBOX_MASKS_ACTIVATION_NOTE + ' ' +
      FR_SANDBOX_NO_RECEIVING_NOTE + ' ' +
      'The response also carries nextSteps — static, advisory ' +
      'follow-on actions this call never performs itself; applicableTo names who a step is typically for but ' +
      'never asserts a buyer-only entity is exempt — confirm the entity\'s own scope. Read each step\'s ' +
      'requiredInputs before acting on it: ' +
      'any field it lists is a null placeholder in body, not a real value — a fact about the entity\'s own tax ' +
      'position that the platform cannot determine on your behalf. effectiveFrom in particular is not the ' +
      'entity\'s free choice: it is set by the French rollout calendar according to the entity\'s own size ' +
      'category (or the later date it came into scope), and may only be brought forward, never lawfully chosen ' +
      'later. Also returns sandbox (whether this read ran ' +
      'against the sandbox environment) and the registration\'s createdAt/updatedAt (both null when nothing is ' +
      'registered yet).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        entityId: { type: 'string', description: 'Entity to read. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
    },
  },
  {
    name: 'poll_fr_inbound',
    description:
      'Manually trigger a France inbound poll for this entity: resolve status on your own pending outbound ' +
      'submissions, and discover newly received inbound documents into your inbox. Only ever needed if you ' +
      'don\'t want to wait for the automatic every-5-minute poll. Requires set_fr_credentials to already show ' +
      'the einvoicing capability active (get_fr_credentials to check) — otherwise there is nothing to poll.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        entityId: { type: 'string', description: 'Entity to poll. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
    },
  },
  {
    name: 'update_business_status',
    description:
      'Record a customer-lifecycle ("business") status decision on a received (inbound) invoice — approve, ' +
      'partially approve, dispute, suspend, refuse, or mark paid. Only valid on an INBOUND invoice you received: ' +
      'the calling entity is the customer recording their own decision on it. For an invoice you issued, the ' +
      'other side\'s response syncs automatically once they act on their own side — there is nothing to call ' +
      'here for that direction. rejectionDetail is required when status is DISPUTED, REFUSED, or SUSPENDED. ' +
      'Fails 409 if the transition isn\'t valid from the invoice\'s current status, and 422 ' +
      '(FR_PLATFORM_ACTIVATION_PENDING) if the France platform isn\'t active yet for this entity\'s tax number — ' +
      'neither is retryable by changing the request; the status was not changed either way.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Invoice id or referenceId of a received (inbound) invoice — as returned by get_invoice or list_invoices.' },
        status: {
          type: 'string',
          enum: ['IN_HAND', 'APPROVED', 'PARTIALLY_APPROVED', 'DISPUTED', 'SUSPENDED', 'REFUSED', 'COMPLETED', 'PAYMENT_SENT', 'PAYMENT_RECEIVED'],
          description: 'The new business-lifecycle status.',
        },
        rejectionDetail: {
          type: 'object' as const,
          description: 'Required when status is DISPUTED, REFUSED, or SUSPENDED.',
          properties: {
            reason: { type: 'string', description: 'Short machine-usable reason code.' },
            message: { type: 'string', description: 'Optional human-readable detail.' },
          },
        },
        entityId: { type: 'string', description: 'Entity that owns the invoice. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['id', 'status'],
    },
  },
  {
    name: 'set_hu_credentials',
    description:
      'Register Hungary NAV Online Számla credentials for an entity: tax number and technical user details. ' +
      'Required before submitting invoices to Hungary. ' +
      'The technical user (login, password, signKey, exchangeKey) is created in the NAV Online Számla portal ' +
      '(onlineszamla.nav.gov.hu) with invoice reporting rights.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taxNumber: { type: 'string', description: '8-digit Hungarian taxpayer ID.' },
        login: { type: 'string', description: 'NAV technical user login.' },
        password: { type: 'string', description: 'NAV technical user password.' },
        signKey: { type: 'string', description: 'Signature key from the NAV technical user registration.' },
        exchangeKey: { type: 'string', description: '32 hex-character AES-128-ECB token decryption key.' },
        environment: { type: 'string', enum: ['production', 'test'], description: 'Defaults to "production".' },
        entityId: { type: 'string', description: 'Entity to configure. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['taxNumber', 'login', 'password', 'signKey', 'exchangeKey'],
    },
  },
  {
    name: 'set_eg_credentials',
    description:
      'Register Egypt ETA (Egyptian Tax Authority) electronic invoicing credentials for an entity: registration number, ' +
      'OAuth2 client ID/secret, and the entity\'s own eSeal certificate. ' +
      'Required before submitting invoices to Egypt. clientId/clientSecret are issued when this entity registers Clearvo ' +
      'as its representative ("onbehalfof") on the ETA taxpayer portal — each taxpayer grants this independently, ' +
      'there is no Clearvo-wide credential. certPem/keyPem are the entity\'s own eSeal X.509 certificate and matching ' +
      'private key, PEM-encoded — also per-entity, unlike some other countries where Clearvo signs on the customer\'s behalf.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        registrationNumber: { type: 'string', description: '9-digit ETA Registration Number.' },
        clientId: { type: 'string', description: 'ETA OAuth2 Client ID.' },
        clientSecret: { type: 'string', description: 'ETA OAuth2 Client Secret.' },
        certPem: { type: 'string', description: 'PEM-encoded eSeal X.509 certificate, starting with -----BEGIN CERTIFICATE-----.' },
        keyPem: { type: 'string', description: 'PEM-encoded RSA private key matching certPem.' },
        entityId: { type: 'string', description: 'Entity to configure. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['registrationNumber', 'clientId', 'clientSecret', 'certPem', 'keyPem'],
    },
  },
  {
    name: 'set_jo_credentials',
    description:
      'Register Jordan JoFotara (ISTD) electronic invoicing credentials for an entity: taxpayer number, income source ' +
      'sequence, and Client ID/Secret Key from the JoFotara portal\'s "Integrate Device" screen. ' +
      'Required before submitting invoices to Jordan. Note: there is no Jordan sandbox — JoFotara exposes exactly one ' +
      'operation (real invoice submission) with no side-effect-free way to verify a credential, so unlike most other ' +
      'countries these credentials are saved without a live test call. The first real submission is the first real test.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taxpayerNumber: { type: 'string', description: 'The entity\'s Jordanian ISTD taxpayer number.' },
        incomeSourceSequence: { type: 'string', description: 'Income source sequence number (تسلسل مصدر الدخل) from the JoFotara portal\'s "Integrate Device" screen — numeric.' },
        clientId: { type: 'string', description: 'Client ID ("Current ID") from the JoFotara portal.' },
        secretKey: { type: 'string', description: 'Secret Key from the JoFotara portal.' },
        entityId: { type: 'string', description: 'Entity to configure. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['taxpayerNumber', 'incomeSourceSequence', 'clientId', 'secretKey'],
    },
  },
  {
    name: 'set_mx_credentials',
    description:
      'Register Mexico e.firma (FIEL) credentials for an entity — the certificate/key pair SAT issued, NOT a CSD ' +
      '(Certificado de Sello Digital, which SAT never accepts for this purpose is refused outright). Required only ' +
      'for the sat_pull ingestion mode, where Clearvo polls SAT\'s Descarga Masiva service on the entity\'s behalf; ' +
      'the client_push mode (push_mx_cfdi) needs no credential at all. The certificate\'s own RFC must equal this ' +
      'entity\'s registered Mexico tax registration — a mismatch is refused. The password unlocks the key for this ' +
      'one save request only and is never stored. There is no sandbox test mode — there is no SAT sandbox to verify against.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        certificateBase64: { type: 'string', description: 'base64(DER-encoded X.509 .cer file), exactly as issued by SAT.' },
        keyBase64: { type: 'string', description: 'base64(DER-encoded, password-encrypted PKCS#8 .key file), exactly as issued by SAT.' },
        password: { type: 'string', description: 'The e.firma\'s password. Never stored — used once to unlock the key for this save.' },
        entityId: { type: 'string', description: 'Entity to configure. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['certificateBase64', 'keyBase64', 'password'],
    },
  },
  {
    name: 'push_mx_cfdi',
    description:
      'Push a received Mexico CFDI 4.0 document (client_push ingestion) — for an AP/ERP system that already holds ' +
      'a CFDI\'s XML, as an alternative to Clearvo polling SAT itself. Always accepted regardless of the entity\'s ' +
      'ingestion mode; no e.firma credential needed. Idempotent on the CFDI\'s own UUID: pushing an already-stored ' +
      'document returns duplicate:true, never an error. clearanceStatus PENDING means SAT has not yet published the ' +
      'document on its own backend (or was briefly unreachable) — this is never a rejection; retry later, or rely ' +
      'on the automatic recheck if sat_pull is also configured. Refused (with a coded, plain-English error) for a ' +
      'CFDI whose Receptor RFC does not match this entity\'s own registered Mexico RFC, for the generic "público en ' +
      'general"/"extranjero sin RFC" placeholder RFCs, or for anything other than CFDI 4.0.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        documentXml: { type: 'string', description: 'The raw, byte-identical CFDI 4.0 XML as received from the issuer.' },
        entityId: { type: 'string', description: 'Entity to receive this document into. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['documentXml'],
    },
  },
  {
    name: 'get_mx_sync_status',
    description:
      'Check the health of the Mexico SAT-pull poll job for an entity: when it last ran, when it last succeeded, ' +
      'and any error. status is "not_started" (never polled — normal and permanent for a client_push-only entity, ' +
      'which has no poll job at all), "ok" (a clean pass within the last 24h), "stale" (no clean pass in over 24h — ' +
      'SAT\'s own backend is often slow, this is not necessarily a problem), or "error" (the last cycle hit a hard ' +
      'failure — check the e.firma credential via set_mx_credentials). Meaningless for client_push mode.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        entityId: { type: 'string', description: 'Entity to check. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: [],
    },
  },
  {
    name: 'invite_team_member',
    description:
      'Invite a teammate to this Clearvo account by email. ' +
      'Requires an account-scoped API key. The invitee receives an email with a link to join and set up their own login. ' +
      'Use entityIds to restrict the invited member to specific business entities — omit to grant access to every entity on the account. ' +
      'Does not support role="admin" — admin invites must be sent from app.clearvo.io/settings/team by an existing owner/admin.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        email: { type: 'string', description: 'Invitee\'s email address.' },
        role: { type: 'string', enum: ['developer', 'finance', 'viewer', 'auditor'], description: 'Role granted to the invited member. "admin" is not available via this tool — invite admins from the dashboard.' },
        entityIds: { type: 'array', items: { type: 'string' }, description: 'Optional — restrict the invited member to these entity IDs. Omit for access to all entities on the account.' },
      },
      required: ['email', 'role'],
    },
  },
  {
    name: 'get_requirements',
    description:
      'Get the e-invoicing and tax requirements for a specific country. ' +
      'Returns: whether e-invoicing is mandatory and from when, supported invoice document types (invoice, credit note), ' +
      'Peppol scheme ID for that country, VAT number format description and validation regex, ' +
      'the name and portal URL of the relevant tax authority, and any important notes. ' +
      'Call this before submitting invoices to a new country to understand what is required and avoid rejections.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code (e.g. "IT", "PL", "DE", "FR")' },
      },
      required: ['country'],
    },
  },
  {
    name: 'list_invoices',
    description:
      'List invoices previously submitted through Clearvo. ' +
      'Filter by country, clearance status, or date. ' +
      'Returns submission timestamps, clearance status labels, and authority reference numbers. ' +
      'Use this to audit submitted invoices, find invoices that are still PENDING, ' +
      'or identify REJECTED invoices that need to be resubmitted. ' +
      'Paginate using the nextCursor / prevCursor values returned in each response: pass nextCursor as after_id to advance forward.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        country: { type: 'string', description: 'Filter by country code (e.g. "IT", "PL")' },
        status: {
          type: 'string',
          enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'DUPLICATE', 'UNROUTABLE', 'DELIVERED', 'UNDELIVERED'],
          description: 'Filter by clearance status',
        },
        limit:     { type: 'number', description: 'Results per page (default 25, max 100)' },
        after_id:  { type: 'string', description: 'Return invoices submitted before this invoice ID (use nextCursor from a previous response)' },
        before_id: { type: 'string', description: 'Return invoices submitted after this invoice ID (use prevCursor from a previous response)' },
        receivedAfter: { type: 'string', description: 'ISO 8601 timestamp — only invoices whose Clearvo-side received/created timestamp is strictly after this. A monotonic "what\'s new since I last checked" cursor, distinct from issueDate — most relevant for Mexico CFDIs, where SAT can publish a document days after its own issue date.' },
      },
    },
  },
  {
    name: 'get_invoice',
    description:
      'Fetch complete detail for a single invoice by its Clearvo ID or authority reference number ' +
      '(SDI IdentificativoSdI, KSeF referenceNumber, NAV ID, etc.). ' +
      'Returns everything in list_invoices plus: full event log, country authority references, ' +
      'upstream error code and message, a suggested action when the invoice was rejected, ' +
      'the submitted XML, and the invoice lines as submitted — each line carries `taxRate` and `taxAmount`, and the ' +
      'invoice total is `totalTax` (the retired `vatRate`/`vatAmount`/`totalVat` names are never returned). For a Spain SII invoice, also returns siiDetail (estado, csv, ' +
      'admissibleErrors, errorCode, xml, matchedRuleId, createdAt/updatedAt) — null for every ' +
      'non-SII invoice (a plain VeriFactu ES invoice, or any other country). ' +
      'For a Spain VeriFactu or Portugal AT invoice, also returns verificationQr (dataUrl, legend) — ' +
      'the country-mandated verification QR, rendered server-side. Null for every other country. ' +
      'For a Germany invoice, also returns supplierLegalRegistrationId (BT-30, the seller\'s Handelsregisternummer ' +
      'when applicable) and supplierAdditionalLegalInfo (BT-33, the assembled company-law disclosure string) — ' +
      'both null for every other country and for a DE seller with nothing to disclose. ' +
      'Use this to investigate a specific rejection, retrieve the XML for auditing, ' +
      'or check whether a suggested action has been applied.',
    inputSchema: {
      type: 'object' as const,
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Clearvo invoice ID or authority reference ID (SDI ID, KSeF number, etc.)' },
      },
    },
  },
  {
    name: 'list_products',
    description:
      'List the product catalogue for an entity. ' +
      'Products store pre-classified tax categories so you do not need to re-classify on every invoice. ' +
      'Returns product IDs, names, SKUs, and their assigned tax category slugs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        entityId: { type: 'string', description: 'Entity ID to list products for. Omit to use the default entity for this API key.' },
        limit: { type: 'number', description: 'Results per page (default 25, max 100)' },
        page: { type: 'number', description: 'Page number, 1-based (default 1)' },
        sort: { type: 'string', enum: ['newest', 'name', 'confidence'], description: 'Sort order: newest (default), name (A-Z), or confidence (highest AI confidence first; unconfirmed/non-AI products sort last).' },
      },
    },
  },
  {
    name: 'create_product',
    description:
      'Create a product in the catalogue. ' +
      'Storing a taxCategory on the product means calculate_tax and submit_invoice can reference the product ' +
      'by SKU and skip AI re-classification every time. ' +
      'Returns the new product ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Product or service name (e.g. "Annual SaaS Subscription")' },
        sku: { type: 'string', description: 'Your internal SKU or product code' },
        description: { type: 'string', description: 'Optional longer description' },
        taxCategory: { type: 'string', description: 'Tax category slug (e.g. saas_business, digital_general, physical_goods_general, professional_services). Use calculate_tax first to discover the right slug.' },
        entityId: { type: 'string', description: 'Entity to create the product under. Omit to use the default entity for this API key.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_product',
    description:
      'Update a product — most commonly to set or correct its tax category. ' +
      'Call this after using calculate_tax to discover the right taxCategory slug for a product, ' +
      'so future transactions use the stored category without re-classification.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        productId: { type: 'string', description: 'The product ID to update (from list_products or create_product)' },
        name: { type: 'string', description: 'Updated product name' },
        sku: { type: 'string', description: 'Updated SKU' },
        description: { type: 'string', description: 'Updated description' },
        taxCategory: { type: 'string', description: 'Updated tax category slug' },
      },
      required: ['productId'],
    },
  },
  {
    name: 'list_webhooks',
    description:
      'List registered webhook endpoints for this account. ' +
      'Shows URLs, subscribed event types, and entity scope for each webhook.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Results per page (default 50, max 200)' },
        page: { type: 'number', description: 'Page number, 1-based (default 1)' },
      },
    },
  },
  {
    name: 'create_webhook',
    description:
      'Register a new webhook endpoint to receive real-time invoice status events. ' +
      'The response includes a signing secret (shown once — store it securely) used to verify ' +
      'payload authenticity via HMAC-SHA256. ' +
      'Supported events: invoice.accepted, invoice.rejected, invoice.duplicate, invoice.undelivered, ' +
      'invoice.pending, product.classification_changed, ' +
      'held_unmapped_decision (a mandate resolution found no matching rule — held for platform review, holdReason/actionOwner attribution attached), ' +
      'accepted_with_errors (Spain SII AceptadoConErrores — AEAT registered the invoice but flagged an admissible error needing an A1 correction), ' +
      'reporting_batch.ready_for_review / reporting_batch.deadline_approaching / reporting_batch.deadline_passed / reporting_batch.overdue_reminder ' +
      '(the Spain SII reporting-batch reminder ladder for es_sii batch_auto/batch_review — payload carries batchId, book, recordCount, reportBy, daysOverdue; submissionId is the batch UUID), ' +
      '* (all events).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'HTTPS endpoint URL to deliver events to' },
        events: {
          type: 'array',
          items: { type: 'string' },
          description: 'Event types to subscribe to. Use ["*"] for all events. Options: invoice.accepted, invoice.rejected, invoice.duplicate, invoice.undelivered, invoice.pending, product.classification_changed, held_unmapped_decision, accepted_with_errors, reporting_batch.ready_for_review, reporting_batch.deadline_approaching, reporting_batch.deadline_passed, reporting_batch.overdue_reminder',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'delete_webhook',
    description: 'Deactivate a webhook endpoint by ID. The webhook will stop receiving events immediately.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        webhookId: { type: 'string', description: 'The webhook ID to deactivate (from list_webhooks or create_webhook)' },
      },
      required: ['webhookId'],
    },
  },
  {
    name: 'validate_tax_numbers_batch',
    description:
      'Validate up to 20 tax/VAT numbers in a single request. ' +
      'More efficient than calling validate_tax_number individually when processing a list of counterparties. ' +
      'Each result includes format validity, authority check status, and registered business name where available.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        items: {
          type: 'array',
          description: 'Up to 20 tax numbers to validate',
          items: {
            type: 'object',
            properties: {
              countryCode: { type: 'string', description: 'ISO 3166-1 alpha-2 country code (e.g. "DE", "GB")' },
              taxNumber: { type: 'string', description: 'The tax/VAT number to validate. Include country prefix for EU numbers.' },
            },
            required: ['countryCode', 'taxNumber'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'list_registrations',
    description:
      'List the tax registrations and obligations for an entity: VAT registrations by country, ' +
      'OSS/IOSS scheme registrations, and compliance threshold status. ' +
      'Use this to see where an entity is registered and whether it is compliant, approaching threshold, or exposed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        entityId: { type: 'string', description: 'Entity ID to query. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
    },
  },
  {
    name: 'add_registration',
    description:
      'Record a new tax registration for an entity. This covers any tax identifier issued by any tax authority ' +
      'worldwide — not just VAT: a US state sales-tax permit, GST registration, IOSS, OSS, or another local scheme ' +
      'all count. Use this whenever the entity registers with a tax authority anywhere, whether or not the ' +
      'registration number has arrived yet (omit taxNumber to self-certify the registration exists). ' +
      'IMPORTANT: a registration does not collect tax until its collection date is set — pass collectFromDate ' +
      'in this same call (ask the user whether to start immediately or on a future date) rather than leaving it ' +
      'unset; Clearvo will not apply tax for that country/state until it is. Omitting collectFromDate leaves ' +
      'collection unset — call set_registration_collection afterwards if you do that.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          enum: ['VAT', 'IOSS', 'UNION_OSS', 'NON_UNION_OSS', 'VOEC'],
          description: 'Registration type. VAT=standard per-country, IOSS=EU Import One-Stop Shop, UNION_OSS=EU OSS for registered businesses, NON_UNION_OSS=EU OSS for non-EU sellers, VOEC=Norway digital goods',
        },
        country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code. Not required for IOSS (applies EU-wide).' },
        taxNumber: { type: 'string', description: 'The registration or VAT number issued by the authority. Optional — can be added later once received. Omit to self-certify that the registration exists without yet recording the number.' },
        collectFromDate: { type: ['string', 'null'], description: 'When tax collection should start. Pass null to start immediately, or an ISO date (YYYY-MM-DD) to defer to a future date. Omit entirely to leave collection unset (call set_registration_collection later instead).' },
        entityId: { type: 'string', description: 'Entity to register. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['type'],
    },
  },
  {
    name: 'set_registration_collection',
    description:
      'Set the date from which a tax registration starts collecting tax. ' +
      'Use this after adding a registration to activate collection — without a collection date, ' +
      'Clearvo will not apply tax for that country (even if Tax Calculations is enabled). ' +
      'Pass collectFromDate as null to start collecting immediately, or as an ISO date string (YYYY-MM-DD) ' +
      'to defer collection until a future date. ' +
      'Returns the new collectionStatus: COLLECTING (if the date is today or past) or DEFERRED (if future).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        registrationId: {
          type: 'string',
          description: 'The tax number ID or obligation ID of the registration (from list_registrations — use taxNumberId or obligationId field)',
        },
        collectFromDate: {
          type: ['string', 'null'],
          description: 'ISO date string (YYYY-MM-DD) to defer collection to a future date, or null to start collecting immediately (today).',
        },
      },
      required: ['registrationId', 'collectFromDate'],
    },
  },
  {
    name: 'deregister_registration',
    description:
      'End a tax registration\'s active collection period without deleting it — the registration and its ' +
      'history remain visible via list_registrations. Use this instead of trying to delete a registration ' +
      'that is still in active use (e.g. the entity\'s home-country VAT registration or default IOSS number), ' +
      'which cannot be deleted directly. ' +
      'Pass effectiveDate as null to deregister immediately, or as an ISO date string (YYYY-MM-DD) to schedule ' +
      'the end of collection for a future date.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        registrationId: {
          type: 'string',
          description: 'The tax number ID or obligation ID of the registration (from list_registrations — use taxNumberId or obligationId field)',
        },
        effectiveDate: {
          type: ['string', 'null'],
          description: 'ISO date string (YYYY-MM-DD) to schedule deregistration for a future date, or null to deregister immediately.',
        },
      },
      required: ['registrationId', 'effectiveDate'],
    },
  },
  {
    name: 'update_registration',
    description:
      'Edit an existing tax registration\'s number and/or secondary identifiers (e.g. France\'s SIRET, Germany\'s ' +
      'Steuernummer, Handelsregisternummer, Registergericht, Sitz, managing-director names, or Kleinunternehmer ' +
      'flag) in place. Use this instead of deleting and re-adding a registration when only the number ' +
      'was wrong, missing, or a jurisdiction-specific secondary identifier needs to be added. ' +
      'Country/type cannot be changed this way. extraFields is a MERGE, not a replace, per key: a string value ' +
      'overwrites that key, an explicit null deletes it (e.g. clearing de_handelsregisternummer after changing ' +
      'the entity\'s legalForm — see update_entity\'s entityFacts — to one that no longer requires it), and an ' +
      'omitted key is left untouched. Germany (DE) accepts, in addition to de_steuernummer: de_registered_seat ' +
      '(Sitz — the city the company is legally seated in), de_handelsregisternummer (e.g. ' +
      '"HRB 12345"), de_registergericht (e.g. "Amtsgericht München"), de_geschaeftsfuehrer (managing-director/' +
      'board names, one per line), and de_kleinunternehmer ("true"/"false" — the §19 UStG small-business ' +
      'exemption flag). None of these are required to save the registration — they become required only at ' +
      'send/validate time, once the entity\'s legalForm (set via update_entity, NOT here — legal form is an ' +
      'entity-level fact, not scoped to any one country registration) makes them applicable (e.g. ' +
      'de_handelsregisternummer/de_registergericht/de_registered_seat once a Handelsregister-registered legal ' +
      'form like GmbH is set).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        registrationId: {
          type: 'string',
          description: 'The tax number ID or obligation ID of the registration (from list_registrations — use taxNumberId or obligationId field)',
        },
        taxNumber: { type: ['string', 'null'], description: 'New registration/VAT number. Pass null or an empty string to clear it. Omit entirely to leave it unchanged.' },
        extraFields: { type: 'object', additionalProperties: { type: ['string', 'null'] }, description: 'Secondary identifiers to merge in, e.g. { "fr_siret": "12345678901234" } or { "de_handelsregisternummer": "HRB 12345" }. A string value overwrites that key; an explicit null deletes it; an omitted key is left unchanged.' },
      },
      required: ['registrationId'],
    },
  },
  {
    name: 'get_registration_field_definitions',
    description:
      'Discover which extra_fields keys are known/required for a given (country, region, scheme) tuple, before ' +
      'calling add_registration/update_registration — the same lookup the dashboard\'s Add/Edit Registration form ' +
      'uses. For a registry-backed country (Germany today), each field also carries legalBasis (the statute/ ' +
      'rationale it comes from), requiredWhen (a machine-readable condition — present only when the field is ever ' +
      'enforced as required) and requiredHint (a human sentence describing that same condition), so a caller can ' +
      'tell "this field exists and can be set" apart from "this field is currently mandatory for this entity" ' +
      'without guessing. For country=US, also returns usLocalityCodes (valid home-rule locality codes) when a ' +
      'region is a home-rule state.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code, e.g. "DE".' },
        region: { type: 'string', description: 'US state code (e.g. "TX"), when relevant. Ignored for non-US countries.' },
        scheme: { type: 'string', description: 'Registration scheme, e.g. "STANDARD". Only affects the US flatRateElection field.' },
      },
      required: ['country'],
    },
  },
  {
    name: 'get_entity_fact_definitions',
    description:
      'Discover which entity-level fact keys exist (e.g. legalForm), before calling update_entity\'s entityFacts — ' +
      'the same lookup the dashboard\'s Company Details/business-profile surface uses. The fact itself is entity-' +
      'scoped, not (country/region/scheme)-scoped like get_registration_field_definitions — an entity has exactly ' +
      'one legal form regardless of which countries it\'s registered in. A select-type fact\'s VALID VALUES are ' +
      'not universal, though: options are resolved against THIS entity\'s own home/establishment country (never ' +
      'an invoice\'s destination country) — e.g. legalForm returns Germany\'s GmbH/UG/AG/... codes for a German ' +
      'entity, but free text (type: "string", no options) for a country with no curated list yet, never another ' +
      'country\'s vocabulary. Each field carries legalBasis and, where closed-vocabulary, its options list.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'list_tax_calculations',
    description:
      'List committed tax calculations (those created with commit=true). ' +
      'Shows jurisdiction, amounts, tax totals, and customer type for each calculation. ' +
      'Use this to audit the calculation history, reconcile totals, or inspect calculations ' +
      'that fed into compliance threshold monitoring.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        entityId: { type: 'string', description: 'Filter by entity ID. Required for account-scoped keys.' },
        country: { type: 'string', description: 'Filter by jurisdiction country code (e.g. "DE", "US")' },
        limit: { type: 'number', description: 'Results per page (default 25, max 100)' },
        page: { type: 'number', description: 'Page number, 1-based (default 1)' },
      },
    },
  },
  {
    name: 'get_query_fields',
    description:
      'Discover the allowlisted fields, operators, enum values, and limits for query_data, per dataset ' +
      '("einvoicing_records" or "tax_calculations"). Call this before building filters for query_data — ' +
      'it is the source of truth for what field/operator combinations are currently supported, since the ' +
      'allowlist can change over time. Also returns each dataset\'s default page size, max page size, ' +
      'max date-range span in days, and default response columns.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'query_data',
    description:
      'Ad-hoc filtered, paginated query over your own einvoicing_records or tax_calculations — the same ' +
      'engine behind the Clearvo dashboard\'s "Explore" page. Use this for self-service analysis beyond ' +
      'list_invoices/list_tax_calculations\' fixed filters: arbitrary combinations of allowlisted fields ' +
      '(date range, jurisdiction, status, tax ID, amount, etc.) via `filters`. Call get_query_fields first ' +
      'to see which fields/operators/enums are currently allowed for the chosen dataset — an unlisted field ' +
      'or operator is rejected. Requires at least one indexed filter (an unfiltered or non-indexed-only ' +
      'query is rejected to bound cost) and a date range no wider than the dataset\'s maxSpanDays. Returns ' +
      'a page of rows (hasMore/nextCursor only — no aggregate counts or sums) and never raw XML or JSONB ' +
      'internals. Rate-limited per API key, stricter than list_invoices/list_tax_calculations. Paginate by ' +
      'passing the previous response\'s nextCursor back in as `cursor` (the cursor is bound to the exact ' +
      'same filters — changing filters mid-pagination invalidates it). Read access is enough — this is the ' +
      'dashboard\'s Explore tool, available to every member role.',
    inputSchema: {
      type: 'object' as const,
      required: ['dataset'],
      properties: {
        dataset: {
          type: 'string',
          enum: ['einvoicing_records', 'tax_calculations'],
          description: 'Which dataset to query. See get_query_fields for each dataset\'s allowlisted fields.',
        },
        filters: {
          type: 'array',
          description: 'Allowlisted field filters, ANDed together. Get valid field/operator/enum combinations from get_query_fields.',
          items: {
            type: 'object',
            required: ['field', 'operator'],
            properties: {
              field:    { type: 'string', description: 'A field named in this dataset\'s schema (see get_query_fields).' },
              operator: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'], description: '"in" requires `values`; every other operator requires `value`.' },
              value:    { description: 'Comparison value. Required for every operator except "in".' },
              values:   { type: 'array', description: 'Comparison values. Only valid with operator "in".' },
            },
          },
        },
        columns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Allowlisted field names to return per row. Omit for the dataset\'s default column set (see get_query_fields).',
        },
        limit:  { type: 'number', description: 'Rows per page (default 25, max 100)' },
        from:   { type: 'string', description: 'Inclusive lower bound on the dataset\'s canonical timestamp field (ISO date or datetime).' },
        to:     { type: 'string', description: 'Inclusive upper bound on the dataset\'s canonical timestamp field (ISO date or datetime).' },
        cursor: { type: 'string', description: 'Opaque keyset cursor from a previous query_data response\'s nextCursor, to fetch the next page of the same query.' },
      },
    },
  },
  {
    name: 'get_setup_status',
    description:
      'Check what is left to finish setting up this Clearvo account — mirrors the dashboard\'s ' +
      '"Getting Started" checklist. Returns one entry per applicable step: whether it is done, which ' +
      'solution gates it (if any), a description of what the step means, and how to complete it ' +
      '(which tool to call, or which dashboard page to visit for steps with no public API yet). ' +
      'Steps not relevant to this account (e.g. team invites on a Starter plan) are omitted entirely. ' +
      'Also returns nextSteps — a step-by-step integration guide URL and summary for each enabled ' +
      'solution (currently tax calculations and e-invoicing), so once the checklist is done you know ' +
      'how to actually wire the API into the customer\'s application, not just that setup is complete. ' +
      'Call this right after connecting, and again after completing a step, to verify it registered.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_tax_settings',
    description:
      'Read the account-level tax calculation settings: VAT validation mode, how to treat ' +
      'unverifiable VAT numbers, default tax-inclusive/exclusive pricing, default product category, ' +
      'and US address precision. The response includes a "descriptions" object explaining what each ' +
      'setting controls and the tradeoffs — use it to explain the options to the user in plain language ' +
      'before calling update_tax_settings. IMPORTANT: even when a user says they want to accept all ' +
      'defaults, do not treat that as a no-op — defaultTaxCategorySlug is the one setting worth raising ' +
      'explicitly before confirming, because leaving it unset silently falls back to a generic ' +
      'physical-goods category that mistaxes an account whose catalogue is mostly one non-physical type ' +
      '(e.g. all SaaS). Ask what the account mostly sells and set it if there is a dominant type, before ' +
      'calling update_tax_settings with confirmed=true. Also returns confirmedAt — null means the user ' +
      'has not yet explicitly reviewed these settings (a Getting Started step).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'update_tax_settings',
    description:
      'Update account-level tax calculation settings. Call get_tax_settings first to see current values ' +
      'and their explanations before changing anything — and before confirming, if the account\'s catalogue ' +
      'is mostly one product type (e.g. all SaaS), set defaultTaxCategorySlug for that type rather than ' +
      'leaving it unset; see get_tax_settings for why. Pass confirmed=true once the user has reviewed ' +
      'the settings (even if they kept every other default) — this marks the "Review your tax calculation ' +
      'settings" Getting Started step complete.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        vatValidationMode: { type: 'string', enum: ['full', 'format', 'none'], description: "'full' validates live against the issuing authority, 'format' only checks structure, 'none' skips validation entirely." },
        vatUnverifiableTreatment: { type: 'string', enum: ['consumer', 'business'], description: "How to treat a B2B buyer whose VAT number can't be verified live. 'consumer' (safer default) charges tax as if B2C; 'business' keeps reverse-charge treatment." },
        defaultPriceIncludesTax: { type: 'boolean', description: 'Whether prices sent to calculate_tax already include tax (true) or are tax-exclusive (false).' },
        defaultTaxCategorySlug: { type: ['string', 'null'], description: 'RECOMMENDED to set explicitly rather than leaving unset — the tax category applied when no product name/category is supplied on a line item. Unset silently falls back to a generic physical-goods category, which mistaxes a catalogue that is mostly one non-physical type (e.g. all SaaS). Pass null to clear it back to that fallback.' },
        usAddressPrecision: { type: 'string', enum: ['rooftop', 'zip'], description: "'rooftop' resolves the full street address for the most accurate US rate (recommended); 'zip' uses ZIP code only." },
        confirmed: { type: 'boolean', description: 'Set true once the user has reviewed these settings — marks the onboarding step complete, independent of whether any value changed.' },
      },
    },
  },
  {
    name: 'get_reporting_obligations',
    description:
      'Read the domestic e-reporting/e-invoicing regime toggles under the "Tax Reporting" solution for this ' +
      'entity — currently France e-reporting (fr_ereporting), Spain SII (es_sii), and Portugal invoice-data ' +
      'communication to AT (pt_efatura). Each entry returns enabled, ' +
      'whether the entity is registered in that country (registered: false means toggling is not yet meaningful — ' +
      'point the user at add_registration first), effectiveFrom (the date the regime actually started applying, ' +
      'null if never enabled), submissionMode, and setupStatus/setupStatusNote (an internal ops-set progress ' +
      'note — read-only here; update_reporting_obligations cannot set it). No regime defaults to enabled — a ' +
      'missing/false row genuinely means the customer has not turned it on, never an inferred default. Each ' +
      'entry also carries registrationGate: null when registered is true, otherwise ' +
      '{ message, fixUrl } — an absolute URL to send the user to before attempting to enable this regime. Note: ' +
      'the underlying tax registration is not itself SII/e-reporting enrollment — enabling the regime with its ' +
      'own effectiveFrom is the separate, explicit declaration. Rows also carry allowedSubmissionModes/' +
      'defaultSubmissionMode (batch_review for es_sii and fr_ereporting), registrationWarning (enabled but the ' +
      'registration has since lapsed), and openBatch/modeChangeNotice when a Spain SII batch is accumulating.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'update_reporting_obligations',
    description:
      'Enable or disable domestic e-reporting/e-invoicing regimes for this entity (currently fr_ereporting, ' +
      'es_sii, es_verifactu, and pt_efatura). Call get_reporting_obligations first to see current state. Pass obligations as ' +
      'an object keyed by regime code, each value either `true`/`false` (disable-only shorthand) or an object ' +
      '{ enabled, effectiveFrom, submissionMode }. ENABLING A REGIME REQUIRES effectiveFrom (an ISO date, YYYY-MM-DD) ' +
      '— ask the user when the obligation should start applying rather than guessing; the call fails with ' +
      'EFFECTIVE_FROM_REQUIRED otherwise. submissionMode must be one this regime allows (es_sii and fr_ereporting allow ' +
      '"immediate", "batch_auto" and "batch_review" — default "batch_review": nothing is sent until a human confirms the ' +
      'batch; pt_efatura and e-invoicing regimes are immediate-only; the call fails with SUBMISSION_MODE_NOT_ALLOWED otherwise). Enabling fr_ereporting/es_sii/pt_efatura also requires ' +
      'the entity already hold a current STANDARD registration for that regime\'s own country — otherwise the call ' +
      'fails REGISTRATION_REQUIRED with a { ok:false, code, message, country, entityId, fixUrl } body (fixUrl is ' +
      'an absolute URL at "/registrations?country=<cc>&returnTo=/jurisdictions" on this API\'s own host); point ' +
      'the user at add_registration for that country first, then retry. Disabling is never subject to this ' +
      'check — but disabling es_sii specifically fails with a 409 OBLIGATION_HAS_PENDING_BATCH ' +
      '{ ok:false, code, batchIds, reportByDates, message, fixUrl } body when the entity has an open, ' +
      'ready_for_review, or overdue reporting batch — pass force:true to disable anyway (the batch itself is left ' +
      'completely untouched; it still carries a real AEAT deadline and remains confirmable). Enabling es_sii alongside es_verifactu is ' +
      'allowed but returns a warnings[] entry (SII_EXEMPTS_VERIFACTU) explaining VeriFactu becomes redundant once ' +
      'SII is active — surface that to the user rather than silently proceeding. setupStatus/setupStatusNote ' +
      'cannot be set through this tool (ops-only) — pass confirm:true only once the user has reviewed the ' +
      'obligations they are setting.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        obligations: {
          type: 'object',
          description: 'Map of regime code -> boolean or { enabled, effectiveFrom, submissionMode }. See tool description for the enabling rules.',
        },
        confirm: { type: 'boolean', description: 'Set true once the user has reviewed these obligations — marks the "Tax Reporting" Getting Started step complete, independent of whether any value changed.' },
        force: { type: 'boolean', description: 'Set true to disable es_sii anyway despite an OBLIGATION_HAS_PENDING_BATCH 409 — confirm with the user first, since a pending batch still needs their attention.' },
      },
    },
  },
  {
    name: 'list_reporting_batches',
    description:
      'List or fetch AEAT Spain SII reporting batches — the accumulated groups of invoices this entity\'s ' +
      'batch_auto/batch_review submissionMode builds up before sending them to AEAT together. Omit id to list ' +
      'batches (optionally filtered by status and entityId); pass id to fetch one batch\'s full detail, including ' +
      'every record it holds (invoice number, counterparty NIF, tipo, book, base/cuota, classification, ' +
      'warnings, reportBy, isLate, the AEAT outcome once submitted, and whether it was excluded from the batch). ' +
      'Every response includes a vocabulary block with labels for every batch status and record state, plus a ' +
      'server-computed overdueLabel ("N Spanish business days overdue") wherever a deadline has passed — never ' +
      'reconstruct these from the raw status codes. A batch_review batch in status ready_for_review is waiting ' +
      'for a human confirm (POST /v1/reporting-batches/{id}/confirm with its snapshotVersion) — nothing is sent ' +
      'to AEAT until then.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'A specific batch ID (UUID) to fetch full detail for. Omit to list batches instead.' },
        status: { type: 'string', enum: ['open', 'closed', 'ready_for_review', 'submitted', 'filed'], description: 'List only: filter by batch status.' },
        entityId: { type: 'string', description: 'List only: filter by entity (organisation-scoped keys only).' },
        page: { type: 'number', description: 'List only: 1-based page number (default 1).' },
        limit: { type: 'number', description: 'List only: results per page (default 50, max 200).' },
      },
    },
  },
  {
    name: 'run_reporting_batch_sweep',
    description:
      'SANDBOX-ONLY: manually run the reporting-batch lifecycle\'s daily close/dispatch/notify sweeps for this ' +
      'entity right now, instead of waiting for the real overnight cron and the real Spanish-business-day clock. ' +
      'Use this to drive an ES Spain SII batch through its full lifecycle for testing: open -> this tool closes ' +
      'the batch and either freezes it ready_for_review (submissionMode batch_review — call ' +
      'reporting-batches confirm next) or hands it off to AEAT (batch_auto). Fails with SANDBOX_ONLY (403) ' +
      'against a production API key — provision a sandbox entity/key first if you don\'t have one. Both dates ' +
      'default to this entity\'s own earliest open batch report_by date when omitted, which is what makes the ' +
      'batch close immediately rather than waiting for its real deadline.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        today: { type: 'string', description: 'Override for the close-sweep clock (YYYY-MM-DD). Omit to default to this entity\'s own earliest open batch report_by date.' },
        madridToday: { type: 'string', description: 'Override for the Europe/Madrid civil-date clock (YYYY-MM-DD) the ES_SII batch trigger and notify sweep gate on. Omit to default the same way as today.' },
      },
    },
  },
  {
    name: 'create_exemption_certificate',
    description:
      'Record a tax exemption certificate belonging to one of this entity\'s CUSTOMERS — not a certificate for the ' +
      'entity itself. An exemption certificate is a document a customer provides (e.g. a US resale certificate, ' +
      'manufacturing exemption, nonprofit exemption letter, or Ireland\'s Section 56 export authorisation) ' +
      'proving they do not owe tax on a purchase. Only call this when you know a specific customer holds one; ' +
      'there is no default or fallback certificate. Valid certificateType/formType combinations depend on ' +
      'country and are validated server-side — an unsupported combination (including any country other than ' +
      'US or IE) is rejected with an error, not silently accepted. Once created, reference it via customer.ref ' +
      'matching customerRef during calculate_tax so the exemption is automatically applied to eligible line ' +
      'items. Call upload_exemption_document afterwards if you have the signed PDF to attach.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        certificateRef: { type: 'string', description: 'Your internal reference for this certificate (e.g. "EXEMPT-2024-001").' },
        customerRef: { type: 'string', description: 'Your internal customer reference. Matched against customer.ref on calculate_tax requests to auto-apply this exemption.' },
        certificateType: { type: 'string', enum: ['RESALE', 'MANUFACTURING', 'AGRICULTURAL', 'ENERGY', 'EXEMPT_ORG', 'GOVERNMENT', 'DIRECT_PAY', 'BLANKET_OTHER', 'EXPORT_AUTHORIZATION'], description: 'Type of exemption claimed. RESALE/MANUFACTURING/AGRICULTURAL/ENERGY/EXEMPT_ORG/GOVERNMENT/DIRECT_PAY/BLANKET_OTHER are for country="US". EXPORT_AUTHORIZATION is for country="IE" only — Ireland\'s Revenue-issued Section 56 ("56B") authorisation letting a habitual exporter buy most goods/services at 0% VAT (excludes food/drink, accommodation, entertainment, personal services).' },
        formType: { type: 'string', enum: ['SST', 'MTC', 'CUSTOM', '56B'], description: 'Standard form type. Optional for US (SST/MTC/CUSTOM, or a state-specific form code not in this enum). Required and must be "56B" when certificateType is EXPORT_AUTHORIZATION.' },
        customerName: { type: 'string', description: 'Exempt customer\'s name.' },
        customerTaxId: { type: 'string', description: 'Exempt customer\'s tax ID.' },
        country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code. Defaults to "US". Only "US" and "IE" are currently supported.' },
        region: { type: 'string', description: 'State or region code the exemption applies to (e.g. "CA"). US exemptions are typically state-scoped. Omit for IE — Section 56 authorisations are national, not sub-regional.' },
        taxCategorySlug: { type: 'string', description: 'Optional — restrict the exemption to a specific product tax category instead of all products.' },
        effectiveFrom: { type: 'string', description: 'Date the certificate becomes valid, YYYY-MM-DD.' },
        effectiveTo: { type: 'string', description: 'Expiry date, YYYY-MM-DD. Omit for open-ended certificates. For IE, use the expiry date printed on the Revenue authorisation.' },
        entityId: { type: 'string', description: 'Entity to create the certificate under. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['certificateRef', 'customerRef', 'certificateType', 'effectiveFrom'],
    },
  },
  {
    name: 'upload_exemption_document',
    description:
      'Attach the signed certificate PDF to an exemption certificate created via create_exemption_certificate. ' +
      'The PDF content must be base64-encoded.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        certificateId: { type: 'string', description: 'The certificate ID returned by create_exemption_certificate.' },
        documentBase64: { type: 'string', description: 'Base64-encoded PDF file content.' },
        entityId: { type: 'string', description: 'Entity the certificate belongs to. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['certificateId', 'documentBase64'],
    },
  },
  {
    name: 'list_customers',
    description:
      'List an entity\'s customer master data (name, tax ID, address). ' +
      'Every successfully-issued invoice also auto-captures/refreshes a customer record from its customer details, ' +
      'so this list fills in over time even without calling create_customer directly. ' +
      'Reference a customer via customer.customerRef on submit_invoice instead of resending full customer details every time.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Case-insensitive substring match against the stored name' },
        page: { type: 'number', description: 'Page number, 1-based (default 1)' },
        limit: { type: 'number', description: 'Results per page (default 25, max 100)' },
        entityId: { type: 'string', description: 'Entity to list customers for. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
    },
  },
  {
    name: 'create_customer',
    description:
      'Create a customer master-data record. Reference it later via customer.customerRef on submit_invoice ' +
      'instead of resending full customer details every time. country and taxId are optional together — a B2C ' +
      'customer with no VAT registration can have neither, but must not have one without the other. Use taxIds ' +
      'instead of country/taxId for a customer registered in more than one country.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Customer name' },
        country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code of the primary registration. Required together with taxId. Mutually exclusive with taxIds.' },
        taxId: { type: 'string', description: 'Tax ID. Required together with country; format-validated and normalized. Mutually exclusive with taxIds.' },
        taxIds: {
          type: 'array',
          description: 'Full ordered list of this customer\'s tax registrations for a customer registered in more than one country — first entry is the primary. Mutually exclusive with country/taxId.',
          items: {
            type: 'object',
            properties: { country: { type: 'string' }, taxId: { type: 'string' } },
            required: ['country', 'taxId'],
          },
        },
        customerRef: { type: 'string', description: 'Your own reference (e.g. CRM/ERP customer id). Must be unique per entity — see upsert_customer_by_ref to create-or-update by this reference directly instead of erroring on a repeat call.' },
        addressCountry: { type: 'string', description: 'ISO 3166-1 alpha-2 country code of this customer\'s own mailing address — independent of country/taxIds (the tax registration country). A customer can be VAT-registered in one country and addressed in another. Defaults to the primary tax registration\'s country when omitted.' },
        addressLine1: { type: 'string' },
        addressLine2: { type: 'string' },
        city: { type: 'string' },
        region: { type: 'string' },
        postalCode: { type: 'string' },
        peppolParticipantId: { type: 'string', description: '"schemeId:value" form, e.g. "0106:12345678". Supplying it is treated as confirmed immediately.' },
        countrySpecific: {
          type: 'object',
          description: 'Country-specific master data, only meaningful for the named country.',
          properties: {
            ar: {
              type: 'object',
              description: 'Argentina AFIP buyer VAT condition.',
              properties: {
                condicionIVAReceptorId: { type: 'integer', enum: [1, 2, 3, 4, 5], description: '1=Responsable Inscripto, 2=Monotributo, 3=Exento, 4=Consumidor Final, 5=Foreign. Backfilled onto AR invoices submitted via customerRef whenever the send request omits its own value.' },
              },
            },
          },
        },
        entityId: { type: 'string', description: 'Entity to create the customer under. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_customer',
    description:
      'Update a customer\'s master data. country and taxId are treated as a pair — clearing one without the ' +
      'other clears taxId (the pair is no longer complete). Mutually exclusive with taxIds.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        customerId: { type: 'string', description: 'The customer ID to update (from list_customers or create_customer)' },
        name: { type: 'string' },
        country: { type: 'string' },
        taxId: { type: 'string' },
        taxIds: {
          type: 'array',
          description: 'Full replacement list of this customer\'s tax registrations (pass [] to clear every one) — first entry becomes the primary. Mutually exclusive with country/taxId. Omit entirely to leave existing registrations untouched.',
          items: {
            type: 'object',
            properties: { country: { type: 'string' }, taxId: { type: 'string' } },
            required: ['country', 'taxId'],
          },
        },
        customerRef: { type: 'string' },
        addressCountry: { type: 'string', description: 'ISO 3166-1 alpha-2 country code of this customer\'s own mailing address — independent of country/taxIds. Omit to leave unchanged; pass null to clear it.' },
        addressLine1: { type: 'string' },
        addressLine2: { type: 'string' },
        city: { type: 'string' },
        region: { type: 'string' },
        postalCode: { type: 'string' },
        peppolParticipantId: { type: 'string', description: '"schemeId:value" form. Setting it is treated as confirmed immediately; pass null to clear it.' },
        countrySpecific: {
          type: 'object',
          description: 'Country-specific master data, only meaningful for the named country.',
          properties: {
            ar: {
              type: 'object',
              description: 'Argentina AFIP buyer VAT condition.',
              properties: {
                condicionIVAReceptorId: { type: 'integer', enum: [1, 2, 3, 4, 5], description: '1=Responsable Inscripto, 2=Monotributo, 3=Exento, 4=Consumidor Final, 5=Foreign. Pass null to clear the stored value.' },
              },
            },
          },
        },
        entityId: { type: 'string', description: 'Entity the customer belongs to. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['customerId'],
    },
  },
  {
    name: 'upsert_customer_by_ref',
    description:
      'Create or update a customer keyed on your own customerRef instead of Clearvo\'s internal id — the natural ' +
      'tool for syncing customer master data from your own CRM/ERP, where "push the current state of this ' +
      'customer" runs repeatedly, not a one-time create. Unlike create_customer (which errors on a repeat ' +
      'customerRef), this always succeeds: creates on first call, REPLACES on every later call with the same ' +
      'customerRef — an omitted optional field clears whatever was previously stored. The one exception is ' +
      'peppolParticipantId: omitted, it is left untouched, so a plain field sync doesn\'t wipe an identity ' +
      'confirmed separately.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        customerRef: { type: 'string', description: 'Your own reference for this customer (e.g. CRM/ERP customer id).' },
        name: { type: 'string', description: 'Customer name' },
        country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code of the primary registration. Required together with taxId. Mutually exclusive with taxIds.' },
        taxId: { type: 'string', description: 'Required together with country. Mutually exclusive with taxIds.' },
        taxIds: {
          type: 'array',
          description: 'Full list of this customer\'s tax registrations, first entry is the primary. Mutually exclusive with country/taxId.',
          items: {
            type: 'object',
            properties: { country: { type: 'string' }, taxId: { type: 'string' } },
            required: ['country', 'taxId'],
          },
        },
        addressCountry: { type: 'string', description: 'ISO 3166-1 alpha-2 country code of this customer\'s own mailing address — independent of country/taxIds. Defaults to the primary tax registration\'s country when omitted; full-replace semantics like every other field here (an omission on a later call clears back to that default).' },
        addressLine1: { type: 'string' },
        addressLine2: { type: 'string' },
        city: { type: 'string' },
        region: { type: 'string' },
        postalCode: { type: 'string' },
        peppolParticipantId: { type: 'string', description: '"schemeId:value" form. Supplying it is treated as confirmed immediately. Omit to leave an existing confirmed value untouched.' },
        countrySpecific: {
          type: 'object',
          description: 'Country-specific master data, only meaningful for the named country. Omit a sub-field to leave it untouched, not clear it.',
          properties: {
            ar: {
              type: 'object',
              description: 'Argentina AFIP buyer VAT condition.',
              properties: {
                condicionIVAReceptorId: { type: 'integer', enum: [1, 2, 3, 4, 5], description: '1=Responsable Inscripto, 2=Monotributo, 3=Exento, 4=Consumidor Final, 5=Foreign.' },
              },
            },
          },
        },
        entityId: { type: 'string', description: 'Entity to upsert the customer under. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['customerRef', 'name'],
    },
  },
  {
    name: 'delete_customer',
    description: 'Soft-delete a customer. If this customer is invoiced again, they will be re-added automatically.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        customerId: { type: 'string', description: 'The customer ID to delete (from list_customers)' },
        entityId: { type: 'string', description: 'Entity the customer belongs to. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['customerId'],
    },
  },
  {
    name: 'list_suppliers',
    description:
      'List an entity\'s supplier master data (name, tax ID, address) — mirrors list_customers for the other ' +
      'side of a transaction. Suppliers are the vendors on purchase-side tax calculations ' +
      '(calculate_tax with transactionDirection: "purchase") and on received e-invoices. ' +
      'Every received inbound e-invoice also auto-captures/refreshes a supplier record from its own supplier ' +
      'details, so this list fills in over time even without calling create_supplier directly. ' +
      'Reference a supplier via supplier.ref on calculate_tax (matched against the saved supplierRef) instead ' +
      'of resending full supplier details every time.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Case-insensitive substring match against the stored name' },
        page: { type: 'number', description: 'Page number, 1-based (default 1)' },
        limit: { type: 'number', description: 'Results per page (default 25, max 100)' },
        entityId: { type: 'string', description: 'Entity to list suppliers for. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
    },
  },
  {
    name: 'create_supplier',
    description:
      'Create a supplier master-data record — the vendor on purchase-side tax calculations and received ' +
      'e-invoices. Reference it later via supplier.ref on calculate_tax (transactionDirection: "purchase") ' +
      'instead of resending full supplier details every time. country and taxId are optional together — a ' +
      'supplier with no known VAT registration can have neither, but must not have one without the other. Use ' +
      'taxIds instead of country/taxId for a supplier registered in more than one country.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Supplier name' },
        country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code of the primary registration. Required together with taxId. Mutually exclusive with taxIds.' },
        taxId: { type: 'string', description: 'Tax ID. Required together with country; format-validated and normalized. Mutually exclusive with taxIds.' },
        taxIds: {
          type: 'array',
          description: 'Full ordered list of this supplier\'s tax registrations for a supplier registered in more than one country — first entry is the primary. Mutually exclusive with country/taxId.',
          items: {
            type: 'object',
            properties: { country: { type: 'string' }, taxId: { type: 'string' } },
            required: ['country', 'taxId'],
          },
        },
        supplierRef: { type: 'string', description: 'Your own reference (e.g. ERP vendor id). Must be unique per entity.' },
        establishmentCountry: { type: 'string', description: 'ISO 3166-1 alpha-2 country code of this supplier\'s own place of establishment — independent of country/taxIds (the tax registration country). Defaults to the primary tax registration\'s country when omitted.' },
        addressLine1: { type: 'string' },
        addressLine2: { type: 'string' },
        city: { type: 'string' },
        region: { type: 'string' },
        postalCode: { type: 'string' },
        entityId: { type: 'string', description: 'Entity to create the supplier under. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_supplier',
    description:
      'Update a supplier\'s master data. country and taxId are treated as a pair — clearing one without the ' +
      'other clears taxId (the pair is no longer complete). Mutually exclusive with taxIds.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        supplierId: { type: 'string', description: 'The supplier ID to update (from list_suppliers or create_supplier)' },
        name: { type: 'string' },
        country: { type: 'string' },
        taxId: { type: 'string' },
        taxIds: {
          type: 'array',
          description: 'Full replacement list of this supplier\'s tax registrations (pass [] to clear every one) — first entry becomes the primary. Mutually exclusive with country/taxId. Omit entirely to leave existing registrations untouched.',
          items: {
            type: 'object',
            properties: { country: { type: 'string' }, taxId: { type: 'string' } },
            required: ['country', 'taxId'],
          },
        },
        supplierRef: { type: 'string' },
        establishmentCountry: { type: 'string', description: 'ISO 3166-1 alpha-2 country code of this supplier\'s own place of establishment — independent of country/taxIds. Omit to leave unchanged; pass null to clear it.' },
        addressLine1: { type: 'string' },
        addressLine2: { type: 'string' },
        city: { type: 'string' },
        region: { type: 'string' },
        postalCode: { type: 'string' },
        entityId: { type: 'string', description: 'Entity the supplier belongs to. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['supplierId'],
    },
  },
  {
    name: 'delete_supplier',
    description: 'Soft-delete a supplier. If this supplier is received on another inbound e-invoice, they will be re-added automatically.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        supplierId: { type: 'string', description: 'The supplier ID to delete (from list_suppliers)' },
        entityId: { type: 'string', description: 'Entity the supplier belongs to. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['supplierId'],
    },
  },
  {
    name: 'list_check_families',
    description:
      'List the optional (BUSINESS_POLICY) validation check families this entity can turn on or off — e.g. ' +
      'a business-policy-only tax-ID format warning outside the countries where it is a legal mandate. Each ' +
      'family carries its member rule codes (split into legalMandateRuleCodes/businessPolicyRuleCodes) and this ' +
      "entity's current toggleState (ENABLED, DISABLED, or PARTIAL). A family made entirely of LEGAL_MANDATE " +
      'rules is never listed here — those can never be disabled for a single entity; see the mandate list instead.',
    inputSchema: {
      type: 'object' as const,
      properties: { entityId: { type: 'string', description: 'Entity ID to query. Required for account-scoped keys; omit for entity-scoped keys.' } },
    },
  },
  {
    name: 'toggle_check_family',
    description:
      'Enable or disable an entire optional check family (see list_check_families) for this entity in one call, ' +
      'instead of suppressing one rule code at a time. Only the BUSINESS_POLICY rule codes in the family are ever ' +
      'touched — any LEGAL_MANDATE rows in a mixed family are always left enforced, and the response always lists ' +
      'skippedLegalMandateRuleCodes (even when empty) so the caller can see that. Rejected with NOT_TOGGLEABLE if ' +
      'the family is 100% LEGAL_MANDATE.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        checkFamily: { type: 'string', description: 'The check family to toggle (from list_check_families)' },
        enabled: { type: 'boolean', description: 'true to enable (re-activate) the family, false to disable it' },
        reason: { type: 'string', description: 'Optional free-text reason recorded in the override audit trail' },
        entityId: { type: 'string', description: 'Entity to toggle the family for. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['checkFamily', 'enabled'],
    },
  },
  {
    name: 'get_skip_transactions',
    description:
      'Get this entity\'s Skip Transactions configuration: whether it is active, and the configured lists of ' +
      'buyer tax IDs, customer refs, and buyer names. Any invoice whose buyer matches any configured list value ' +
      'is excluded from e-invoicing entirely — never submitted to any authority.',
    inputSchema: {
      type: 'object' as const,
      properties: { entityId: { type: 'string', description: 'Entity ID to query. Required for account-scoped keys; omit for entity-scoped keys.' } },
    },
  },
  {
    name: 'set_skip_transactions',
    description:
      'Enable, or fully replace, this entity\'s Skip Transactions lists. Each call replaces all three lists ' +
      '(not a merge) — send the complete desired set every time. At least one non-blank value across all three ' +
      'lists combined is required; a request that normalizes to all three empty is rejected (an empty set would ' +
      'match nothing, never everything).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taxIds: { type: 'array', items: { type: 'string' }, description: 'Buyer tax IDs to skip' },
        customerRefs: { type: 'array', items: { type: 'string' }, description: 'Buyer customerRef values to skip' },
        names: { type: 'array', items: { type: 'string' }, description: 'Buyer names to skip' },
        entityId: { type: 'string', description: 'Entity to configure. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
    },
  },
  {
    name: 'disable_skip_transactions',
    description:
      'Disable this entity\'s Skip Transactions entirely. The configured lists are preserved, not cleared — a ' +
      'later set_skip_transactions call with the same lists re-activates them unchanged.',
    inputSchema: {
      type: 'object' as const,
      properties: { entityId: { type: 'string', description: 'Entity to disable. Required for account-scoped keys; omit for entity-scoped keys.' } },
    },
  },
  {
    name: 'list_client_tax_codes',
    description:
      'List the client tax codes configured for an entity. A client tax code maps your own ERP tax code ' +
      '(e.g. a SAP two-digit code) to a Clearvo Tax Decision. Reference one via clientTaxCode on submit_invoice ' +
      '(RECOMMENDED, instead of an explicit taxTreatment); calculate_tax returns your matching code back in its ' +
      'response for ERP posting. The EN16931 category and rate are always computed live, never stored. See ' +
      'also list_tax_codes for the full canonical catalogue (this platform\'s own content plus your codes).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        entityId: { type: 'string', description: 'Entity ID to list client tax codes for. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
    },
  },
  {
    name: 'list_tax_codes',
    description:
      'List/search every tax-code row this platform knows about — Clearvo\'s own content (system_enum: a ' +
      'connector\'s raw enum value e.g. Xero TaxType; fact: a country\'s sale-side default treatment, the same ' +
      'vocabulary submit_invoice\'s lines[].taxTreatment accepts) plus this entity\'s own client tax codes ' +
      '(vocabulary=client, same rows as list_client_tax_codes, in the same shape). Use this to validate a ' +
      'clientTaxCode/taxTreatment value before calling submit_invoice, or to build a tax-code picker.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        code: { type: 'string', description: 'Substring match against `code`, case-insensitive.' },
        vocabulary: { type: 'string', enum: ['system_enum', 'fact', 'client', 'tax_calc'], description: 'Omit to list every vocabulary.' },
        country: { type: 'string', description: 'ISO 3166-1 alpha-2 — narrows to this country\'s rows.' },
        sourceSystem: { type: 'string', description: 'e.g. "xero" — narrows to one connector\'s system_enum rows; never matches a client row.' },
        date: { type: 'string', description: 'YYYY-MM-DD — resolves each row\'s live rate as of this date. Defaults to now.' },
        entityId: { type: 'string', description: 'Entity ID to scope `client` vocabulary rows to. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
    },
  },
  {
    name: 'create_client_tax_code',
    description:
      'Map one of your own ERP tax codes to a Clearvo Tax Decision — movement, taxability, customerType, ' +
      'supplyType, reverseCharge, useTaxSelfAssessed, and (where meaningful) rateBand. The EN16931 taxCode and ' +
      'rate are computed live from these fields, never caller-supplied. `code` must be unique per entity — a ' +
      'repeat call with an existing code fails with DUPLICATE_CODE; use update_client_tax_code instead. Two ' +
      'different codes mapping to the identical treatment are allowed but return a non-blocking warning.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        code: { type: 'string', description: 'Your own ERP tax code (e.g. a SAP two-digit code), unique per entity.' },
        country: { type: 'string', description: 'ISO 3166-1 alpha-2 or alpha-3 country code (e.g. "DE").' },
        region: { type: 'string', description: 'Sub-national scope (e.g. a US state). Omit for a country-wide code.' },
        movement: { type: 'string', enum: ['local', 'intra_community', 'export', 'distance_sale', 'import', 'own_goods_movement'], description: '`export` covers every non-EU-EU B2B cross-border combination — the EU/G vs. non-EU/AE split in the derived taxCode comes from whether `country` itself is in the EU. Valid values depend on `country` and `direction`: for country="US" only `local` is valid; `intra_community`/`distance_sale` require an EU country (or Norway for `distance_sale`); `export`/`distance_sale` are sale-only, `import` is purchase-only. An invalid combination is rejected server-side, not silently accepted.' },
        taxability: { type: 'string', enum: ['taxable', 'exempt', 'out_of_scope'] },
        customerType: { type: 'string', enum: ['b2b', 'b2c'], description: 'Omit for a code that applies to either b2b or b2c.' },
        supplyType: { type: 'string', enum: ['goods', 'digital_service', 'general_service'] },
        rateBand: { type: 'string', enum: ['standard', 'reduced', 'second_reduced', 'super_reduced', 'zero'], description: 'Required when taxability=taxable and this movement/reverseCharge combination doesn\'t already fix the EN16931 code (e.g. required for movement=local without reverseCharge). Not applicable — and ignored if sent — for intra_community, export, or a domestic reverse charge. Which bands have a real researched rate also depends on `country`/`region` (e.g. only `standard` is valid for the US) — rejected server-side if unresearched for the given jurisdiction.' },
        reverseCharge: { type: 'boolean', description: 'Defaults to false. Independent of movement — some countries require domestic reverse charge for specific goods categories even on a wholly local sale.' },
        useTaxSelfAssessed: { type: 'boolean', description: 'Defaults to false.' },
        filingTag: { type: 'string', enum: ['cash_accounting_settled', 'cash_accounting_unsettled', 'split_payment', 'statement_of_intent', 'withholding', 'bad_debt_adjustment', 'triangular_party_b', 'triangular_party_c'], description: 'Pure metadata for a future Taxsure integration — never consumed by any computation.' },
        direction: { type: 'string', enum: ['sale', 'purchase'], description: 'Omit for a code that applies to both.' },
        recoverabilityType: { type: 'string', enum: ['full', 'blocked', 'restricted'], description: 'Purchase-side input-tax recoverability only. Omit for a sale code, or a purchase code with no recoverability position yet.' },
        recoverablePercentage: { type: 'number', description: 'Required (and only meaningful) when recoverabilityType="restricted" — a percentage strictly between 0 and 100 (0 and 100 are already "blocked"/"full").' },
        exemptionReasonCode: { type: 'string', description: 'Free-text reason code for an exempt/out-of-scope row — pure metadata, never validated against an enum, max 30 characters. See get_client_tax_code_exemption_reason_options for candidate values.' },
        description: { type: 'string' },
        exemptionReasonText: { type: 'string', description: 'Free-text exemption wording, only meaningful for an exempt, out-of-scope, or reverse-charge code — passed through verbatim onto every invoice using this code, printed exactly as given. Never derived or auto-generated; omit if you have none.' },
        entityId: { type: 'string', description: 'Entity to create the client tax code under. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['code', 'country', 'movement', 'taxability', 'supplyType'],
    },
  },
  {
    name: 'update_client_tax_code',
    description: 'Update any subset of a client tax code\'s fields. Same DUPLICATE_CODE (blocking) and duplicate-treatment (non-blocking warning) behaviour as create_client_tax_code.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        clientTaxCodeId: { type: 'string', description: 'The client tax code ID to update (from list_client_tax_codes or create_client_tax_code).' },
        code: { type: 'string' },
        country: { type: 'string' },
        region: { type: 'string' },
        movement: { type: 'string', enum: ['local', 'intra_community', 'export', 'distance_sale', 'import', 'own_goods_movement'], description: 'Valid values depend on `country`/`direction` — see create_client_tax_code.' },
        taxability: { type: 'string', enum: ['taxable', 'exempt', 'out_of_scope'] },
        customerType: { type: 'string', enum: ['b2b', 'b2c'] },
        supplyType: { type: 'string', enum: ['goods', 'digital_service', 'general_service'] },
        rateBand: { type: 'string', enum: ['standard', 'reduced', 'second_reduced', 'super_reduced', 'zero'], description: 'Which bands are valid depends on `country`/`region` — see create_client_tax_code.' },
        reverseCharge: { type: 'boolean' },
        useTaxSelfAssessed: { type: 'boolean' },
        filingTag: { type: 'string', enum: ['cash_accounting_settled', 'cash_accounting_unsettled', 'split_payment', 'statement_of_intent', 'withholding', 'bad_debt_adjustment', 'triangular_party_b', 'triangular_party_c'] },
        direction: { type: 'string', enum: ['sale', 'purchase'] },
        recoverabilityType: { type: 'string', enum: ['full', 'blocked', 'restricted'] },
        recoverablePercentage: { type: 'number' },
        exemptionReasonCode: { type: 'string', description: 'See create_client_tax_code. Send null to clear it.' },
        description: { type: 'string' },
        exemptionReasonText: { type: 'string', description: 'Free-text exemption wording — see create_client_tax_code. Send null to clear it.' },
        entityId: { type: 'string', description: 'Entity the client tax code belongs to. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['clientTaxCodeId'],
    },
  },
  {
    name: 'delete_client_tax_code',
    description: 'Delete a client tax code.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        clientTaxCodeId: { type: 'string', description: 'The client tax code ID to delete (from list_client_tax_codes)' },
        entityId: { type: 'string', description: 'Entity the code belongs to. Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['clientTaxCodeId'],
    },
  },
  {
    name: 'get_client_tax_code_options',
    description:
      'Discover the valid field combinations for create_client_tax_code/update_client_tax_code — call this BEFORE ' +
      'guessing an enum value. With no country, returns every movement/supplyType value unfiltered. With country, ' +
      'narrows movements/rateBands to what is actually valid there and resolves whether region is required and ' +
      'whether reverseCharge/useTaxSelfAssessed are even relevant concepts for that jurisdiction. With country + ' +
      'region, rateBands additionally carries each band\'s live resolved rate percentage. With direction, movements ' +
      'is further narrowed to sale- or purchase-relevant values. This is the exact same source of truth the ' +
      'dashboard\'s Client Tax Codes form uses — never hardcode a guessed option list.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        country: { type: 'string', description: '2- or 3-letter ISO code, e.g. "DE". Omit to get the unfiltered global option set.' },
        region: { type: 'string', description: 'Sub-country scope (e.g. a US state) — refines rateBands\' resolved rate percentages. Only meaningful alongside country.' },
        direction: { type: 'string', enum: ['sale', 'purchase'], description: 'Further narrows movements to sale- or purchase-relevant values.' },
        entityId: { type: 'string', description: 'Required for account-scoped keys; omit for entity-scoped keys.' },
      },
    },
  },
  {
    name: 'get_client_tax_code_exemption_reason_options',
    description:
      'Candidate exemptionReasonCode values for an IN-PROGRESS (not yet saved) client tax code, given the other ' +
      'fields you have already chosen. exemptionReasonCode itself is free-text metadata (never validated against an ' +
      'enum at save time), but this tells you what a human configuring the same code on the dashboard would be ' +
      'offered — call it after get_client_tax_code_options once you know country/movement/taxability, especially for ' +
      'a taxability="exempt" or "out_of_scope" code, rather than inventing a reason code from scratch.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        country: { type: 'string', description: '2- or 3-letter ISO code.' },
        movement: { type: 'string', enum: ['local', 'intra_community', 'export', 'distance_sale', 'import', 'own_goods_movement'] },
        taxability: { type: 'string', enum: ['taxable', 'exempt', 'out_of_scope'] },
        reverseCharge: { type: 'string', enum: ['true', 'false'], description: 'Pass as the literal string "true" or "false".' },
        supplyType: { type: 'string', enum: ['goods', 'digital_service', 'general_service'] },
        customerType: { type: 'string', enum: ['b2b', 'b2c'] },
        rateBand: { type: 'string', enum: ['standard', 'reduced', 'second_reduced', 'super_reduced', 'zero'] },
        direction: { type: 'string', enum: ['sale', 'purchase'] },
        entityId: { type: 'string', description: 'Required for account-scoped keys; omit for entity-scoped keys.' },
      },
    },
  },
  // Bulk ingestion — MCP twins of POST /v1/send/bulk (both transports — the server picks by
  // size, see MAX_BULK_ROWS's own comment above), GET /v1/send/bulk/{batchId}, and
  // GET /v1/send/bulk/{batchId}/errors.
  {
    name: 'submit_invoices_bulk',
    description:
      'Submits (does not just validate) many transactions at once from a CSV file, through the exact same resolution/' +
      'dispatch pipeline as submit_invoice, one call per row. csvContent is the raw CSV text — never base64-encode it. Up ' +
      'to 500 rows / 25 MB, processed synchronously with per-row outcomes in the response — this tool refuses (without ' +
      'calling the API at all) a csvContent over either limit and names submit_invoices_bulk_async in the error, since a ' +
      'larger file is better handled asynchronously from the start. Unlike submit_invoice, no idempotency key is needed: ' +
      'each row\'s own content (entity + transaction_date + currency + amounts + country, or its source_reference column ' +
      'when present) is already the de-duplication key, so a byte-identical re-run of the same file is a safe no-op — set ' +
      'source_reference per row for the most reliable re-run behaviour. For a batched mandate (e.g. Spain SII, France ' +
      'e-reporting) rows are accumulated into a reporting period, not sent to an authority immediately — the human review/ ' +
      'confirm gate on Filings still applies identically regardless of which door (dashboard, API, or here) the rows ' +
      'arrived through.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        csvContent: { type: 'string', description: 'The raw CSV text (not base64) — header row plus up to 500 data rows. See the transaction_date/currency/country/net_amount/tax_amount required columns and the optional source_reference/tax_code columns documented for POST /v1/send/bulk. tax_code is the entity\'s own client tax code (mapped in advance via create_client_tax_code/list_client_tax_codes); a BLANK tax_code gets the platform default \'S\', which must itself be registered — otherwise every such row is held (clearanceStatus HELD_UNMAPPED_TAX_CODE, reason.codeSource \'default\', message naming the fix: register \'S\' or fill tax_code per row). A freshly onboarded entity with no codes registered yet should expect exactly this on its first upload.' },
        entityId: { type: 'string', description: 'Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['csvContent'],
    },
  },
  {
    name: 'submit_invoices_bulk_async',
    description:
      'Submits (does not just validate) many transactions at once from a CSV file — for a file too large for ' +
      'submit_invoices_bulk\'s 500-row/25MB synchronous ceiling, or simply to skip that tool\'s client-side size check. ' +
      'csvContent is the raw CSV text (not base64); same column shape and content-based de-duplication as ' +
      'submit_invoices_bulk (source_reference recommended per row for reliable re-runs — no idempotency key needed). The ' +
      'underlying route decides the real transport by request size: a small csvContent may still come back as a completed ' +
      'synchronous result (the same shape submit_invoices_bulk returns — summary/rows, no batchId) rather than a queued ' +
      'batch. When it DOES queue, it returns { batchId, status: \'UPLOADED\' } immediately — poll get_bulk_upload_status ' +
      'with that batchId every 30-60 seconds until status is COMPLETED/FAILED/CANCELLED, then call list_bulk_upload_errors ' +
      'if any rows errored. A response with duplicate: true means this exact file was already processed by an earlier ' +
      'call — nothing new was queued. Note: a stdio MCP client reads this file from local disk, so unlike the hosted ' +
      'connector there is no practical argument-size ceiling here beyond the route\'s own upload limit.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        csvContent: { type: 'string', description: 'The raw CSV text (not base64) — same column shape as submit_invoices_bulk, with no row-count ceiling enforced by this tool (the route itself bounds total upload size).' },
        filename: { type: 'string', description: 'Optional filename to record against the batch (e.g. "september-sales.csv"). Defaults to a generic name. Ignored if the file ends up processed synchronously.' },
        entityId: { type: 'string', description: 'Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['csvContent'],
    },
  },
  {
    name: 'get_bulk_upload_status',
    description:
      'Poll one async bulk upload batch — created via submit_invoices_bulk_async, or handed back as a `continuation` ' +
      'batchId when submit_invoices_bulk\'s own file had more than 500 rows. Returns status (UPLOADED/VALIDATING/' +
      'COMPLETED/FAILED/CANCELLED), total, outcomeCounts keyed by the same BulkSendRowOutcome vocabulary submit_invoices_bulk ' +
      'returns per row (ACCEPTED/ACCUMULATED/NEEDS_INFO/HELD/NO_OBLIGATION/SKIPPED_DUPLICATE/ERRORED), and a human-readable ' +
      'summary. Call list_bulk_upload_errors afterward when outcomeCounts.ERRORED is greater than zero. 404 means no such ' +
      'batch, or it belongs to a different entity than this key is scoped to.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        batchId: { type: 'string', description: 'The batch id returned by submit_invoices_bulk_async, or by submit_invoices_bulk\'s own continuation.batchId field.' },
        entityId: { type: 'string', description: 'Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['batchId'],
    },
  },
  {
    name: 'list_bulk_upload_errors',
    description:
      'Paginated, row-level structural errors for one async bulk upload batch — every row that never reached mandate ' +
      'resolution (a malformed date/amount/currency, or a downstream rejection before resolution), each with a stable ' +
      'errorCode, its rowNumber in the original file, and a plain-language errorMessage. A row that DID reach resolution ' +
      '(however it was classified — accepted/accumulated/held/needs-info/no-obligation) is not a structural error and is not ' +
      'listed here; call list_mandate_transactions with the same uploadBatchId instead — it covers every row from the ' +
      'batch, structural-error or not. JSON only — there is no CSV export on this tool.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        batchId: { type: 'string', description: 'The batch id returned by submit_invoices_bulk_async, or by submit_invoices_bulk\'s own continuation.batchId field.' },
        page: { type: 'number', description: 'Page number, 1-based (default 1)' },
        limit: { type: 'number', description: 'Results per page (default 50, max 200)' },
        entityId: { type: 'string', description: 'Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['batchId'],
    },
  },
  // Monthly SAF-T (PT) 1.04_01 billing file — MCP twin of GET /v1/pt/saft. Only ever requests a
  // JSON shape (format=summary by default, or format=status): callApi() parses every response as
  // JSON, so the raw XML file body itself is never a fit shape for this transport — a caller who
  // wants the actual XML uses GET /v1/pt/saft directly.
  {
    name: 'get_pt_monthly_saft',
    description:
      'Get the coverage picture for this entity\'s Portugal AT monthly tax-authority file (SAF-T (PT) 1.04_01) — ' +
      'every FT/NC/ND Clearvo issued for the entity in the given calendar month, per Portaria 302/2016. ' +
      'format "summary" (default) returns the JSON manifest (equivalent to GET /v1/pt/saft?format=summary): ' +
      '{ ok, period, nif, numberOfEntries, sha256, manifest, xsdValidated, xsdValid, filename } — manifest lists ' +
      'every document (invoiceNo, seriesType, seqNum, issueDate, grossTotal); this builds the whole file. ' +
      'format "status" is the CHEAP counts-only view (no file build): { ok, applicable, period, defaultPeriod, ' +
      'documentCount, reportedToAt, notReportedToAt, dueDate, attention, attentionMessage, summaryLabel } — use it ' +
      'to answer "is August done / what is still not reported to AT / when is it due"; applicable:false (200) ' +
      'when the entity has no PT registration. This tool never returns the XML file itself; download it via ' +
      'GET /v1/pt/saft?period=... directly. A month with no PT documents at all is a valid, empty result ' +
      '(numberOfEntries 0), never an error. 400 means period is missing/not YYYY-MM, or (summary only) the ' +
      'entity has no registered PT NIF. 409 (summary only) means generation was refused: code ' +
      'PT_SAFT_SERIES_GAP (an unexplained numbering gap — see gaps for exactly which numbers) or ' +
      'PT_SAFT_NEEDS_INFO (one or more documents need more information before the file can be built — see ' +
      'issues for which ones and why).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        period: { type: 'string', description: 'Calendar month to summarise, as "YYYY-MM" (e.g. "2026-06").' },
        format: { type: 'string', enum: ['summary', 'status'], description: '"summary" (default) builds the file and returns its manifest; "status" returns the cheap counts/attention view without building anything.' },
        entityId: { type: 'string', description: 'Required for account-scoped keys; omit for entity-scoped keys.' },
      },
      required: ['period'],
    },
  },
  // Consolidated cross-jurisdiction transaction view — MCP twin of GET /v1/mandate-transactions.
  {
    name: 'list_mandate_transactions',
    description:
      'Query the consolidated cross-jurisdiction transaction view — one row per resolved (or in-progress) mandate ' +
      'decision, whatever mechanism it resolved to (per-document e-invoicing clearance, an aggregate accumulate-then' +
      '-flush e-report, or no mandate at all). Pass uploadBatchId to see every row a specific bulk upload produced, ' +
      'or omit it and use state/mandate/period/country/from/to to query more broadly. state="HELD" is the direct ' +
      'answer to "which transactions reference a client tax code that does not exist" — inspect each held row\'s ' +
      'holdReason (e.g. HELD_UNMAPPED_TAX_CODE naming the missing code) and actionOwner ("customer" means only you ' +
      'can fix it, typically by calling create_client_tax_code; "platform" means it is a Clearvo-side gap). Each row ' +
      'also carries provenance.matchedRule (which compliance-mandate rule fired) and terminalArtifact (the resulting ' +
      'einvoice or reporting period, when one exists yet).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        uploadBatchId: { type: 'string', description: 'Exact match — every row a specific bulk upload (sync or async) produced. NULL for a row from a single-document submit_invoice, so this filter naturally excludes those.' },
        state: { type: 'string', enum: ['PENDING', 'RESOLVED', 'NEEDS_INFO', 'HELD_UNKNOWN_MANDATE', 'OBLIGATION_DISABLED', 'HELD_UNMAPPED_DECISION', 'RECEIVED', 'HELD', 'OPEN', 'ACCUMULATED-OPEN-PERIOD', 'CLOSED', 'SUBMITTED', 'FILED', 'CLEARED'], description: 'Case-insensitive. HELD is an alias covering HELD_UNKNOWN_MANDATE + OBLIGATION_DISABLED + HELD_UNMAPPED_DECISION (which includes HELD_UNMAPPED_TAX_CODE as a holdReason). OPEN/ACCUMULATED-OPEN-PERIOD, CLOSED, SUBMITTED, FILED are reporting-period status aliases; CLEARED means einvoicing_records.cleared_at is set.' },
        mandate: { type: 'string', description: 'Exact match against the resolved Compliance Mandate, e.g. "FR_EINVOICING", "FR_EREPORTING", "ES_SII", "NONE".' },
        period: { type: 'string', description: 'Exact match against the reporting period key, e.g. "2026-09-D1" for a France décade.' },
        country: { type: 'string', description: 'ISO-3166-1 alpha-2, exact match, case-insensitive.' },
        from: { type: 'string', description: 'YYYY-MM-DD — issue_date >= this date.' },
        to: { type: 'string', description: 'YYYY-MM-DD — issue_date <= this date.' },
        page: { type: 'number', description: 'Page number, 1-based (default 1)' },
        limit: { type: 'number', description: 'Results per page, 1-200 (default 50)' },
        entityId: { type: 'string', description: 'Required for account-scoped keys; omit for entity-scoped keys.' },
      },
    },
  },
] as const;

async function handleTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'submit_invoice': {
      // Derive a stable idempotency key from invoice identity fields
      const idempotencyKey = createHash('sha256')
        .update(`${args.invoiceNumber ?? ''}|${args.country ?? ''}|${args.issueDate ?? ''}`)
        .digest('hex')
        .slice(0, 64);
      // Default documentType to 'invoice' if not provided
      const body = { documentType: 'invoice', ...args };
      return callApi('POST', '/send', body, { 'x-idempotency-key': idempotencyKey });
    }

    case 'amend_sii_report': {
      const { id, idempotencyKey, ...body } = args as { id: string; idempotencyKey?: string } & Record<string, unknown>;
      const key = idempotencyKey ?? createHash('sha256').update(`amend|${id}|${JSON.stringify(body)}`).digest('hex').slice(0, 64);
      return callApi('POST', `/invoices/${encodeURIComponent(id)}/amend-report`, body, { 'x-idempotency-key': key });
    }

    case 'cancel_sii_report': {
      const { id, idempotencyKey, ...body } = args as { id: string; idempotencyKey?: string } & Record<string, unknown>;
      const key = idempotencyKey ?? createHash('sha256').update(`cancel|${id}`).digest('hex').slice(0, 64);
      return callApi('POST', `/invoices/${encodeURIComponent(id)}/cancel-report`, body, { 'x-idempotency-key': key });
    }

    case 'get_sii_reconciliation': {
      const { id } = args as { id: string };
      return callApi('GET', `/sii/reconciliation/${encodeURIComponent(id)}`);
    }

    case 'poll_status': {
      const id = args.referenceId as string;
      const country = args.country as string;
      return callApi('GET', `/status?id=${encodeURIComponent(id)}&country=${encodeURIComponent(country)}`);
    }

    case 'calculate_tax':
      // Forward as-is — the API defaults an omitted `commit` to true
      // (persisted/billed/counted toward Compliance Radar), and this tool
      // intentionally matches that default rather than overriding it. Set
      // commit: false explicitly to get a preview instead.
      return callApi('POST', '/tax/calculate', args);

    case 'validate_tax_number': {
      const { country, taxNumber, registryType, force } = args as { country: string; taxNumber: string; registryType?: string; force?: boolean };
      return callApi('POST', '/tax-numbers/validate', { countryCode: country, taxNumber, ...(registryType && { registryType }), ...(force && { force }) });
    }

    case 'list_entities':
      return callApi('GET', '/entities');

    case 'create_entity':
      return callApi('POST', '/entities', args);

    case 'update_entity': {
      const { entityId, ...updates } = args as { entityId: string } & Record<string, unknown>;
      return callApi('PATCH', `/entities/${encodeURIComponent(entityId)}`, updates);
    }

    case 'set_ar_credentials': {
      const { entityId, ...rest } = args as { entityId?: string } & Record<string, unknown>;
      return callApi('POST', '/ar/credentials', rest, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'set_pl_credentials': {
      const { entityId, ...rest } = args as { entityId?: string } & Record<string, unknown>;
      return callApi('POST', '/pl/credentials', rest, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'set_hu_credentials': {
      const { entityId, ...rest } = args as { entityId?: string } & Record<string, unknown>;
      return callApi('POST', '/hu/credentials', rest, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'set_pt_credentials': {
      const { entityId, ...rest } = args as { entityId?: string } & Record<string, unknown>;
      return callApi('POST', '/pt/credentials', rest, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'set_fr_credentials': {
      const { entityId, ...rest } = args as { entityId?: string } & Record<string, unknown>;
      return callApi('POST', '/fr/credentials', rest, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'get_fr_credentials': {
      const { entityId } = args as { entityId?: string };
      return callApi('GET', '/fr/credentials', undefined, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'poll_fr_inbound': {
      const { entityId } = args as { entityId?: string };
      return callApi('POST', '/fr/inbound/poll', {}, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'update_business_status': {
      const { id, entityId, ...body } = args as { id: string; entityId?: string } & Record<string, unknown>;
      return callApi('PATCH', `/invoices/${encodeURIComponent(id)}/business-status`, body, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'set_eg_credentials': {
      const { entityId, ...rest } = args as { entityId?: string } & Record<string, unknown>;
      return callApi('POST', '/eg/credentials', rest, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'set_jo_credentials': {
      const { entityId, ...rest } = args as { entityId?: string } & Record<string, unknown>;
      return callApi('POST', '/jo/credentials', rest, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'set_mx_credentials': {
      const { entityId, ...rest } = args as { entityId?: string } & Record<string, unknown>;
      return callApi('POST', '/mx/credentials', rest, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'push_mx_cfdi': {
      const { entityId, documentXml } = args as { entityId?: string; documentXml: string };
      return callApi('POST', '/mx/inbound/cfdi', { documentXml }, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'get_mx_sync_status': {
      const { entityId } = args as { entityId?: string };
      return callApi('GET', '/mx/sync-status', undefined, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'invite_team_member':
      return callApi('POST', '/team/invites', args);

    case 'create_exemption_certificate': {
      const { entityId, ...rest } = args as { entityId?: string } & Record<string, unknown>;
      return callApi('POST', '/tax/exemptions', rest, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'upload_exemption_document': {
      const { certificateId, documentBase64, entityId } = args as { certificateId: string; documentBase64: string; entityId?: string };
      const buffer = Buffer.from(documentBase64, 'base64');
      if (buffer.length > MAX_EXEMPTION_DOCUMENT_BYTES) {
        throw new Error(`documentBase64 decodes to ${buffer.length} bytes, exceeding the ${MAX_EXEMPTION_DOCUMENT_BYTES / (1024 * 1024)}MB limit for exemption certificate documents.`);
      }
      // Buffer.from(..., 'base64') is lenient — malformed input (stray characters,
      // a data: URI prefix, truncation) is silently skipped rather than throwing,
      // which would otherwise produce a garbage/empty file that still "succeeds"
      // since we hardcode the content-type and filename ourselves regardless of
      // actual content. Check the PDF magic bytes so a bad payload fails loudly
      // here instead of silently storing a corrupted certificate document.
      if (buffer.length < 4 || buffer.subarray(0, 4).toString('latin1') !== '%PDF') {
        throw new Error('documentBase64 does not decode to a valid PDF (missing %PDF header). Check the value is base64-encoded PDF file content with no surrounding data: URI prefix or whitespace.');
      }
      const formData = new FormData();
      formData.append('document', new Blob([buffer], { type: 'application/pdf' }), 'certificate.pdf');
      return callApi('POST', `/tax/exemptions/${encodeURIComponent(certificateId)}/document`, formData, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'get_requirements': {
      const country = args.country as string;
      return callApi('GET', `/requirements?country=${encodeURIComponent(country)}`);
    }

    case 'list_invoices': {
      const qs = new URLSearchParams();
      if (args.country)   qs.set('country',   args.country   as string);
      if (args.status)    qs.set('status',    args.status    as string);
      if (args.limit)     qs.set('limit',     String(args.limit));
      if (args.after_id)  qs.set('after_id',  args.after_id  as string);
      if (args.before_id) qs.set('before_id', args.before_id as string);
      if (args.receivedAfter) qs.set('receivedAfter', args.receivedAfter as string);
      const q = qs.toString();
      return callApi('GET', `/invoices${q ? `?${q}` : ''}`);
    }

    case 'get_invoice': {
      const id = args.id as string;
      return callApi('GET', `/invoices/${encodeURIComponent(id)}`);
    }

    case 'list_products': {
      const qs = new URLSearchParams();
      if (args.entityId) qs.set('entityId', args.entityId as string);
      if (args.limit)    qs.set('limit',    String(args.limit));
      if (args.page)     qs.set('page',     String(args.page));
      if (args.sort)     qs.set('sort',     args.sort as string);
      const q = qs.toString();
      return callApi('GET', `/products${q ? `?${q}` : ''}`);
    }

    case 'create_product':
      return callApi('POST', '/products', args);

    case 'update_product': {
      const { productId, ...updates } = args as { productId: string } & Record<string, unknown>;
      return callApi('PATCH', `/products/${encodeURIComponent(productId)}`, updates);
    }

    case 'list_webhooks': {
      const qs = new URLSearchParams();
      if (args.limit) qs.set('limit', String(args.limit));
      if (args.page)  qs.set('page',  String(args.page));
      const q = qs.toString();
      return callApi('GET', `/webhooks${q ? `?${q}` : ''}`);
    }

    case 'create_webhook':
      return callApi('POST', '/webhooks', args);

    case 'delete_webhook': {
      const webhookId = args.webhookId as string;
      return callApi('DELETE', `/webhooks?id=${encodeURIComponent(webhookId)}`);
    }

    case 'validate_tax_numbers_batch':
      return callApi('POST', '/tax-numbers/validate-batch', args);

    case 'list_registrations': {
      const qs = new URLSearchParams();
      if (args.entityId) qs.set('entityId', args.entityId as string);
      const q = qs.toString();
      return callApi('GET', `/tax/registrations${q ? `?${q}` : ''}`);
    }

    case 'add_registration':
      return callApi('POST', '/tax/registrations', args);

    case 'set_registration_collection': {
      const { registrationId, collectFromDate } = args as { registrationId: string; collectFromDate: string | null };
      return callApi('PATCH', `/tax/registrations/${encodeURIComponent(registrationId)}`, { collectFromDate });
    }

    case 'deregister_registration': {
      const { registrationId, effectiveDate } = args as { registrationId: string; effectiveDate: string | null };
      return callApi('PATCH', `/tax/registrations/${encodeURIComponent(registrationId)}`, { effectiveDate });
    }

    case 'update_registration': {
      const { registrationId, extraFields } = args as { registrationId: string; taxNumber?: string | null; extraFields?: Record<string, string | null> };
      const body: Record<string, unknown> = {};
      if ('taxNumber' in args) body.taxNumber = args.taxNumber;
      if (extraFields !== undefined) body.extraFields = extraFields;
      return callApi('PATCH', `/tax/registrations/${encodeURIComponent(registrationId)}`, body);
    }

    case 'get_registration_field_definitions': {
      const { country, region, scheme } = args as { country: string; region?: string; scheme?: string };
      const qs = new URLSearchParams({ country });
      if (region !== undefined) qs.set('region', region);
      if (scheme !== undefined) qs.set('scheme', scheme);
      return callApi('GET', `/tax/registrations/field-definitions?${qs.toString()}`);
    }

    case 'get_entity_fact_definitions':
      return callApi('GET', '/entities/fact-definitions');

    case 'list_tax_calculations': {
      const qs = new URLSearchParams();
      if (args.entityId) qs.set('entityId', args.entityId as string);
      if (args.country)  qs.set('country',  args.country  as string);
      if (args.limit)    qs.set('limit',    String(args.limit));
      if (args.page)     qs.set('page',     String(args.page));
      const q = qs.toString();
      return callApi('GET', `/tax/calculate${q ? `?${q}` : ''}`);
    }

    case 'get_query_fields':
      return callApi('GET', '/query/fields');

    case 'query_data': {
      const { dataset, filters, columns, limit, from, to, cursor } = args as {
        dataset: string; filters?: unknown; columns?: unknown; limit?: number; from?: string; to?: string; cursor?: string;
      };
      return callApi('POST', '/query', { dataset, filters, columns, limit, from, to, cursor });
    }

    case 'get_setup_status':
      return callApi('GET', '/setup/status');

    case 'get_tax_settings':
      return callApi('GET', '/tax/settings');

    case 'update_tax_settings': {
      const { vatValidationMode, vatUnverifiableTreatment, defaultPriceIncludesTax, defaultTaxCategorySlug, usAddressPrecision, confirmed } = args;
      return callApi('PATCH', '/tax/settings', { vatValidationMode, vatUnverifiableTreatment, defaultPriceIncludesTax, defaultTaxCategorySlug, usAddressPrecision, confirmed });
    }

    case 'get_reporting_obligations':
      return callApi('GET', '/tax/reporting-obligations');

    case 'update_reporting_obligations': {
      const { obligations, confirm, force } = args as { obligations?: Record<string, unknown>; confirm?: boolean; force?: boolean };
      return callApi('PATCH', '/tax/reporting-obligations', { obligations, confirm, force });
    }

    case 'list_reporting_batches': {
      const { id } = args as { id?: string };
      if (id) return callApi('GET', `/reporting-batches/${encodeURIComponent(id)}`);
      const qs = new URLSearchParams();
      for (const k of ['status', 'entityId', 'page', 'limit'] as const) if (args[k] !== undefined) qs.set(k, String(args[k]));
      const q = qs.toString();
      return callApi('GET', `/reporting-batches${q ? `?${q}` : ''}`);
    }

    case 'run_reporting_batch_sweep': {
      const { today, madridToday } = args as { today?: string; madridToday?: string };
      return callApi('POST', '/test-helpers/reporting-batches/run-sweep', { today, madridToday });
    }

    case 'list_customers': {
      const { entityId, ...rest } = args as { entityId?: string } & Record<string, unknown>;
      const qs = new URLSearchParams();
      if (rest.search) qs.set('search', rest.search as string);
      if (rest.page)   qs.set('page',   String(rest.page));
      if (rest.limit)  qs.set('limit',  String(rest.limit));
      const q = qs.toString();
      return callApi('GET', `/customers${q ? `?${q}` : ''}`, undefined, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'create_customer': {
      const { entityId, ...rest } = args as { entityId?: string } & Record<string, unknown>;
      return callApi('POST', '/customers', rest, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'update_customer': {
      const { customerId, entityId, ...updates } = args as { customerId: string; entityId?: string } & Record<string, unknown>;
      return callApi('PATCH', `/customers/${encodeURIComponent(customerId)}`, updates, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'upsert_customer_by_ref': {
      const { customerRef, entityId, ...rest } = args as { customerRef: string; entityId?: string } & Record<string, unknown>;
      return callApi('PUT', `/customers/by-ref/${encodeURIComponent(customerRef)}`, rest, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'delete_customer': {
      const { customerId, entityId } = args as { customerId: string; entityId?: string };
      return callApi('DELETE', `/customers/${encodeURIComponent(customerId)}`, undefined, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'list_suppliers': {
      const { entityId, ...rest } = args as { entityId?: string } & Record<string, unknown>;
      const qs = new URLSearchParams();
      if (rest.search) qs.set('search', rest.search as string);
      if (rest.page)   qs.set('page',   String(rest.page));
      if (rest.limit)  qs.set('limit',  String(rest.limit));
      const q = qs.toString();
      return callApi('GET', `/suppliers${q ? `?${q}` : ''}`, undefined, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'create_supplier': {
      const { entityId, ...rest } = args as { entityId?: string } & Record<string, unknown>;
      return callApi('POST', '/suppliers', rest, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'update_supplier': {
      const { supplierId, entityId, ...updates } = args as { supplierId: string; entityId?: string } & Record<string, unknown>;
      return callApi('PATCH', `/suppliers/${encodeURIComponent(supplierId)}`, updates, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'delete_supplier': {
      const { supplierId, entityId } = args as { supplierId: string; entityId?: string };
      return callApi('DELETE', `/suppliers/${encodeURIComponent(supplierId)}`, undefined, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'list_check_families': {
      const { entityId } = args as { entityId?: string };
      return callApi('GET', '/rules/families', undefined, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'toggle_check_family': {
      const { checkFamily, entityId, ...rest } = args as { checkFamily: string; entityId?: string } & Record<string, unknown>;
      return callApi('PATCH', `/rules/families/${encodeURIComponent(checkFamily)}`, rest, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'get_skip_transactions': {
      const { entityId } = args as { entityId?: string };
      return callApi('GET', '/skip-transactions', undefined, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'set_skip_transactions': {
      const { entityId, ...rest } = args as { entityId?: string } & Record<string, unknown>;
      return callApi('PUT', '/skip-transactions', rest, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'disable_skip_transactions': {
      const { entityId } = args as { entityId?: string };
      return callApi('DELETE', '/skip-transactions', undefined, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'list_client_tax_codes': {
      const { entityId } = args as { entityId?: string };
      return callApi('GET', '/tax/client-codes', undefined, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'list_tax_codes': {
      const { entityId, ...params } = args as { entityId?: string } & Record<string, unknown>;
      const qs = new URLSearchParams();
      for (const key of ['code', 'vocabulary', 'country', 'sourceSystem', 'date'] as const) {
        if (params[key] !== undefined) qs.set(key, String(params[key]));
      }
      const q = qs.toString();
      return callApi('GET', `/tax/codes${q ? `?${q}` : ''}`, undefined, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'create_client_tax_code': {
      const { entityId, ...body } = args as { entityId?: string } & Record<string, unknown>;
      return callApi('POST', '/tax/client-codes', body, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'update_client_tax_code': {
      const { clientTaxCodeId, entityId, ...updates } = args as { clientTaxCodeId: string; entityId?: string } & Record<string, unknown>;
      return callApi('PATCH', `/tax/client-codes/${encodeURIComponent(clientTaxCodeId)}`, updates, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'delete_client_tax_code': {
      const { clientTaxCodeId, entityId } = args as { clientTaxCodeId: string; entityId?: string };
      return callApi('DELETE', `/tax/client-codes/${encodeURIComponent(clientTaxCodeId)}`, undefined, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'get_client_tax_code_options': {
      const { country, region, direction, entityId } = args as { country?: string; region?: string; direction?: string; entityId?: string };
      const qs = new URLSearchParams();
      if (country) qs.set('country', country);
      if (region) qs.set('region', region);
      if (direction) qs.set('direction', direction);
      const q = qs.toString();
      return callApi('GET', `/tax/client-codes/options${q ? `?${q}` : ''}`, undefined, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'get_client_tax_code_exemption_reason_options': {
      const { entityId, ...params } = args as { entityId?: string } & Record<string, unknown>;
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) if (value != null) qs.set(key, String(value));
      const q = qs.toString();
      return callApi('GET', `/tax/client-codes/exemption-reasons${q ? `?${q}` : ''}`, undefined, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'get_pt_monthly_saft': {
      const { period, entityId, format } = args as { period: string; entityId?: string; format?: string };
      // Only the two JSON shapes are ever requested here — never the XML file (see the tool's
      // own comment above). Anything other than 'status' falls back to the summary manifest.
      const qs = new URLSearchParams({ period, format: format === 'status' ? 'status' : 'summary' });
      return callApi('GET', `/pt/saft?${qs.toString()}`, undefined, entityId ? { 'x-entity-id': String(entityId) } : undefined);
    }

    case 'list_mandate_transactions': {
      const { entityId } = args as { entityId?: string };
      const qs = new URLSearchParams();
      for (const k of ['uploadBatchId', 'state', 'mandate', 'period', 'country', 'from', 'to', 'page', 'limit', 'entityId'] as const) {
        if (args[k] !== undefined) qs.set(k, String(args[k]));
      }
      const q = qs.toString();
      // entityId is forwarded BOTH ways: as x-entity-id so the backend can resolve entity
      // context for an account-scoped key at all, and as a query param, which the route
      // separately reads as its own secondary filter (same convention as GET /v1/invoices).
      return callApi('GET', `/mandate-transactions${q ? `?${q}` : ''}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
    }

    case 'submit_invoices_bulk': {
      const { csvContent, entityId } = args as { csvContent: string; entityId?: string };
      const rowCount = countCsvDataRows(csvContent);
      const byteLength = Buffer.byteLength(csvContent, 'utf8');
      if (rowCount > MAX_BULK_ROWS || byteLength > MAX_BULK_UPLOAD_BYTES) {
        throw new Error(
          `This CSV has ${rowCount} data rows (${byteLength} bytes) — submit_invoices_bulk accepts at most ${MAX_BULK_ROWS} rows ` +
          `and ${MAX_BULK_UPLOAD_BYTES / (1024 * 1024)}MB per call. Use submit_invoices_bulk_async instead for a file this size — ` +
          'no request was sent.',
        );
      }
      return callApi('POST', '/send/bulk', csvFormData(csvContent, 'invoices.csv'), entityId ? { 'x-entity-id': entityId } : undefined);
    }

    case 'submit_invoices_bulk_async': {
      const { csvContent, filename, entityId } = args as { csvContent: string; filename?: string; entityId?: string };
      return callApi('POST', '/send/bulk', csvFormData(csvContent, filename || 'invoices.csv'), entityId ? { 'x-entity-id': entityId } : undefined);
    }

    case 'get_bulk_upload_status': {
      const { batchId, entityId } = args as { batchId: string; entityId?: string };
      return callApi('GET', `/send/bulk/${encodeURIComponent(batchId)}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
    }

    case 'list_bulk_upload_errors': {
      const { batchId, page, limit, entityId } = args as { batchId: string; page?: number; limit?: number; entityId?: string };
      const qs = new URLSearchParams();
      if (page != null) qs.set('page', String(page));
      if (limit != null) qs.set('limit', String(limit));
      const q = qs.toString();
      return callApi('GET', `/send/bulk/${encodeURIComponent(batchId)}/errors${q ? `?${q}` : ''}`, undefined, entityId ? { 'x-entity-id': entityId } : undefined);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: 'clearvo', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, (args ?? {}) as Record<string, unknown>);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
server.connect(transport).catch((err: unknown) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
