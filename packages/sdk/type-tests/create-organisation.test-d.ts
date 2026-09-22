// Compile-time guard for createOrganisation() — POST /organisations, partner
// provisioning key only (see docs/features/partner-org-provisioning in the
// backend repo). Not run — only type-checked (see
// packages/sdk/type-tests/tsconfig.json, invoked via `npm run test:types`
// in this package, and by CI).

import type { CreateOrganisationInput, CreateOrganisationResponse } from '../src/types.js';
import type { ClearvoClient } from '../src/client.js';

// Minimal valid input: name, non-empty solutions, entity.legalName/country.
// externalReference and entity.address are both optional.
const _minimalInput: CreateOrganisationInput = {
  name: 'Acme Partner Org',
  solutions: ['einvoicing'],
  entity: { legalName: 'Acme Partner Org GmbH', country: 'DE' },
};
void _minimalInput;

// Full shape, including externalReference (the dedup key) and entity.address.
const _fullInput: CreateOrganisationInput = {
  name: 'Acme Partner Org',
  externalReference: 'partner-crm-acct-48213',
  solutions: ['einvoicing', 'tax_calculations'],
  entity: {
    legalName: 'Acme Partner Org GmbH',
    country: 'DE',
    address: { line1: 'Musterstrasse 1', line2: null, city: 'Berlin', postalCode: '10115' },
  },
};
void _fullInput;

// `solutions` only accepts the four real ALL_SOLUTION_CODES plus 'ecm' — an
// unknown code must not type-check. If this ever compiles again, `solutions`
// has drifted from the backend's SolutionCode union.
const _invalidSolution: CreateOrganisationInput = {
  name: 'Acme Partner Org',
  // @ts-expect-error — 'invoicing' is not a valid solution code (the real code is 'einvoicing').
  solutions: ['invoicing'],
  entity: { legalName: 'Acme Partner Org GmbH', country: 'DE' },
};
void _invalidSolution;

// No vatNumber, extraFields, or other tax-identity/credential field belongs
// on this shape — the endpoint is shell-only. If this ever compiles again,
// CreateOrganisationInput has drifted from the real, additionalProperties:
// false request schema.
const _shellOnly: CreateOrganisationInput = {
  name: 'Acme Partner Org',
  solutions: ['einvoicing'],
  entity: { legalName: 'Acme Partner Org GmbH', country: 'DE' },
  // @ts-expect-error — vatNumber is not a property of CreateOrganisationInput; this endpoint never accepts a tax-identity field.
  vatNumber: 'DE123456789',
};
void _shellOnly;

// createOrganisation() posts to /organisations and resolves the full 201
// body, including the mint-once apiKey and its fixed 'organisation' scope
// literal (never a bare `string`).
declare const _client: ClearvoClient;
const _created: Promise<CreateOrganisationResponse> = _client.createOrganisation(_minimalInput);
void _created;

declare const _resp: CreateOrganisationResponse;
const _apiKey: string = _resp.apiKey;
const _apiKeyScope: 'organisation' = _resp.apiKeyScope;
const _plan: 'starter' | 'business' | 'enterprise' = _resp.plan;
void _apiKey;
void _apiKeyScope;
void _plan;

// apiKeyScope is the literal 'organisation', not a bare string — if this
// ever compiles again, the type has widened and the mint-once-key contract
// is no longer distinguishable from other key scopes at the type level.
const _wrongScope: CreateOrganisationResponse = {
  ...( _resp),
  // @ts-expect-error — apiKeyScope is the literal 'organisation', not an arbitrary string.
  apiKeyScope: 'entity',
};
void _wrongScope;
