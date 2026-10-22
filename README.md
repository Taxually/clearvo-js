# clearvo-js

Developer tools for the [Clearvo](https://clearvo.io) tax compliance API.

| Package | Description |
|---|---|
| [`@clearvo/sdk`](./packages/sdk) | TypeScript/JavaScript SDK |
| [`@clearvo/mcp`](./packages/mcp) | MCP server for Claude Code, Cursor, Windsurf |
| [`@clearvo/cli`](./packages/cli) | CLI — `npx clearvo` |

## MCP server (Claude Code / Claude Desktop / Cursor / Windsurf)

Three ways to connect, from least to most manual setup:

### Claude Desktop Extension (one click, no config editing)

[**Download clearvo.mcpb**](https://github.com/Taxually/clearvo-js/releases/latest/download/clearvo.mcpb) and double-click it (or drag it onto Claude Desktop) — Desktop shows an install dialog with a form for your API key instead of asking you to hand-edit JSON. Desktop-only; not read by Claude Code, Cursor, or Windsurf.

Or build it yourself from a clone (the build script and manifest aren't published to npm — installing `@clearvo/mcp` alone won't include them):

```bash
git clone https://github.com/Taxually/clearvo-js && cd clearvo-js
npm install && cd packages/mcp && npm run build:mcpb
```

### Claude Code plugin

```
/plugin marketplace add Taxually/clearvo-js
/plugin install clearvo@clearvo
```

Claude Code prompts for your API key (stored in the system keychain, never written to `settings.json`) and wires up the MCP server automatically.

### Manual (Claude Code / Cursor / Windsurf)

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "clearvo": {
      "command": "npx",
      "args": ["-y", "@clearvo/mcp"],
      "env": {
        "CLEARVO_API_KEY": "csk_live_..."
      }
    }
  }
}
```

Then ask Claude: *"Submit a test invoice for €1,000 to Acme SpA (IT12345678901) for software licence Q3"*

**Available tools**: `submit_invoice`, `poll_status`, `calculate_tax`, `validate_tax_number`, `validate_tax_numbers_batch`, `list_entities`, `create_entity`, `get_requirements`, `list_invoices`, `get_invoice`, `list_products`, `create_product`, `update_product`, `list_webhooks`, `create_webhook`, `delete_webhook`, `test_webhook`, `list_registrations`, `add_registration`, `set_registration_collection`, `list_tax_calculations`, `get_query_fields`, `query_data`, `get_setup_status`, `get_tax_settings`, `update_tax_settings`, `get_reporting_obligations`, `update_reporting_obligations`, `list_customer_reference_types`, `list_customers`, `list_exemption_certificates`, `create_exemption_certificate`, `create_customer`, `update_customer`, `delete_customer`, `list_suppliers`, `create_supplier`, `update_supplier`, `delete_supplier`, `list_client_tax_codes`, `create_client_tax_code`, `update_client_tax_code`, `delete_client_tax_code`, `list_tax_codes`, `list_reporting_batches`, `run_reporting_batch_sweep`

`submit_invoice` line items have no `taxCode` field — the EN16931 category is always a resolved output. Pass `clientTaxCode` (RECOMMENDED) or a `taxTreatment` hint (`exempt`/`out_of_scope`/`zero_rated`/`reverse_charge`) instead, and set `dryRun: true` to preview the resolution without submitting for real.

Line items carry `taxRate` (always required, 0–100 — even with a `clientTaxCode`; a 0% line with no `clientTaxCode`/`taxTreatment` is held `NEEDS_INFO` asking why it is zero) and `taxAmount` — field names are never tax-type-specific (the platform covers VAT, GST and sales tax). The other line fields are `lineNumber`, `discountPercent` | `discountAmount` (mutually exclusive), `unitOfMeasure` and `sellerItemId`. The retired `vatRate`/`vatAmount` names are stored `REJECTED` with `UNKNOWN_FIELD_VAT_RENAMED` and the retired `discount`/`unit`/`itemCode`/`exemption` line keys with `UNKNOWN_FIELD_LINE_RENAMED`; invoice responses carry `totalTax` (was `totalVat`); upgrade to `@clearvo/sdk` ≥ 0.2.0, `@clearvo/mcp` ≥ 0.3.0 or `@clearvo/cli` ≥ 0.2.0 (see [CHANGELOG](./CHANGELOG.md)).

`POST /v1/send` answers HTTP 200 for every document it stores; the outcome is in the body (`outcome`, `clearanceStatus`, `statusClass`, `nextStep`, and on a rejection `error` and `errors[]`). `submit_invoice` returns that body as its result. A 4xx is only a malformed request, auth or plan, a rate limit or a 409 edited resend, and a 503 `INGEST_UNAVAILABLE` means nothing was stored (retry with the same body). `outcome` is one of `CLEARED`, `ACCUMULATED`, `NEEDS_INFO`, `HELD`, `REJECTED`, `NO_OBLIGATION`, `PROCESSING` (stored, not processed yet: keep the `id` and poll `GET /v1/status` or wait for `invoice.status_changed`; not an answer). `NEEDS_INFO` also covers an undeliverable recipient (`UNROUTABLE`): follow `nextStep`. `ok` is false only for `REJECTED`, `NEEDS_INFO`, `SETUP_NEEDED` and `HELD_PLATFORM_FAULT`. `invoice.status_changed` webhooks carry `eventId` (dedupe on it) and `seq` (order by it; ignore an event lower than the one you applied).

## TypeScript SDK

```bash
npm install @clearvo/sdk
```

```typescript
import { ClearvoClient } from '@clearvo/sdk';

