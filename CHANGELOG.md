# Changelog

Packages in this repo are versioned independently. Dates are release-prep dates; the product owner publishes to npm.

## Unreleased — publish only AFTER the entity establishment-country backend PR has merged and deployed

Backend: Taxually-Einvoicing entity `establishmentCountry` PR. Until it is live, `PATCH /v1/entities/{id}` ignores or rejects `establishmentCountry` and `GET` does not return it. It is where the legal entity is established (2-letter ISO code, or null = established in its own `country`), distinct from where it holds VAT registrations. It decides which French e-invoicing / e-reporting rules apply: a company established in Germany but VAT-registered in France is not established in France. Not settable on entity create.

### @clearvo/sdk (additive, non-breaking)

- `Entity.establishmentCountry` and `UpdateEntityInput.establishmentCountry` (`string | null`; invalid code returns 400 `INVALID_ESTABLISHMENT_COUNTRY`).

### @clearvo/mcp (additive)

- `update_entity`: `establishmentCountry` (2-letter ISO code, or null to clear). `list_entities` description now says "home country" rather than "country of establishment".

### @clearvo/cli (additive)

- No new flags (the CLI has no `entities update`); `entities get` prints `establishmentCountry` as returned by the API. `entities create --country` help now says "Home country" to avoid confusion with establishment.

## Unreleased — publish only AFTER the Peppol for Germany backend PR has merged and deployed

Backend branch: Taxually-Einvoicing `claude/peppol-germany`. Until it is live, `PEPPOL` as a German invoice format is rejected and the received-document fields are absent. Germany can now send an invoice to the buyer over the Peppol network (Peppol BIS Billing 3.0), and every received Peppol or e-invoice reports what was checked and has a readable PDF copy. Not supported: Peppol self-billing and credit/debit notes for Germany.

### @clearvo/sdk (additive, non-breaking)

- New `DeInvoiceFormat` (`ZUGFERD` | `XRECHNUNG` | `PEPPOL`); `UpdateEntityInput.defaultDeInvoiceFormat` and `Entity.defaultDeInvoiceFormat`; `countrySpecific.de.invoiceFormat` documented with the Peppol requirements and error codes.
- `InvoiceSubmitResponse` gains `documentFormat` (`UBL_PEPPOL_BIS`) and `delivery { channel: 'NETWORK', receiver, evidence }`. New `PeppolCustomerUnreachableResponse` type for the 422 `PEPPOL_CUSTOMER_UNREACHABLE` body (`reason`, `alternatives[]`, `evidence`).
- New `InboundValidation`, `ValidationOutcome` (now includes `BUSINESS_RULE_ERROR`, `NOT_VALIDATED`) and `ReceivedInvoiceFields` (`intakeChannel`, `receivedAt`, `validation`, `attachments`, `rendition`, `supersededBy`) for received rows from `listInvoices`.

### @clearvo/mcp (additive)

- `submit_invoice`: description covers Germany over Peppol (requirements, response, `PEPPOL_CUSTOMER_UNREACHABLE` and the new error codes, dry-run); `customer.endpointSchemeId` / `customer.endpointId` added.
- `update_entity`: `defaultDeInvoiceFormat`. `create_customer`, `update_customer`, `upsert_customer_by_ref`: `countrySpecific.de.invoiceFormat`.
- `list_invoices`, `get_invoice`: descriptions cover the received-document fields and the readable PDF copy.

### @clearvo/cli (additive)

- `clearvo send` help text covers the Germany `PEPPOL` format and `--dry-run` behaviour for it.

## Unreleased — publish only AFTER the Spain VeriFactu Canary Islands backend PR has merged and deployed

Backend branch: Taxually-Einvoicing `claude/es-verifactu-igic-f2`. Until it is live, the new `countrySpecific.es` keys are ignored or rejected by the API. Clearvo registers Canary Islands (IGIC) invoices with the AEAT VeriFactu system under the same Spanish tax number; it does not file IGIC returns or the Canary SII.

### Rate-band vocabulary (BREAKING, all packages) — publish only after the rate-band-vocabulary backend PR has deployed

The public API now uses the central rates database's band names. Client tax code `rateBand` is `standard | middle | reduced | super_reduced | special | zero` (was `standard | reduced | second_reduced | super_reduced | zero`). Old `reduced` means what is now `middle`; old `second_reduced` is now `reduced`. `taxTreatmentOverride` is `STANDARD | MIDDLE | REDUCED | SUPER_REDUCED | SPECIAL | EXEMPT | ZERO` (`SECOND_REDUCED` removed). Affects `ClientTaxCodeRateBand` and `taxTreatmentOverride` (SDK), the `create_client_tax_code` / `update_client_tax_code` / `list_tax_codes` / `calculate_tax` schemas (MCP) and `--rate-band` (CLI).

### @clearvo/sdk (additive, non-breaking)

