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

const TOOLS = [
  {
    name: 'submit_invoice',
    description:
      'Submit a B2B invoice to a national tax authority for clearance or registration. ' +
      'Required in Italy (SDI), Poland (KSeF), Romania (ANAF), Spain (SII via VeriFACTU), ' +
      'Hungary (NAV), Greece (myDATA), and 20+ other countries. Also routes via Peppol for ' +
      'countries using the 4-corner network (Belgium, Netherlands, Germany B2G, etc.). ' +
      'Returns a referenceId — call poll_status to track the clearance outcome. ' +
      'Call get_requirements first if unsure what fields are needed for a country.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        country: { type: 'string', description: 'ISO 3166-1 alpha-2 destination country (e.g. "IT", "PL", "DE")' },
        invoiceNumber: { type: 'string', description: 'Your invoice reference number' },
        issueDate: { type: 'string', description: 'Issue date in YYYY-MM-DD format' },
        currency: { type: 'string', description: 'ISO 4217 currency code (e.g. "EUR", "PLN", "GBP")' },
        supplier: {
          type: 'object',
          description: 'The issuing company (your entity). Pull name and taxId from your entity settings.',
          properties: {
            name: { type: 'string' },
            taxId: { type: 'string', description: 'Supplier VAT registration number (include country prefix, e.g. IT12345678901)' },
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
          },
          required: ['name', 'taxId', 'address'],
        },
        buyer: {
          type: 'object',
          description: 'The customer receiving the invoice.',
          properties: {
            name: { type: 'string' },
            taxId: { type: 'string', description: 'Buyer VAT number — strongly recommended for B2B to enable reverse charge treatment' },
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
              description: 'Buyer contact details. contact.email is required for notifyBuyer to have any effect.',
              properties: {
                email: { type: 'string', description: 'Buyer email — required if notifyBuyer is set (or your entity default is on) for a country where Clearvo does not deliver the invoice electronically.' },
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
              vatRate: { type: 'number', description: 'VAT/tax rate as a percentage (e.g. 22 for 22%). Required for standard (S) and reduced (AA) rate lines. Use 0 for zero-rated, exempt, or reverse charge lines.' },
              taxCode: {
                type: 'string',
                description: 'EN16931 tax code: S=standard rate, AA=reduced rate, Z=zero-rated, AE=reverse charge (non-EU→EU), K=intra-EU reverse charge, G=export (zero-rated outside scope), E=exempt',
              },
            },
            required: ['description', 'quantity', 'unitPrice', 'vatRate', 'taxCode'],
          },
        },
        totalAmount: { type: 'number', description: 'Net total excluding tax' },
        taxAmount: { type: 'number', description: 'Total tax amount' },
        documentType: { type: 'string', enum: ['invoice', 'credit_note', 'debit_note'], description: 'Optional: "invoice" (default), "credit_note", or "debit_note"' },
        notifyBuyer: {
          type: 'boolean',
          description: 'Only meaningful for countries where no authority network delivers the invoice to the buyer (Spain, Portugal, France, Germany always; Italy only when the buyer has no SDI routing code — i.e. B2C; Poland only when the buyer has no Polish NIP — KSeF is pull-only and pull access requires the buyer\'s own registered NIP). When true and buyer.contact.email is set, Clearvo emails the buyer a link to view/download the invoice. Omit to use the entity default (see update_entity\'s notifyBuyerByDefault); true/false here overrides that default for this invoice only. Silently ignored for countries Clearvo already delivers electronically (Peppol, Italy B2B/B2G, Poland when the buyer has a NIP, Romania, Hungary, Greece, Argentina) — check the response\'s buyerNotification field to see what happened.',
        },
      },
      required: ['country', 'invoiceNumber', 'issueDate', 'currency', 'supplier', 'buyer', 'lines', 'totalAmount', 'taxAmount'],
    },
  },
  {
    name: 'poll_status',
    description:
      'Check the clearance or submission status of an invoice previously submitted via submit_invoice. ' +
      'Returns clearanceStatus: PENDING, ACCEPTED, REJECTED, DUPLICATE, UNROUTABLE, DELIVERED, or UNDELIVERED. ' +
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
      'The taxCode returned maps directly to the taxCode field in submit_invoice — no conversion needed. ' +
      'Set commit=true to record the calculation in the audit trail (required for threshold monitoring). ' +
      'If the response\'s sellerRegistration.canCollectTax is false (e.g. $0 tax charged unexpectedly) and a ' +
      'reason string is present, surface it to the user verbatim — it explains why, e.g. a registration exists ' +
      'but has no collection start date set yet. Call set_registration_collection to fix it rather than guessing. ' +
      'Each line item can also carry taxTreatmentOverride (force a rate band) or commodityCode (tariff-driven ' +
      'lookup) — most-specific wins, above taxCategory. See those fields\' own descriptions for the precedence chain.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        currency: { type: 'string', description: 'ISO 4217 currency code' },
        commit: { type: 'boolean', description: 'If true, records in the audit trail, updates compliance thresholds, and makes the transaction visible in the dashboard. Default: false (ephemeral — not stored). Set to true for real transactions.' },
        seller: {
          type: 'object',
          properties: {
            address: { type: 'object', properties: { country: { type: 'string', description: 'ISO 3166-1 alpha-2' } }, required: ['country'] },
            taxId: { type: 'string', description: 'Seller VAT number' },
          },
          required: ['address'],
        },
        customer: {
          type: 'object',
          properties: {
            b2bOverride: { type: 'boolean', description: 'Set true to force B2B treatment regardless of VAT number validation outcome. Use when you know the buyer is a business but do not have their VAT ID at checkout time. Omit for the normal flow — B2B is inferred automatically when a valid taxId is supplied.' },
            taxId: { type: 'string', description: 'Customer VAT number — triggers B2B reverse charge or zero-rating for cross-border sales' },
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
          required: ['billingAddress'],
        },
        lineItems: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Your line item ID' },
              amount: { type: 'number', description: 'Line total in the transaction currency' },
              productName: { type: 'string', description: 'Product or service name — used for AI tax category classification if taxCategory not provided' },
              productCode: { type: 'string', description: 'Optional SKU or product code. When provided, the classification result is cached per account so the same product is not re-classified on every transaction.' },
              taxCategory: { type: 'string', description: 'Optional explicit category slug (e.g. saas_business, digital_general, physical_goods_general, professional_services). Skips AI classification.' },
              taxTreatmentOverride: { type: 'string', enum: ['STANDARD', 'REDUCED', 'SECOND_REDUCED', 'SUPER_REDUCED', 'ZERO', 'EXEMPT'], description: 'Caller-forced rate band for this line — names a band only, never a raw rate; the actual percentage is still resolved for the line\'s jurisdiction. Highest-precedence input to rate-band resolution, checked before commodityCode. Does not affect classification, place-of-supply, or B2B/reverse-charge/exemption logic — those still run first and are unaffected.' },
              commodityCode: { type: 'string', description: 'Optional tariff/customs code for this line (HS, CN, or UK Trade Tariff — no separate scheme field needed, matching is jurisdiction-scoped by the line\'s own resolved country). Looked up hierarchy-aware against Clearvo\'s tariff-rate data (own digit precision, then progressively shorter prefixes). Consulted only when taxTreatmentOverride is absent; a total miss re-enters the ordinary taxCategory/classification cascade unchanged.' },
            },
            required: ['id', 'amount', 'productName'],
          },
        },
      },
      required: ['currency', 'seller', 'customer', 'lineItems'],
    },
  },
  {
    name: 'validate_tax_number',
    description:
      'Validate a business tax number against the official authority for that country. ' +
      'Returns whether the number is valid and, when available, the registered business name and address. ' +
      'Supports EU VIES (all 27 EU member states), HMRC (UK), Brreg (Norway), ABN Lookup (Australia), ' +
      'and 100+ other countries. ' +
      'Use this before issuing B2B invoices to confirm the buyer\'s tax registration status ' +
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
      'Also handles notifyBuyerByDefault — see submit_invoice\'s notifyBuyer for what this controls.',
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
        notifyBuyerByDefault: { type: 'boolean', description: 'Default for submit_invoice\'s notifyBuyer behavior — see that tool\'s description. Applies whenever a submit_invoice call omits its own notifyBuyer override.' },
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
      'and the submitted XML. ' +
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
    name: 'submit_sii_record',
    description:
      'Submit a single Spain SII (Suministro Inmediato de Información) registro to AEAT. ' +
      'Use this instead of submit_invoice for an entity enrolled in the SII census (obligation es_sii) — ' +
      'SII and VeriFactu are mutually exclusive per entity, so a SII-obliged entity is never submitted via ' +
      'submit_invoice/POST /send. Requires the entity to have completed the Annex I written authorization ' +
      'and to hold a Spanish VAT registration — call get_setup_status first if unsure. ' +
      'Returns a record id — call get_sii_record to check aeatStatusCode/aeatErrorCode after submission.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        invoiceType: { type: 'string', enum: ['LFE', 'LFR'], description: 'LFE = Facturas Expedidas (issued), LFR = Facturas Recibidas (received).' },
        invoiceNumber: { type: 'string' },
        invoiceDate: { type: 'string', description: 'ISO YYYY-MM-DD.' },
        counterpartyNif: { type: 'string' },
        counterpartyName: { type: 'string' },
        baseAmount: { type: 'number' },
        taxAmount: { type: 'number' },
        totalAmount: { type: 'number' },
        claveRegimen: { type: 'string', description: "Régimen especial / clave key, '01'..'16'." },
      },
      required: ['invoiceType', 'invoiceNumber', 'invoiceDate', 'baseAmount', 'taxAmount', 'totalAmount', 'claveRegimen'],
    },
  },
  {
    name: 'correct_sii_record',
    description:
      'Submit a correction (tipoComunicacion A1) for a previously-submitted SII record. ' +
      'The original record\'s invoice fields are never updated — this always creates a new SII record ' +
      'referencing the original via originalRecordId, with correctionSeq incremented by 1. ' +
      'Pass the full corrected values for all fields, not just the ones that changed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        originalRecordId: { type: 'string', description: 'id of the SII record being corrected.' },
        invoiceType: { type: 'string', enum: ['LFE', 'LFR'] },
        invoiceNumber: { type: 'string' },
        invoiceDate: { type: 'string', description: 'ISO YYYY-MM-DD.' },
        counterpartyNif: { type: 'string' },
        counterpartyName: { type: 'string' },
        baseAmount: { type: 'number' },
        taxAmount: { type: 'number' },
        totalAmount: { type: 'number' },
        claveRegimen: { type: 'string', description: "Régimen especial / clave key, '01'..'16'." },
      },
      required: ['originalRecordId', 'invoiceType', 'invoiceNumber', 'invoiceDate', 'baseAmount', 'taxAmount', 'totalAmount', 'claveRegimen'],
    },
  },
  {
    name: 'list_sii_records',
    description:
      'List Spain SII records for the caller\'s entity. Filter by status, invoice type, or invoice date range. ' +
      'Use this to audit submitted SII registros, find records still PENDING, or identify REJECTED/ERROR ' +
      'records that need a correction via correct_sii_record.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['PENDING', 'VALIDATED', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'ERROR'] },
        invoiceType: { type: 'string', enum: ['LFE', 'LFR'] },
        dateFrom: { type: 'string', description: 'invoiceDate >= this value, YYYY-MM-DD.' },
        dateTo: { type: 'string', description: 'invoiceDate <= this value, YYYY-MM-DD.' },
        page: { type: 'number', description: 'Default 1.' },
        limit: { type: 'number', description: 'Results per page, default 50, max 200.' },
      },
    },
  },
  {
    name: 'get_sii_record',
    description:
      'Fetch full detail for a single Spain SII record by id, scoped to the caller\'s entity. ' +
      'Returns everything in list_sii_records plus aeatErrorDetail — the full AEAT error message, ' +
      'present when aeatErrorCode is set. Use this to investigate a specific rejection before correcting it.',
    inputSchema: {
      type: 'object' as const,
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'The SII record id, e.g. from submit_sii_record or list_sii_records.' },
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
      'Supported events: invoice.accepted, invoice.rejected, invoice.duplicate, ' +
      'invoice.undelivered, invoice.pending, * (all events).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'HTTPS endpoint URL to deliver events to' },
        events: {
          type: 'array',
          items: { type: 'string' },
          description: 'Event types to subscribe to. Use ["*"] for all events. Options: invoice.accepted, invoice.rejected, invoice.duplicate, invoice.undelivered, invoice.pending',
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
      'same filters — changing filters mid-pagination invalidates it).',
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
    name: 'create_exemption_certificate',
    description:
      'Record a tax exemption certificate belonging to one of this entity\'s BUYERS — not a certificate for the ' +
      'entity itself. An exemption certificate is a document a customer provides (e.g. a US resale certificate, ' +
      'manufacturing exemption, or nonprofit exemption letter) proving they do not owe sales tax on a purchase. ' +
      'Only call this when you know a specific customer holds one; there is no default or fallback certificate. ' +
      'Once created, reference it via customer.ref matching customerRef during calculate_tax so the exemption ' +
      'is automatically applied to eligible line items. Call upload_exemption_document afterwards if you have ' +
      'the signed PDF to attach.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        certificateRef: { type: 'string', description: 'Your internal reference for this certificate (e.g. "EXEMPT-2024-001").' },
        customerRef: { type: 'string', description: 'Your internal customer reference. Matched against customer.ref on calculate_tax requests to auto-apply this exemption.' },
        certificateType: { type: 'string', enum: ['RESALE', 'MANUFACTURING', 'AGRICULTURAL', 'ENERGY', 'EXEMPT_ORG', 'GOVERNMENT', 'DIRECT_PAY', 'BLANKET_OTHER'], description: 'Type of exemption claimed.' },
        formType: { type: 'string', enum: ['SST', 'MTC', 'CUSTOM'], description: 'Standard form type, if applicable.' },
        customerName: { type: 'string', description: 'Exempt customer\'s name.' },
        buyerTaxId: { type: 'string', description: 'Exempt customer\'s tax ID.' },
        country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code. Defaults to "US".' },
        region: { type: 'string', description: 'State or region code the exemption applies to (e.g. "CA"). US exemptions are typically state-scoped.' },
        taxCategorySlug: { type: 'string', description: 'Optional — restrict the exemption to a specific product tax category instead of all products.' },
        effectiveFrom: { type: 'string', description: 'Date the certificate becomes valid, YYYY-MM-DD.' },
        effectiveTo: { type: 'string', description: 'Expiry date, YYYY-MM-DD. Omit for open-ended certificates.' },
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
      'Every successfully-issued invoice also auto-captures/refreshes a customer record from its buyer details, ' +
      'so this list fills in over time even without calling create_customer directly. ' +
      'Reference a customer via buyer.customerRef on submit_invoice instead of resending full buyer details every time.',
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
      'Create a customer master-data record. Reference it later via buyer.customerRef on submit_invoice ' +
      'instead of resending full buyer details every time. country and taxId are optional together — a B2C ' +
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
        addressLine1: { type: 'string' },
        addressLine2: { type: 'string' },
        city: { type: 'string' },
        region: { type: 'string' },
        postalCode: { type: 'string' },
        peppolParticipantId: { type: 'string', description: '"schemeId:value" form, e.g. "0106:12345678". Supplying it is treated as confirmed immediately.' },
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
        addressLine1: { type: 'string' },
        addressLine2: { type: 'string' },
        city: { type: 'string' },
        region: { type: 'string' },
        postalCode: { type: 'string' },
        peppolParticipantId: { type: 'string', description: '"schemeId:value" form. Setting it is treated as confirmed immediately; pass null to clear it.' },
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
        addressLine1: { type: 'string' },
        addressLine2: { type: 'string' },
        city: { type: 'string' },
        region: { type: 'string' },
        postalCode: { type: 'string' },
        peppolParticipantId: { type: 'string', description: '"schemeId:value" form. Supplying it is treated as confirmed immediately. Omit to leave an existing confirmed value untouched.' },
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
    name: 'list_client_tax_codes',
    description:
      'List the client tax codes configured for an entity. A client tax code maps your own ERP tax code ' +
      '(e.g. a SAP two-digit code) to a Clearvo Tax Decision. Reference one via clientTaxCode on submit_invoice ' +
      'instead of sending taxCode/vatRate directly; calculate_tax returns your matching code back in its ' +
      'response for ERP posting. The EN16931 taxCode and rate are always computed live, never stored.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        entityId: { type: 'string', description: 'Entity ID to list client tax codes for. Required for account-scoped keys; omit for entity-scoped keys.' },
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
        description: { type: 'string' },
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
        description: { type: 'string' },
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

    case 'poll_status': {
      const id = args.referenceId as string;
      const country = args.country as string;
      return callApi('GET', `/status?id=${encodeURIComponent(id)}&country=${encodeURIComponent(country)}`);
    }

    case 'calculate_tax':
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
      const q = qs.toString();
      return callApi('GET', `/invoices${q ? `?${q}` : ''}`);
    }

    case 'get_invoice': {
      const id = args.id as string;
      return callApi('GET', `/invoices/${encodeURIComponent(id)}`);
    }

    case 'submit_sii_record':
      return callApi('POST', '/sii/submit', args);

    case 'correct_sii_record':
      return callApi('POST', '/sii/correct', args);

    case 'list_sii_records': {
      const qs = new URLSearchParams();
      if (args.status)      qs.set('status',      args.status      as string);
      if (args.invoiceType) qs.set('invoiceType', args.invoiceType as string);
      if (args.dateFrom)    qs.set('dateFrom',    args.dateFrom    as string);
      if (args.dateTo)      qs.set('dateTo',      args.dateTo      as string);
      if (args.page)        qs.set('page',        String(args.page));
      if (args.limit)       qs.set('limit',       String(args.limit));
      const q = qs.toString();
      return callApi('GET', `/sii/records${q ? `?${q}` : ''}`);
    }

    case 'get_sii_record': {
      const id = args.id as string;
      return callApi('GET', `/sii/records/${encodeURIComponent(id)}`);
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

    case 'list_client_tax_codes': {
      const { entityId } = args as { entityId?: string };
      return callApi('GET', '/tax/client-codes', undefined, entityId ? { 'x-entity-id': String(entityId) } : undefined);
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
