# Changelog

Packages in this repo are versioned independently. Dates are release-prep dates; the product owner publishes to npm.

## Unreleased — publish only AFTER the backend customer-references PRs are deployed

Backend: Taxually-Einvoicing customer references (typed per-customer reference values, folding in the Peppol participant ID; `GET /v1/customer-reference-types`). Until it is live the API rejects `references` and still expects `peppolParticipantId`. Not released.

### @clearvo/mcp (additive, with one breaking input change)

- New tool `list_customer_reference_types` (optional `country`): the registry of reference kinds a customer can carry, e.g. `PEPPOL_PARTICIPANT_ID` (confirmation required) and `LEITWEG_ID` (Germany only, one per customer). Read-only.
- `create_customer`, `update_customer`, `upsert_customer_by_ref`: new `references` (`[{ type, value }]`, or `null`). BREAKING: `peppolParticipantId` is removed; send `{ type: 'PEPPOL_PARTICIPANT_ID', value: 'scheme:value' }` in `references` instead. Create and replace semantics: supplied replaces the whole list, `null` or `[]` clears it, omitted leaves it untouched (including on `upsert_customer_by_ref`). Bad items return 422 `INVALID_REFERENCES` with a per-item `index`. Tax and VAT numbers are not references.
- `list_customers` description: each customer returns `references` (replaces the top-level `peppol` object).
- `submit_invoice`: description and `countrySpecific.de.leitwegId` cover the stored-reference fallbacks (a stored confirmed Peppol ID and a stored `LEITWEG_ID` fill in only when the request has no explicit value; a Leitweg-ID is used as the electronic address only if its check digits are valid) and the `MISSING_CUSTOMER_ELECTRONIC_ADDRESS` / `MISSING_SUPPLIER_ELECTRONIC_ADDRESS` ERROR codes raised before any XML.

### @clearvo/sdk (docs only)

- `SubmitInvoiceInput.countrySpecific` doc comment covers the stored-reference fallbacks and the electronic-address error codes. The SDK has no typed customer methods, so no type changes.

### @clearvo/cli

- No change: the CLI has no customers command.

**2026-10-02 release: `@clearvo/sdk` 0.4.0, `@clearvo/mcp` 0.5.0, `@clearvo/cli` 0.4.0** (previous npm versions: 0.2.0, 0.3.0, 0.2.0). One combined release of every block below, each of which was gated on a backend change; all of those backend changes are deployed to production. The release includes breaking changes (classification codes replace `stripeTaxCode`, the `lines[]` tax-code and `vatRate`/`vatAmount` renames): read those blocks before upgrading.

## Customs duties: estimated import duty, import VAT/GST and customs fees

Backend branch: Taxually-Einvoicing `claude/duties-engine`. Until it is live, `POST /v1/duties/quote` returns 404, `duties`, `insurance` and the new line fields are ignored or rejected, and `dutiesEnabled` is not a known setting. Everything returned is an estimate and none of it is tax: it is never added to `totalTax`/`totalAmountWithTax`; `summary.importChargesAtCheckout` is the one amount a checkout may add, and `summary.totalAmountDue` (present only alongside it) is `totalAmountWithTax` plus that amount.

### @clearvo/sdk (additive, non-breaking)

- New `quoteDuties(input: QuoteDutiesInput): Promise<DutiesResult>` (POST `/duties/quote`): the `calculateTax()` body without `commit`, `idempotencyKey`, `documentStage` or `transactionDirection`. Stateless; a duty failure is a normal result with `duties.status: 'degraded'`, never a thrown error.
- New types `DutiesResult`, `DutiesRequest`, `DutiesBlock`, `DutiesSummary`, `DutyConsignment` (`QuotedDutyConsignment | DegradedDutyConsignment | NotApplicableDutyConsignment`, discriminated on `status`), `LineDuty`, `DutyMeasure`, `DutyRateExpression` (closed union: `ad_valorem_pct`, `top_up_to_pct`, `flat`, `specific`, `compound`, `alternative`, `min_max`), `DutyNotEvaluated`, and the closed enums `DutyEstimateReason`, `DutyPrecision`, `DutyCodeScheme`, `DutyCodeSource`, `DutyOriginSource`, `DutyDegradedReason`, `DutyNotApplicableReason`, `DutyCollectionReason`.
- `TaxCalculateRequest`: added `importerOfRecord`, `insurance`, `duties`, and a richer `shipFrom` (`TaxCalcShipFrom`: `postalCode`, `customsStatus`, ...); `lineItems[]` gain `commodityCodeScheme`, `countryOfOrigin`, `weight` and a per-line `shipFrom`.
- `TaxCalculateResponse`: added `duties`, `consignments`, `lineItems[].duty` and the duty fields of `summary` (`totalDuty`, `totalImportTax`, `totalImportFees`, `totalLandedCost`, `sellerBorneImportCosts`, `importChargesAtCheckout`, `totalAmountDue`). The IOSS `customsDuty` is the same EUR 3 that appears in the consignment `duty` (source `fee_rule`): never add the two together.

