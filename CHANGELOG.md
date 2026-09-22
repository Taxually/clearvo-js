# Changelog

Packages in this repo are versioned independently. Dates are release-prep dates; the product owner publishes to npm.

## Unreleased — publish only AFTER the FR credentials backend PR has merged and deployed

Backend PR: Taxually-Einvoicing #16203 (`claude/fr-credentials-api`), `POST`/`GET /v1/fr/credentials`. Until it is live in production, these SDK/MCP/CLI calls 404. No secret is stored by this endpoint — it registers/reads back the entity's own French VAT number and reports honest per-capability onboarding status (`active` / `pending_activation` / `sandbox`) instead of a blind "saved", mirroring the pattern Poland's `set_pl_credentials`/`get_pl_credentials` already established.

### @clearvo/sdk 0.2.0 (additive, non-breaking)

- New `setFrCredentials(input: SetFrCredentialsInput): Promise<FrCredentialsResponse>` and `getFrCredentials(entityId?: string): Promise<FrCredentialsResponse>`. `SetFrCredentialsInput` accepts only `taxNumber` (French VAT number; SIREN is derived read-only in the response, never a request field) plus the usual optional `entityId` for account-scoped keys.
- `FrCredentialsResponse` always returns `200`: `sandbox` (matches the API key's environment, not a request field), `credentialStatus` (`active | pending_activation | sandbox | not_registered`), per-capability `capabilities.{einvoicing,ereporting}` (status/label/message/actionOwner), `verification.method: 'platform_configuration'` (a config check, never a live authority/partner call), `nextSteps` with `requiredInputs` for any placeholder field, `siren`/`siret` read-only, `previousTaxNumber` on overwrite, and `createdAt`/`updatedAt`.
- New `updateBusinessStatus(input: UpdateBusinessStatusInput): Promise<UpdateBusinessStatusResponse>` and `pollFrInbound(entityId?: string): Promise<FrInboundPollResponse>` — SDK parity for the already-shipped `PATCH /v1/invoices/{id}/business-status` and `POST /v1/fr/inbound/poll` endpoints (no wire-shape change, just SDK coverage catching up).

### @clearvo/mcp 0.3.0 (additive, non-breaking)

- New `set_fr_credentials` / `get_fr_credentials` tools, matching the SDK methods above one-for-one. Tool descriptions are explicit that `verification.method` is a configuration check, not a live check against the tax authority or the platform's France delivery partner.
- New `poll_fr_inbound` / `update_business_status` tools for the endpoints named above.

### @clearvo/cli 0.2.0 (additive, non-breaking)

- New `clearvo fr credentials set --tax-number <taxNumber> [--entity <entityId>]` and `clearvo fr credentials get [--entity <entityId>]`.
- New `clearvo fr inbound poll [--entity <entityId>]` for manually triggering the France inbound poll (the automatic poll already runs every 5 minutes).

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
