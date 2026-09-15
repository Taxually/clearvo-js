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

[**Download clearvo.mcpb**](https://github.com/fergalg/clearvo-js/releases/latest/download/clearvo.mcpb) and double-click it (or drag it onto Claude Desktop) — Desktop shows an install dialog with a form for your API key instead of asking you to hand-edit JSON. Desktop-only; not read by Claude Code, Cursor, or Windsurf.

Or build it yourself from a clone (the build script and manifest aren't published to npm — installing `@clearvo/mcp` alone won't include them):

```bash
git clone https://github.com/fergalg/clearvo-js && cd clearvo-js
npm install && cd packages/mcp && npm run build:mcpb
```

### Claude Code plugin

```
/plugin marketplace add fergalg/clearvo-js
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

**Available tools**: `submit_invoice`, `poll_status`, `calculate_tax`, `validate_tax_number`, `validate_tax_numbers_batch`, `list_entities`, `create_entity`, `get_requirements`, `list_invoices`, `get_invoice`, `list_products`, `create_product`, `update_product`, `list_webhooks`, `create_webhook`, `delete_webhook`, `list_registrations`, `add_registration`, `set_registration_collection`, `list_tax_calculations`, `get_query_fields`, `query_data`, `get_setup_status`, `get_tax_settings`, `update_tax_settings`, `get_reporting_obligations`, `update_reporting_obligations`, `list_customers`, `create_customer`, `update_customer`, `delete_customer`, `list_client_tax_codes`, `create_client_tax_code`, `update_client_tax_code`, `delete_client_tax_code`, `list_tax_codes`, `list_reporting_batches`, `run_reporting_batch_sweep`

`submit_invoice` line items have no `taxCode` field — the EN16931 category is always a resolved output. Pass `clientTaxCode` (RECOMMENDED) or a `taxTreatment` hint (`exempt`/`out_of_scope`/`zero_rated`/`reverse_charge`) instead, and set `dryRun: true` to preview the resolution without submitting for real.

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
    type: 'B2B',
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