### @clearvo/mcp (additive)

- New `quote_duties` tool (read-only annotations), derived from `calculate_tax`'s input schema.
- `calculate_tax` takes `duties`, `insurance`, `shipFrom` (with `customsStatus`), `incoterms`, `importerOfRecord` and per-line `commodityCodeScheme`, `countryOfOrigin`, `weight`; its description now explains duties and no longer limits duty estimates to IOSS.
- `update_tax_settings` takes `dutiesEnabled`, `dutyRatePolicyForHs6` and `defaultCountryOfOrigin`.

### @clearvo/cli (additive)

- New `clearvo duties quote <file>` (`--entity`, `--pretty`): the same JSON file as `clearvo calculate`, without `commit`.

## Duties estimate and import settlement (Unreleased — publish only AFTER the backend PR is deployed)

Backend branch: Taxually-Einvoicing `claude/duties-estimate-settlement` (migration V20261005030000, new table `tax_calculation_import_settlements`). Until it is live, `POST /v1/duties/estimate`, `POST` and `GET /v1/tax/calculate/{id}/import-settlement` and `GET /v1/duties/settlement-variance` return 404. This branch also carries the customs-duties block above (`quoteDuties`, `quote_duties`, `duties quote`), which was not yet pushed. Everything an estimate returns is an estimate and none of it is tax; a settlement stores facts only and never changes a calculation or the entity's tax obligations.

### @clearvo/sdk (additive, non-breaking)

- New `estimateDuties(input: EstimateDutiesInput): Promise<DutiesEstimateResult>` (POST `/duties/estimate`): one product priced across up to 20 destinations. No commit, no calculation id, a read-only key is enough. Each destination has a `status` (`quoted`, `degraded`, `not_applicable`) and the same `duties`, `consignments`, `duty` and `summary` blocks as `quoteDuties()`; one bad destination never fails the call. The `product` block carries the resolved commodity code, scheme, `codeSource` and precision.
- New `recordImportSettlement(calculationId, input, entityId?)` (POST `/tax/calculate/{id}/import-settlement`): the customs entry's actual duty, import tax and fees for a committed calculation with a quoted duties block. Append-only, idempotent on calculation + consignment + `entryNumber` (`replayed: true` on a replay, 409 `settlement_conflict` for different actuals), `actual.currency` must equal the calculation's currency (422 `currency_mismatch`). Returns estimated vs actual, variance amount and percent per component and `withinEstimate`.
- New `getImportSettlements(calculationId, entityId?)` and `getImportSettlementVariance({ from, to, destination, precision }, entityId?)` (GET `/duties/settlement-variance`: count, mean and median variance percent by destination territory and precision tier).
- New types `EstimateDutiesInput`, `DutiesEstimateProductInput`, `DutiesEstimateDestinationInput`, `DutiesEstimateResult`, `DutiesEstimateDestination`, `DutiesEstimateProduct`, `ImportSettlementInput`, `ImportSettlement`, `ImportSettlementResult`, `ImportSettlementList`, `ImportSettlementVariance`, `ImportSettlementVarianceParams`.

### @clearvo/mcp (additive)

- New tools `estimate_duties` (read-only annotations), `record_import_settlement` (write, idempotent, not destructive) and `get_import_settlement` (read-only).

### @clearvo/cli (additive)

- New `clearvo duties estimate <file>`, `clearvo duties settle <calculationId> <file>`, `clearvo duties settlements <calculationId>` and `clearvo duties variance [--from --to --destination --precision]`.

## France e-reporting alignment: optional idempotency key on POST /v1/send