const client = new ClearvoClient({ apiKey: process.env.CLEARVO_API_KEY! });

// Calculate tax for a DE → FR B2B sale
const result = await client.calculateTax({
  currency: 'EUR',
  seller: { address: { country: 'DE' } },
  customer: {
    // B2B is inferred from a verified taxId — no separate `type` field.
    taxId: 'FR12345678901',
    billingAddress: { country: 'FR' },
  },
  lineItems: [{ id: '1', amount: 10000, productName: 'SaaS subscription' }],
  // Per line, supply EITHER `amount` OR `unitPrice` with `quantity` — e.g.
  // `{ id: '2', unitPrice: 2500, quantity: 4, productName: 'Seats' }`, which
  // the engine multiplies and rounds once (amount = 10000) so you don't
  // absorb per-unit rounding. US line results also carry a per-authority
  // `jurisdictionBreakdown` (state/county/city/district) that sums to the
  // line's tax.
});
// result.taxCode === 'K'  (intra-EU reverse charge)
// result.summary.totalTax === 0

// Create an entity
const entity = await client.createEntity({
  legalName: 'Acme GmbH',
  country: 'DE',
  vatNumber: 'DE123456789',
});
// entity.apiKey — save this, shown once only
```


### Stored rejections: `throwOnRejected`

`submitInvoice` resolves with the body of `POST /v1/send`, which answers 200 for every stored document. By default (`throwOnRejected: true`, for this SDK major only) it throws a `ClearvoError` (status 422, `code`, `errors`, whole body on `body`) when `outcome` is `REJECTED` or `NEEDS_INFO`, as it did when those were HTTP 422. Pass `throwOnRejected: false` to the client or per call to get the body and branch on `outcome` yourself; `isRejected(result)` tells you which it was. 4xx and 5xx always throw. The default flips to `false` in the next major.

```typescript
const client = new ClearvoClient({ apiKey, throwOnRejected: false });
const result = await client.submitInvoice(invoice);
if (isRejected(result)) console.log(result.errors, result.nextStep);
```

## CLI

```bash
# One-off usage
CLEARVO_API_KEY=csk_live_... npx @clearvo/cli entities list --pretty

# Or install globally
npm install -g @clearvo/cli
clearvo entities list --pretty
clearvo requirements --country IT --pretty
clearvo validate-tin --country DE --number DE123456789
clearvo send invoice.json --pretty
clearvo status ref-abc123 --pretty
```

## Get an API key

[Create a free account](https://app.clearvo.io/register) at app.clearvo.io — production API keys issued immediately, no sales call.

Sandbox keys (`csk_test_...`) are available on the [sandbox](https://clearvo.io/docs/sandbox) plan.

## Documentation

- [API docs](https://clearvo.io/docs)
- [Claude Code quickstart](https://clearvo.io/docs/claude-code)
- [Supported countries](https://clearvo.io/countries)

## Releasing

`@clearvo/sdk`, `@clearvo/mcp` and `@clearvo/cli` publish to npm from GitHub Actions (`.github/workflows/publish.yml`) using npm Trusted Publishing: no npm token, no `npm login`, no 2FA prompt.

1. Bump `version` in each `packages/*/package.json` you are releasing, update `CHANGELOG.md`, and merge to `main`.
2. Push a tag from `main`: `git tag v<version-or-date> && git push origin v<version-or-date>` (or run the workflow by hand from the Actions tab).
3. The workflow builds, then publishes sdk, mcp and cli in that order. A package whose version is already on npm is skipped, so a re-run is safe.

Each package has a trusted publisher set on npmjs.com (org `Taxually`, repo `clearvo-js`, workflow `publish.yml`, no environment). If the workflow file is ever renamed, update all three there.
