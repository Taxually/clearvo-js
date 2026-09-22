# Changelog

Packages in this repo are versioned independently. Dates are release-prep dates; the product owner publishes to npm.

## Unreleased — publish only AFTER the partner-org-provisioning backend PR has merged and deployed

Backend PR: Taxually-Einvoicing #16188 (`claude/partner-org-provisioning`), `POST /v1/organisations`. Until it is live in production, calling this SDK method 403s for every key — it only ever authenticates a `partner`-scoped key, which is minted manually per tenant, not self-serve.

### @clearvo/sdk 0.2.0 (additive, non-breaking)

- New `createOrganisation(input: CreateOrganisationInput): Promise<CreateOrganisationResponse>` — calls `POST /organisations`. For white-label partners only: requires a `partner`-scoped API key (bound to the partner's tenant, issued manually — see the platform docs' Partners section). Any other key scope gets a 403.
- Creates a new Organisation + its first (default) Entity in one call and returns a freshly minted **organisation**-scoped API key in the response, once — the same mint-once pattern as `createEntity()`. Nothing else needs to be captured to make the next call (`createEntity()`/credentials setup) work.
- Request shape is deliberately shell-only: `name`, optional `externalReference` (your own idempotency key — a repeat call with the same value under the same tenant returns `409` with the existing `organisationId` and no key), `solutions` (non-empty subset of `'einvoicing' | 'tax_number_validation' | 'tax_calculations' | 'ecm'`), `entity: { legalName, country, address? }`. No tax-identity or credential field belongs in this input — sending one (e.g. `vatNumber`) is rejected with `422`.
- No MCP tool and no CLI command for this endpoint — deliberate. It authenticates a narrow, tenant-bound partner key that is never issued to an interactive human or agent session (MCP/CLI both assume an entity- or organisation-scoped key reachable from a normal account), so exposing it there would suggest a self-serve flow that doesn't exist.
- `solutions` is typed as `'einvoicing' | 'tax_number_validation' | 'tax_calculations' | 'ecm'` — the four current `ALL_SOLUTION_CODES`. `periodic_reporting` is not a valid value (folded into `einvoicing` by the `unify-einvoicing-reporting` collapse, migration `V20260916100000`); the server 422s if sent.

## Unreleased — publish only AFTER the backend rename has deployed

Backend PR: Taxually-Einvoicing branch `claude/vat-rate-to-tax-rate-rename`. Until it is live in production, the API still expects the old names, so these versions must not be published before it.

### @clearvo/sdk 0.2.0

**BREAKING** — e-invoicing line items (`LineItemInput`) use `taxRate` and `taxAmount`. The platform is global (VAT, GST and sales tax), so no API field name is tax-type-specific — the same convention `/tax/calculate` already followed.

- `taxRate` (was `vatRate`) — tax rate as a percentage, 0–100. **Always required** (now a required property on `LineItemInput`), even when `clientTaxCode` is supplied — missing/out-of-range is a 400 naming the field. A 0% line with no `clientTaxCode`/`taxTreatment` is rejected with `400 ZERO_RATE_NEEDS_TAX_TREATMENT` (it is not held NEEDS_INFO).
- `taxAmount` (was `vatAmount`) — optional; computed as `taxRate × line total` when omitted.
- Every response that echoes lines (including `GET /invoices/{id}`) returns `taxRate`/`taxAmount` too.
- Failure mode if you don't upgrade: the API rejects a request that still carries `lines[].vatRate` or `lines[].vatAmount` with **`422`** and `details[].code = "UNKNOWN_FIELD_VAT_RENAMED"`, each detail naming the `tax`-named replacement. There is no silent alias.
- **BREAKING** — the rest of the line item now matches the backend's canonical names too, so `/send` has one consistent line-item contract:
  - `discountPercent` (was `discount`) — percentage 0–100; new `discountAmount` — absolute amount; the two are mutually exclusive.
  - `unitOfMeasure` (was `unit`) — UN/ECE Rec. 20 unit code.
  - `sellerItemId` (was `itemCode`) — your own item identifier / SKU.
  - New optional `lineNumber` — 1-based position, defaults to the index in `lines[]`.
  - The retired `discount`/`unit`/`itemCode`/`exemption` line keys are rejected by the API with **`422`** and `details[].code = "UNKNOWN_FIELD_LINE_RENAMED"` — the same shape as `UNKNOWN_FIELD_VAT_RENAMED`.
- Invoice responses (`submit_invoice` result, `GET /invoices`, `GET /invoices/{id}`) carry `totalTax` (was `totalVat`). The SDK does not model the invoice totals block as a typed shape (`ListInvoicesResponse.invoices` is `unknown[]`), so this is a wire-level change with no type rename here.
- New compile-time guard `type-tests/vat-rate-to-tax-rate.test-d.ts` keeps all five retired names (`vatRate`, `vatAmount`, `discount`, `unit`, `itemCode`) off `LineItemInput`.
- Full `LineItemInput` field list — required: `description`, `quantity`, `unitPrice`, `taxRate`; optional: `taxAmount`, `clientTaxCode`, `taxTreatment`, `customerType`, `supplyType`, `lineNumber`, `discountPercent`, `discountAmount`, `unitOfMeasure`, `sellerItemId`.
- Unchanged: `clientTaxCode`/`taxTreatment`, and the Spain SII purchase-side `deductibleVatAmount` (CuotaDeducible).

### @clearvo/mcp 0.3.0

**BREAKING** — `submit_invoice` `lines[]` input schema: `vatRate` → `taxRate` (now in the line's `required` list); new optional `taxAmount` (was `vatAmount`); added `lineNumber`, `discountPercent` | `discountAmount`, `unitOfMeasure`, `sellerItemId` (the retired `discount`/`unit`/`itemCode`/`exemption` are rejected with `422 UNKNOWN_FIELD_LINE_RENAMED`). Tool descriptions for `submit_invoice` and `get_invoice` document the renames, the `422 UNKNOWN_FIELD_VAT_RENAMED` / `422 UNKNOWN_FIELD_LINE_RENAMED` rejections, and `totalTax` on responses. Desktop Extension manifest version aligned to 0.3.0.

### @clearvo/cli 0.2.0

**BREAKING** — `clearvo send <file>`: the invoice JSON's line items must use `taxRate`/`taxAmount`, `lineNumber`, `discountPercent` | `discountAmount`, `unitOfMeasure`, `sellerItemId`. A file still using `vatRate`/`vatAmount` is rejected by the API with `422 UNKNOWN_FIELD_VAT_RENAMED`; `discount`/`unit`/`itemCode`/`exemption` are rejected with `422 UNKNOWN_FIELD_LINE_RENAMED`. Responses carry `totalTax` (was `totalVat`).