Until the backend is live, `x-idempotency-key` is still required and a request without it returns 400.

### @clearvo/sdk (additive, non-breaking)

- `SubmitInvoiceInput`: added `shipFrom` / `shipTo` (France own-goods stock transfers; one entry per movement, French leg only) and documented France purchase-direction support on `transactionDirection`. The `submit_invoice` MCP tool schema carries the same fields and wording.
- `submitInvoice(input, idempotencyKey?)`: the key was already an optional parameter; it is now optional on the wire too. It is now only the client's retry hint: every document gets a system-generated `sys-<hash>` identity key from its own fields (sale: `documentType` + `country` + `invoiceNumber`; purchase: also `supplier.taxId` and `issueDate`), returned in the `X-Idempotency-Key` response header, and that key alone deduplicates. Re-sending the same identity with different content returns `409 IDEMPOTENT_BODY_MISMATCH` (an earlier `NEEDS_INFO` or `REJECTED` attempt re-runs in place instead); reusing your key for a different document returns `409 IDEMPOTENCY_KEY_REUSED`; a missing identity field returns `422 MISSING_IDENTITY_FIELD`.

### @clearvo/mcp (behaviour change)

- `submit_invoice` no longer sends a client-derived `x-idempotency-key`; the API derives it from the invoice identity. A changed re-send of the same invoice is now refused 409 `IDEMPOTENT_BODY_MISMATCH` rather than replaying the first result.

### @clearvo/cli (behaviour change)

- `clearvo send <file>` no longer hashes the file into an `x-idempotency-key`; same server-side derivation and 409 behaviour as the MCP tool. Editing the file and re-submitting the same invoice number is now refused loudly instead of replaying.
## BREAKING: classification-code-map

Backend branch: Taxually-Einvoicing `claude/classification-code-map`. The backend removes `stripeTaxCode` outright (no alias) and replaces it with a vendor-agnostic `classificationCodes` array. Until it is live, `classificationCodes` is ignored or rejected and `CODE_MAP` is never returned. After it is live, `stripeTaxCode` is rejected; send `[{ system: 'stripe', code: 'txcd_...' }]` instead.

### @clearvo/sdk (BREAKING)

- `classificationSource` value `'STRIPE_CODE'` is now `'CODE_MAP'`. Line results gain optional `classificationSystem` and `classificationMatchedCode` (the matched code can be an ancestor of the one sent).
- New `ClassificationCode` (`{ system, code }`; system lowercase `[a-z0-9_]{1,30}`; known systems `stripe`, `shopify`, `hs`). `classificationCodes?` (max 5) added to `TaxCalculateRequest.lineItems[]`, `CreateProductInput`, `UpdateProductInput` and `Product`.

### @clearvo/mcp (BREAKING)

- `calculate_tax` line items, `create_product` and `update_product` take `classificationCodes` (max 5). `calculate_tax` description covers `CODE_MAP`.

### @clearvo/cli (BREAKING)

- `clearvo products create` and `clearvo products update` take a repeatable `--classification-code system:code` flag (max 5). Any `stripeTaxCode` in a `clearvo calculate` JSON file must become `classificationCodes`.

## Peppol credit and debit notes (Unreleased — publish only AFTER the backend PR 16945 is deployed)

Backend: Taxually-Einvoicing PR 16945. Outbound credit and debit notes can now be sent over Peppol in Belgium, Netherlands, Austria, Croatia, Slovakia, Ireland, Norway, Sweden, Denmark, Finland, Lithuania, Latvia, Estonia, Luxembourg, Slovenia, Iceland, Switzerland, Germany (Peppol format), Australia and New Zealand. Singapore, Japan and the UAE do not yet (422 `CREDIT_NOTE_PEPPOL_UNSUPPORTED`). A credit note reverses a previously accepted invoice in full; partial credit notes over Peppol are not supported yet (only France and Spain support partial). A debit note is sent as an invoice marked as a debit note. Germany: ZUGFeRD, XRechnung and Peppol all support credit and debit notes. Self-billed documents over Peppol for German entities remain unsupported.

### @clearvo/sdk (documentation only)

- Corrected the `CREDIT_NOTE_PEPPOL_UNSUPPORTED` JSDoc: it applies to Singapore, Japan and the UAE, no longer to Germany.