- `SubmitInvoiceInput.customer` is now `CustomerPartyInput` (`PartyInput` with `name` optional): a Spain VeriFactu simplified invoice (F2/R5, no customer identification) may omit it. Every other country still requires it server-side.
- New types `EsCountrySpecific`, `EsCustomerIdType`, `EsTaxTerritory`; `countrySpecific.es.customerIdType`, `es.noRecipientIdentification`, `es.numRegistroAcuerdoFacturacion` documented. `UpdateRegistrationInput.extraFields` documents `es_tax_territory` (`mainland` | `canary_islands` | `both`).

### @clearvo/mcp (additive)

- `submit_invoice`: `countrySpecific.es.customerIdType`, `noRecipientIdentification`, `numRegistroAcuerdoFacturacion`, `tipoFactura`; `customer.taxIdCountry`; `customer.name` no longer required by the input schema. Description covers the F2 rules (EUR 400 inference, EUR 3,000 cap) and the 2027-01-01 / 2027-07-01 dates.
- `update_registration`, `get_registration_field_definitions`: `es_tax_territory` documented.

### @clearvo/cli (additive)

- `clearvo send` and `clearvo registrations update --extra` help text covers the Spain VeriFactu simplified-invoice and Canary Islands fields (`es_tax_territory`, `customerIdType`, `noRecipientIdentification`).

## Unreleased — publish only AFTER the entity bank-accounts backend PR has merged and deployed

Backend PR: Taxually-Einvoicing `claude/entity-bank-accounts`, `GET`/`POST /v1/bank-accounts` + `GET`/`PATCH`/`DELETE /v1/bank-accounts/{id}`. Until it is live in production, these SDK/MCP/CLI calls 404. Lets an entity store its own IBAN/BIC once per currency (plus one entity-wide DEFAULT, currency omitted) instead of resending it on every invoice — closes the gap noted on `payment.iban`'s own doc comment ("API-only per-invoice for now; no entity-level default"). Resolution order when an invoice's own `payment.iban` is omitted: the entity's account for the invoice's currency, then the entity's DEFAULT account, then nothing (today's pre-existing behaviour). A `payment.iban` given directly on the invoice always wins outright — this master data is a fallback, never an override.

### @clearvo/sdk 0.4.0 (additive, non-breaking)

- New `BankAccount`, `CreateBankAccountInput`, `UpdateBankAccountInput`, `ListBankAccountsResponse` types.
- New `listBankAccounts(entityId?)`, `createBankAccount(input)`, `getBankAccount(bankAccountId, entityId?)`, `updateBankAccount(bankAccountId, updates, entityId?)`, `deleteBankAccount(bankAccountId, entityId?)`.

### @clearvo/mcp 0.5.0 (additive, non-breaking)

- New `list_bank_accounts` / `create_bank_account` / `update_bank_account` / `delete_bank_account` tools, matching the SDK methods above one-for-one.

### @clearvo/cli 0.4.0 (additive, non-breaking)

- New `clearvo bank-accounts list|create|update|get|delete`, mirroring the `clearvo suppliers` command shape.

## Unreleased — publish only AFTER the IT/ES profile-field backend PR has merged and deployed

Backend PR: Taxually-Einvoicing `claude/it-es-profile-fields`, `GET`/`PUT /v1/it/profile`. Until it is live in production, these SDK/MCP/CLI calls 404. No secret is stored — Clearvo is the accredited SDI intermediary, so Italy has no per-entity credential at all. This registers/reads back the entity's required Regime Fiscale profile field, which previously had no way to be set ahead of time (only inline on `/v1/send` via `countrySpecific.it.regimeFiscale`, by a caller who already knew to). Also fixes a separate, unrelated data-quality issue: Spain's `es_nif` profile field was removed from the manifest entirely (no SDK/MCP/CLI change — it was never wired up on this side) since it duplicated the entity's own ES VAT registration number with no reconciliation between the two.

### @clearvo/sdk 0.3.0 (additive, non-breaking)

- New `setItProfile(input: SetItProfileInput): Promise<ItProfileResponse>` and `getItProfile(entityId?: string): Promise<ItProfileResponse>`. `SetItProfileInput` accepts only `regimeFiscale` plus the usual optional `entityId` for account-scoped keys.
- `ItProfileResponse` always returns `200`: `hasItRegistration` (false means `setItProfile` will 422 MISSING_IT_REGISTRATION — register an Italy tax number first), `configured`, `regimeFiscale` (null until set), and the full `options` list (code + label) so a caller can build a picker without hardcoding the RF01–RF19 enum.

### @clearvo/mcp 0.4.0 (additive, non-breaking)

- New `set_it_profile` / `get_it_profile` tools, matching the SDK methods above one-for-one.

### @clearvo/cli 0.3.0 (additive, non-breaking)

- New `clearvo it profile set --regime-fiscale <code> [--entity <entityId>]` and `clearvo it profile get [--entity <entityId>]`.

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
