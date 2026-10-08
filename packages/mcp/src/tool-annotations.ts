// MCP tool `title` + behaviour annotations for the stdio server's tools/list.
//
// Hand-duplicated from the hosted connector's lib/mcp/tool-annotations.ts
// (Taxually-Einvoicing) — separate repos, no shared import, same convention as
// the tool list itself. Anthropic's Connectors/Plugins directory requires every
// tool to carry a `title` and the applicable `readOnlyHint` / `destructiveHint`.
// Keep the two files in sync by hand; scripts/verify-tool-annotations.js fails
// the build if any tool in this server's tools/list lacks an annotation.
//
// Differences from the hosted copy: get_br_credentials / poll_br_inbound are
// stdio-only tool names (the hosted connector exposes trigger_br_poll instead).
//
// Classification rules (from each tool's real HTTP verb, not its name):
//   readOnlyHint    true : no state change on Clearvo (GET tools, plus the two
//                          POST-verb tools that never write: query_data, simulate_rule).
//   destructiveHint true : deletes/removes data, deregisters, cancels or amends an
//                          authority report, overwrites stored authority credentials,
//                          resets mappings, or submits something to an authority that
//                          cannot be recalled. Ordinary create/update of
//                          customer-owned records is additive (false).
//   idempotentHint  true : repeating the same call leaves the same end state.
//   openWorldHint   true : the call reaches outside Clearvo (tax authority, Peppol,
//                          live registry lookup).

export interface McpToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

const READ_ONLY = new Set<string>([
  'list_manual_adjustments', 'get_manual_adjustment_options', 'list_client_tax_codes',
  'get_client_tax_code_options', 'get_client_tax_code_exemption_reason_options', 'list_tax_codes', 'list_entities',
  'get_it_profile', 'get_fr_credentials', 'get_br_credentials', 'get_mx_sync_status', 'get_br_sync_status', 'get_requirements',
  'list_invoices', 'get_invoice', 'list_products', 'list_webhooks', 'list_registrations',
  'get_registration_field_definitions', 'get_entity_fact_definitions', 'list_tax_calculations', 'list_calculation_requests', 'get_query_fields',
  'get_setup_status', 'get_tax_settings', 'get_reporting_obligations', 'list_reporting_batches', 'list_customers', 'list_customer_reference_types', 'list_exemption_certificates',
  'list_suppliers', 'list_bank_accounts', 'list_check_families', 'get_sii_reconciliation', 'get_inbound_batch',
  'get_inbound_email_address', 'get_bulk_upload_status', 'list_mandate_transactions', 'list_bulk_upload_errors',
  'get_tax_calculation_import_status', 'list_tax_calculation_import_errors', 'get_pt_monthly_saft',
  'get_rules_engine_schema', 'list_rules', 'get_rule', 'list_rule_versions', 'get_rules_trace',
  'list_platform_rule_changes', 'list_rule_property_definitions', 'list_rule_templates', 'get_rule_template',
  'list_field_mappings', 'list_rules_engine_datasets', 'get_rules_engine_dataset', 'list_rules_engine_dataset_rows',
  'query_data', 'simulate_rule', 'quote_duties', 'estimate_duties', 'get_import_settlement',
]);

const DESTRUCTIVE = new Set<string>([
  'delete_client_tax_code', 'remove_entity_logo', 'delete_webhook', 'delete_customer', 'delete_supplier',
  'delete_bank_account', 'unsuppress_rule', 'delete_rules_engine_dataset_row', 'deregister_registration',
  'cancel_sii_report', 'amend_sii_report', 'reset_field_mappings', 'exclude_reporting_batch_item',
  'confirm_reporting_batch',
  // Irrevocable submissions to a tax authority / e-invoicing network, or sends that reach a counterparty.
  'submit_invoice', 'submit_invoices_bulk', 'submit_invoices_bulk_async', 'push_mx_cfdi',
  'update_business_status', 'update_invoice_business_status',
  // Grant access / open an outbound data channel.
  'invite_team_member', 'create_webhook',
  // Overwrites previously stored authority credentials.
  'set_ar_credentials', 'set_pl_credentials', 'set_fr_credentials', 'set_hu_credentials', 'set_pt_credentials',
  'set_eg_credentials', 'set_jo_credentials', 'set_mx_credentials', 'set_br_credentials',
]);

const NON_IDEMPOTENT = new Set<string>([
  'calculate_tax', 'propose_manual_adjustment', 'create_client_tax_code', 'create_entity', 'upload_entity_logo',
  'poll_fr_inbound', 'trigger_br_poll', 'poll_br_inbound', 'push_mx_cfdi', 'invite_team_member', 'create_exemption_certificate',
  'upload_exemption_document', 'create_product', 'create_webhook', 'validate_tax_number', 'validate_tax_numbers_batch',
  'add_registration', 'run_reporting_batch_sweep', 'create_customer', 'create_supplier', 'create_bank_account',
  'receive_invoice_document', 'submit_invoices_bulk', 'submit_invoices_bulk_async', 'import_tax_calculations',
  'create_rule', 'create_rule_property_definition', 'create_rules_engine_dataset', 'import_rules_engine_dataset',
  'move_rule', 'amend_sii_report',
  // Second call fails (409: batch no longer awaiting confirmation).
  'confirm_tax_calculation_import', 'confirm_reporting_batch',
]);

const OPEN_WORLD = new Set<string>([
  'submit_invoice', 'submit_invoices_bulk', 'submit_invoices_bulk_async', 'validate_tax_number',
  'validate_tax_numbers_batch', 'poll_fr_inbound', 'trigger_br_poll', 'poll_br_inbound', 'push_mx_cfdi', 'confirm_reporting_batch',
  'amend_sii_report', 'cancel_sii_report', 'update_business_status', 'update_invoice_business_status',
  // poll_status is a GET that live-polls KSeF/NAV and writes the result back: NOT read-only.
  'poll_status',
  // These verify the credential against the authority live before saving.
  'set_hu_credentials', 'set_eg_credentials', 'set_pl_credentials',
]);

const ACRONYMS: Record<string, string> = {
  sii: 'SII', fr: 'FR', pl: 'PL', it: 'IT', hu: 'HU', pt: 'PT', eg: 'EG', jo: 'JO', mx: 'MX', br: 'BR', ar: 'AR',
  cfdi: 'CFDI', saft: 'SAF-T', nfse: 'NFS-e', id: 'ID', csv: 'CSV', api: 'API', ai: 'AI', url: 'URL',
};

/** "set_fr_credentials" → "Set FR Credentials". Deterministic so the title can never drift from the tool name. */
export function toolTitleFromName(name: string): string {
  return name
    .split('_')
    .map(w => ACRONYMS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function getToolAnnotations(name: string): McpToolAnnotations {
  const readOnly = READ_ONLY.has(name);
  return {
    title: toolTitleFromName(name),
    readOnlyHint: readOnly,
    destructiveHint: !readOnly && DESTRUCTIVE.has(name),
    idempotentHint: readOnly || !NON_IDEMPOTENT.has(name),
    openWorldHint: OPEN_WORLD.has(name),
  };
}