### @clearvo/mcp (documentation only)

- `submit_invoice` description and `documentType` description corrected the same way, with the full-reversal and debit-note behaviour.

## Peppol for Germany

Backend branch: Taxually-Einvoicing `claude/peppol-germany`. Until it is live, `PEPPOL` as a German invoice format is rejected and the received-document fields are absent. Germany can now send an invoice to the buyer over the Peppol network (Peppol BIS Billing 3.0), and every received Peppol or e-invoice reports what was checked and has a readable PDF copy. Not supported: Peppol self-billing for Germany. (Credit and debit notes: see "Peppol credit and debit notes" below.)

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

## Spain VeriFactu Canary Islands

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

## Entity bank accounts

Backend PR: Taxually-Einvoicing `claude/entity-bank-accounts`, `GET`/`POST /v1/bank-accounts` + `GET`/`PATCH`/`DELETE /v1/bank-accounts/{id}`. Until it is live in production, these SDK/MCP/CLI calls 404. Lets an entity store its own IBAN/BIC once per currency (plus one entity-wide DEFAULT, currency omitted) instead of resending it on every invoice — closes the gap noted on `payment.iban`'s own doc comment ("API-only per-invoice for now; no entity-level default"). Resolution order when an invoice's own `payment.iban` is omitted: the entity's account for the invoice's currency, then the entity's DEFAULT account, then nothing (today's pre-existing behaviour). A `payment.iban` given directly on the invoice always wins outright — this master data is a fallback, never an override.

### @clearvo/sdk 0.4.0 (additive, non-breaking)

- New `BankAccount`, `CreateBankAccountInput`, `UpdateBankAccountInput`, `ListBankAccountsResponse` types.
- New `listBankAccounts(entityId?)`, `createBankAccount(input)`, `getBankAccount(bankAccountId, entityId?)`, `updateBankAccount(bankAccountId, updates, entityId?)`, `deleteBankAccount(bankAccountId, entityId?)`.

### @clearvo/mcp 0.5.0 (additive, non-breaking)

- New `list_bank_accounts` / `create_bank_account` / `update_bank_account` / `delete_bank_account` tools, matching the SDK methods above one-for-one.

### @clearvo/cli 0.4.0 (additive, non-breaking)

- New `clearvo bank-accounts list|create|update|get|delete`, mirroring the `clearvo suppliers` command shape.

## IT/ES profile fields

Backend PR: Taxually-Einvoicing `claude/it-es-profile-fields`, `GET`/`PUT /v1/it/profile`. Until it is live in production, these SDK/MCP/CLI calls 404. No secret is stored — Clearvo is the accredited SDI intermediary, so Italy has no per-entity credential at all. This registers/reads back the entity's required Regime Fiscale profile field, which previously had no way to be set ahead of time (only inline on `/v1/send` via `countrySpecific.it.regimeFiscale`, by a caller who already knew to). Also fixes a separate, unrelated data-quality issue: Spain's `es_nif` profile field was removed from the manifest entirely (no SDK/MCP/CLI change — it was never wired up on this side) since it duplicated the entity's own ES VAT registration number with no reconciliation between the two.

### @clearvo/sdk 0.3.0 (additive, non-breaking)

- New `setItProfile(input: SetItProfileInput): Promise<ItProfileResponse>` and `getItProfile(entityId?: string): Promise<ItProfileResponse>`. `SetItProfileInput` accepts only `regimeFiscale` plus the usual optional `entityId` for account-scoped keys.
- `ItProfileResponse` always returns `200`: `hasItRegistration` (false means `setItProfile` will 422 MISSING_IT_REGISTRATION — register an Italy tax number first), `configured`, `regimeFiscale` (null until set), and the full `options` list (code + label) so a caller can build a picker without hardcoding the RF01–RF19 enum.

### @clearvo/mcp 0.4.0 (additive, non-breaking)

- New `set_it_profile` / `get_it_profile` tools, matching the SDK methods above one-for-one.

### @clearvo/cli 0.3.0 (additive, non-breaking)

- New `clearvo it profile set --regime-fiscale <code> [--entity <entityId>]` and `clearvo it profile get [--entity <entityId>]`.

## FR credentials

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

## Rename: line items `vatRate`/`vatAmount` to `taxRate`/`taxAmount`

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
