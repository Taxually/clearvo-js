/**
 * The scenarios of the sandbox simulator for received invoices (`simulateReceivedInvoices({ scenario })`): the shape of
 * the document you ask for. Defined once in the backend; the MCP server repeats this list and the CLI repeats the ids, and
 * `npm run test:simulation-countries` fails when any copy drifts from the others.
 */
export const SIMULATION_SCENARIOS = [
  { id: 'standard', description: 'A clean invoice or credit note with one line, accepted without warnings or review. The default.' },
  { id: 'credit_note_for_existing', description: 'A credit note that refers to a real invoice you already simulated (its number and date appear in relatedDocuments). When there is no uncredited simulated invoice for the country, one is created first.' },
  { id: 'warnings_only', description: 'A valid document that the checks flag with warnings: it is stored and announced as received, with flags on the invoice.' },
  { id: 'needs_review_format', description: 'A file that does not follow the e-invoice format. It is stored for review (RECEIVED_NEEDS_REVIEW, validationOutcome FORMAT_ERROR) and invoice.received still fires.' },
  { id: 'needs_review_business_rules', description: 'A well-formed file whose totals break a mandatory invoice rule. It is stored for review (RECEIVED_NEEDS_REVIEW, validationOutcome BUSINESS_RULE_ERROR) with the failed checks on the invoice.' },
  { id: 'duplicate', description: 'Each invoice is created, then sent again by the same supplier with the same number and date but a changed file. The second copy creates nothing new and fires invoice.duplicate.' },
  { id: 'duplicate_exact', description: 'Each invoice is created, then sent again byte for byte. The second copy is recognised and ignored: nothing new is created and no event fires, as for a real redelivery.' },
  { id: 'with_references', description: 'The document carries a purchase order reference and a buyer reference.' },
  { id: 'with_payment_terms', description: 'The document states payment terms in words, and its issue date is 60 days back so the due date has already passed (unless you set issueDate).' },
  { id: 'with_attachment', description: 'The document embeds a small supporting file (a CSV), listed under attachments on the invoice.' },
  { id: 'with_discounts', description: 'Three lines, each with a fixed discount, so the line totals differ from quantity times price.' },
  { id: 'many_lines', description: '25 lines, to exercise paging and large payloads.' },
  { id: 'unicode_text', description: 'Long line descriptions in accented Latin, Greek, Cyrillic, Japanese and Arabic text.' },
  { id: 'foreign_supplier', description: 'The supplier is established in a different country from your registration (its address, tax number and currency come from that country), while you stay the customer.' },
] as const;

export type SimulationScenarioId = (typeof SIMULATION_SCENARIOS)[number]['id'];

export const SIMULATION_SCENARIO_IDS: readonly SimulationScenarioId[] = SIMULATION_SCENARIOS.map((s) => s.id);
