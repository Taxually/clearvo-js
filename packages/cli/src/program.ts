import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { homedir } from 'os';
import { join, basename } from 'path';
import { Command } from 'commander';

/** Commander collector for the repeatable --classification-code flag. */
function collectClassificationCode(val: string, prev: string[]): string[] {
  return [...prev, val];
}

/**
 * Parse repeated `system:code` values into the API's classificationCodes
 * shape. Splits on the FIRST colon only (codes may contain further colons).
 * Exits with an error on a malformed value or more than 5 codes.
 */
function parseClassificationCodes(values: string[]): Array<{ system: string; code: string }> {
  if (values.length > 5) {
    console.error('Error: --classification-code may be given at most 5 times.');
    process.exit(1);
  }
  return values.map((v) => {
    const i = v.indexOf(':');
    const system = i > 0 ? v.slice(0, i) : '';
    const code = i > 0 ? v.slice(i + 1) : '';
    if (!/^[a-z0-9_]{1,30}$/.test(system) || !code) {
      console.error(`Error: invalid --classification-code "${v}". Expected system:code with a lowercase system, e.g. stripe:txcd_10103001`);
      process.exit(1);
    }
    return { system, code };
  });
}

export function createProgram(): Command {
  
  const CONFIG_PATH = join(homedir(), '.clearvo', 'config.json');
  // A function, not a module-level const, so it re-reads CLEARVO_BASE_URL on
  // every call — same convention as getApiKey() below. Behaviorally identical
  // for real usage (the env var is set once at process start), but lets tests
  // override it per-case without needing a fresh module instance per test.
  function getBaseUrl(): string {
    return process.env.CLEARVO_BASE_URL ?? 'https://api.clearvo.io/v1';
  }
  
  function getApiKey(): string {
    const key = process.env.CLEARVO_API_KEY;
    if (key) return key;
    try {
      const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { apiKey?: string };
      if (cfg.apiKey) return cfg.apiKey;
    } catch {
      // config file absent — that's fine
    }
    console.error('Error: CLEARVO_API_KEY is not set.');
    console.error('Set it as an environment variable or in ~/.clearvo/config.json');
    console.error('Get a key at https://app.clearvo.io/settings');
    process.exit(1);
  }
  
  async function api(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<unknown> {
    // FormData (e.g. bulk CSV upload) must not get a JSON Content-Type or be stringified —
    // fetch sets the correct multipart boundary itself when the body is a FormData instance.
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    const res = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers: {
        'x-api-key': getApiKey(),
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        'Accept': 'application/json',
        ...extraHeaders,
      },
      body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) {
      // `error` is a string on most routes and an object ({ code, message }) on a /v1/send rejection.
      const errObj = data.error !== null && typeof data.error === 'object' ? data.error as Record<string, unknown> : null;
      // The Filings routes put the stable code in `error` and the sentence in `message` or `detail`.
      const filingsCode = !errObj && typeof data.error === 'string' && (typeof data.message === 'string' || typeof data.detail === 'string') ? data.error : undefined;
      const parts = [`HTTP ${res.status}: ${errObj ? (errObj.message ?? errObj.code ?? 'Unknown error') : filingsCode ? (data.message ?? data.detail) : (data.error ?? 'Unknown error')}`];
      if (data.hint) parts.push(`Hint: ${data.hint}`);
      if (data.field) parts.push(`Field: ${data.field}`);
      if (data.code) parts.push(`Code: ${data.code}`);
      else if (filingsCode) parts.push(`Code: ${filingsCode}`);
      if (filingsCode) {
        // Extra body fields of a Filings refusal: existingId, reason, filesWithErrors, contactUrl, currentVersion, declaration, ...
        const extras = Object.fromEntries(Object.entries(data).filter(([k]) => !['error', 'message', 'detail', 'hint', 'field', 'code', 'errors'].includes(k)));
        if (Object.keys(extras).length > 0) parts.push(`Details: ${JSON.stringify(extras)}`);
        if (filingsCode === 'FILE_ERRORS') parts.push('Next: look at the error reports (`clearvo filings upload error-report <month> <fileId>`), fix the file and upload it again or delete it, then run process again.');
        if (filingsCode === 'SYSTEM_FILE_ERRORS') parts.push('Next: a file we prepared for you has errors and cannot be changed by you. Contact support (see contactUrl in the details).');
        if (filingsCode === 'DECLARATION_VERSION_MISMATCH') parts.push('Next: read the current declaration (`clearvo filings upload month <month>`) and repeat with --declaration-version set to its version.');
      }
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        parts.push('Errors:');
        for (const e of (data.errors as Array<Record<string, unknown>>).slice(0, 25)) {
          parts.push(`  - ${e.path ?? '/'} ${e.errorCode ?? e.code ?? ''}: ${e.message ?? ''}`);
        }
      }
      console.error(parts.join('\n'));
      process.exit(1);
    }
    return data;
  }
  
  /** A GET that returns a file (CSV, XLSX, PDF/image) rather than JSON. Exits on a non-2xx response, printing the error like api(). */
  async function apiFile(path: string, extraHeaders?: Record<string, string>): Promise<Response> {
    const res = await fetch(`${getBaseUrl()}${path}`, { method: 'GET', headers: { 'x-api-key': getApiKey(), ...extraHeaders } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      console.error(`HTTP ${res.status}: ${data.message ?? data.detail ?? data.error ?? 'Unknown error'}${typeof data.error === 'string' && (data.message || data.detail) ? `\nCode: ${data.error}` : ''}`);
      process.exit(1);
    }
    return res;
  }

  /** Human-readable summary of a stored REJECTED / NEEDS_INFO send (UNROUTABLE is a NEEDS_INFO outcome): the error, one line per failed check, and the next step. */
  function describeStoredRejection(r: Record<string, unknown>, outcome: string): string {
    const err = r.error !== null && typeof r.error === 'object' ? r.error as Record<string, unknown> : null;
    const parts = [`${outcome}${r.id ? ` (${r.id})` : ''}: ${err ? (err.message ?? err.code ?? 'rejected') : (r.message ?? 'rejected')}`];
    if (err?.code) parts.push(`Code: ${err.code}`);
    if (Array.isArray(r.errors) && r.errors.length > 0) {
      parts.push('Errors:');
      for (const e of (r.errors as Array<Record<string, unknown>>).slice(0, 25)) {
        parts.push(`  - ${e.path ?? '/'} ${e.errorCode ?? e.code ?? ''}: ${e.message ?? ''}`);
      }
    }
    const next = r.nextStep !== null && typeof r.nextStep === 'object' ? r.nextStep as Record<string, unknown> : null;
    if (next) parts.push(`Next step (${next.actor ?? 'merchant'}): ${next.message ?? ''}${next.fixUrl ? ` ${next.fixUrl}` : ''}`);
    return parts.join('\n');
  }

  function print(data: unknown, pretty: boolean) {
    console.log(pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
  }
  
  const program = new Command()
    .name('clearvo')
    .description('Clearvo CLI — submit invoices, calculate tax, validate tax numbers')
    .version('0.3.0');
  
  // ── clearvo send <file> ───────────────────────────────────────────────────────
  // Hard cut: there is no `taxCode` field anywhere in the request — not on a
  // line, `shipping`, or an allowance/charge. Set `clientTaxCode` (RECOMMENDED
  // — see `clearvo tax-codes create`) or an AUTHORITATIVE `taxTreatment`
  // (exempt/out_of_scope/zero_rated/reverse_charge) per line in the JSON file
  // instead — a stated taxTreatment is mapped as-is, never overridden by
  // country inference; --client-tax-code below is the header-level convenience
  // flag for the common single-code-per-invoice case. A positive taxRate with
  // no clientTaxCode/taxTreatment is reported as a domestic taxable supply at
  // that rate (the client's rate is authoritative, never rejected as
  // unrecognised); a bare 0% with neither is rejected with 400
  // ZERO_RATE_NEEDS_TAX_TREATMENT. taxRate itself (0–100) is ALWAYS required,
  // even with a clientTaxCode — missing/out-of-range is a 400. An unrecognised clientTaxCode never rejects the invoice — it's held
  // (status HELD_UNMAPPED_TAX_CODE) with a machine-readable reason in the
  // response instead.
  // Line items carry `taxRate`/`taxAmount` — the platform is global, so field
  // names are never tax-type-specific. A file still using the retired
  // `vatRate`/`vatAmount` keys is stored as REJECTED (HTTP 200, `ok: false`)
  // UNKNOWN_FIELD_VAT_RENAMED naming the `tax`-named replacement; there is no
  // silent alias. The remaining line fields are `lineNumber`,
  // `discountPercent` | `discountAmount` (mutually exclusive), `unitOfMeasure`
  // and `sellerItemId` — the retired `discount`/`unit`/`itemCode`/`exemption`
  // line keys are stored REJECTED with UNKNOWN_FIELD_LINE_RENAMED the same way.
  // Invoice responses carry `totalTax` (never `totalVat`).
  program
    .command('send <file>')
    .description('Submit an invoice from a JSON file (line items use taxRate/taxAmount, lineNumber, discountPercent|discountAmount, unitOfMeasure, sellerItemId — the retired vatRate/vatAmount keys are stored REJECTED with UNKNOWN_FIELD_VAT_RENAMED and discount/unit/itemCode/exemption with UNKNOWN_FIELD_LINE_RENAMED). Spain VeriFactu (incl. Canary Islands IGIC): an original invoice with no customer.taxId and a total up to EUR 400 is issued as a simplified invoice (F2, customer.name optional); countrySpecific.es.customerIdType (passport, residence_document, residence_certificate, other, not_registered) identifies a buyer without a NIF or EU VAT number; countrySpecific.es.noRecipientIdentification or countrySpecific.es.numRegistroAcuerdoFacturacion is needed above EUR 3,000; set es_tax_territory first with `clearvo registrations update --extra`. Germany: countrySpecific.de.invoiceFormat is ZUGFERD (default), XRECHNUNG or PEPPOL; PEPPOL sends over the Peppol network and needs the seller\'s confirmed Peppol ID, customer.electronicAddress (schemeId + value; never derived from a VAT number) and a buyerReference or orderReference (unreachable buyer: stored NEEDS_INFO with PEPPOL_CUSTOMER_UNREACHABLE and re-send alternatives; credit/debit notes and self-billed invoices cannot use PEPPOL); --dry-run previews the checks without storing anything. POST /v1/send answers HTTP 200 for every stored document: the outcome is in the body. PROCESSING means stored but not processed yet (keep the id and poll `clearvo status`; exit 0). The command exits 1 when the outcome is REJECTED or NEEDS_INFO (which includes an unroutable recipient; errors and next step on stderr, the JSON body on stdout); use --no-throw-on-rejected to exit 0 and branch on outcome yourself. HTTP errors (400, 401, 403, 409, 429, 503) always exit 1')
    .option('--dry-run', 'Preview the resolved per-line tax decision (including a would-be HELD_UNMAPPED_TAX_CODE outcome) without persisting anything or submitting to an authority')
    .option('--client-tax-code <code>', 'Header-level clientTaxCode override — your own ERP tax code (see `clearvo tax-codes create`), applied to every line lacking its own clientTaxCode/taxTreatment/taxRate')
    .option('--no-throw-on-rejected', 'Exit 0 when the stored outcome is REJECTED or NEEDS_INFO (default: exit 1)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (file: string, opts: { pretty?: boolean; dryRun?: boolean; clientTaxCode?: string; throwOnRejected?: boolean }) => {
      const raw = readFileSync(file, 'utf8');
      const body = JSON.parse(raw) as Record<string, unknown>;
      if (opts.dryRun) body.dryRun = true;
      if (opts.clientTaxCode) body.clientTaxCode = opts.clientTaxCode;
      // x-idempotency-key is optional: the API generates its own identity key from the invoice
      // (type, country, invoice number) and answers 409 IDEMPOTENT_BODY_MISMATCH if the same invoice
      // is re-sent with changed content. A 200 means the document is STORED: read outcome, clearanceStatus,
      // statusClass, terminal and nextStep in the output, not the exit status alone.
      const result = await api('POST', '/send', body) as Record<string, unknown>;
      print(result, !!opts.pretty);
      const outcome = result.outcome ?? result.clearanceStatus ?? result.status;
      if (outcome === 'PROCESSING') {
        // Stored, not processed yet: not an answer. Exit 0 (nothing failed) but say how to follow it.
        console.error(`PROCESSING${result.id ? ` (${result.id})` : ''}: stored, not processed yet. Poll \`clearvo status ${result.id ?? '<id>'}\` (GET /v1/status) or wait for the invoice.status_changed webhook; do not resend.`);
      }
      if (opts.throwOnRejected !== false && (outcome === 'REJECTED' || outcome === 'NEEDS_INFO' || outcome === 'UNROUTABLE')) {
        console.error(describeStoredRejection(result, String(outcome)));
        if (result.clearanceStatus === 'UNROUTABLE') console.error('Only you can move this one: fix the recipient (address or Peppol ID) and resend the corrected document with the same invoice number.');
        process.exit(1);
      }
    });

  // ── clearvo send-bulk / send-bulk-async <file> ───────────────────────────────
  // MCP twins: submit_invoices_bulk / submit_invoices_bulk_async. The public API
  // used to split sync/async across two endpoints (/send/bulk vs /send/bulk-async);
  // that split was folded into one door 2026-09-18 (unify-bulk-send-endpoint) —
  // both commands below still exist (a caller who wants a guaranteed-synchronous
  // small file vs. one who doesn't want a client-side size check still has a
  // reason to pick between them), but BOTH now POST to the exact same route, which
  // decides the real transport by request size regardless of which command was used.
  const MAX_BULK_ROWS = 500;
  const MAX_BULK_UPLOAD_BYTES = 25 * 1024 * 1024;

  function countCsvDataRows(csvContent: string): number {
    const lines = csvContent.split(/\r\n|\r|\n/).filter(line => line.length > 0);
    return Math.max(0, lines.length - 1);
  }

  function csvFormData(csvContent: string, filename: string): FormData {
    const formData = new FormData();
    formData.append('file', new Blob([csvContent], { type: 'text/csv' }), filename);
    return formData;
  }

  program
    .command('send-bulk <file>')
    .description('Submit many transactions at once from a CSV file (up to 500 rows / 25MB, processed synchronously) — see `clearvo send-bulk-async` for a larger file')
    .option('--entity <entityId>', 'Entity ID (required for account-scoped keys)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (file: string, opts: { entity?: string; pretty?: boolean }) => {
      const csvContent = readFileSync(file, 'utf8');
      const rowCount = countCsvDataRows(csvContent);
      const byteLength = Buffer.byteLength(csvContent, 'utf8');
      if (rowCount > MAX_BULK_ROWS || byteLength > MAX_BULK_UPLOAD_BYTES) {
        console.error(
          `This CSV has ${rowCount} data rows (${byteLength} bytes) — send-bulk accepts at most ${MAX_BULK_ROWS} rows ` +
          `and ${MAX_BULK_UPLOAD_BYTES / (1024 * 1024)}MB per call. Use \`clearvo send-bulk-async\` instead for a file this size.`
        );
        process.exit(1);
      }
      const result = await api('POST', '/send/bulk', csvFormData(csvContent, file.split('/').pop() || 'invoices.csv'), opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  program
    .command('send-bulk-async <file>')
    .description('Submit many transactions at once from a CSV file too large for `send-bulk`\'s 500-row/25MB synchronous ceiling — the server decides the real transport by size regardless')
    .option('--entity <entityId>', 'Entity ID (required for account-scoped keys)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (file: string, opts: { entity?: string; pretty?: boolean }) => {
      const csvContent = readFileSync(file, 'utf8');
      const filename = file.split('/').pop() || 'invoices.csv';
      const result = await api('POST', '/send/bulk', csvFormData(csvContent, filename), opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  program
    .command('bulk-upload-status <batchId>')
    .description('Poll one async bulk upload batch — created via `send-bulk-async`, or a `continuation.batchId` handed back by `send-bulk`')
    .option('--entity <entityId>', 'Entity ID (required for account-scoped keys)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (batchId: string, opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('GET', `/send/bulk/${encodeURIComponent(batchId)}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  program
    .command('bulk-upload-errors <batchId>')
    .description('Paginated, row-level structural errors for one async bulk upload batch — a row that reached mandate resolution is not listed here, use `clearvo mandate-transactions --upload-batch-id` instead')
    .option('--page <page>', 'Page number, 1-based')
    .option('--limit <limit>', 'Results per page (default 50, max 200)')
    .option('--entity <entityId>', 'Entity ID (required for account-scoped keys)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (batchId: string, opts: { page?: string; limit?: string; entity?: string; pretty?: boolean }) => {
      const qs = new URLSearchParams();
      if (opts.page) qs.set('page', opts.page);
      if (opts.limit) qs.set('limit', opts.limit);
      const q = qs.toString();
      const result = await api('GET', `/send/bulk/${encodeURIComponent(batchId)}/errors${q ? `?${q}` : ''}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo import-tax-calculations <file> ───────────────────────────────
  // MCP twin: import_tax_calculations. A dedicated, calc-only ingestion path —
  // deliberately separate from send-bulk*/bulk-upload-* above, which are
  // e-invoicing commands. Always async. Every import is a FINAL calculation:
  // no preview or confirm step — clean transactions are committed immediately,
  // errored ones are reported and never committed.

  program
    .command('import-tax-calculations <file>')
    .description('Upload a CSV of historical or current transactions to be tax-calculated in bulk and recorded as real tax calculations — every import is final (no preview or confirm step), always async; see `clearvo tax-calculation-import-status`')
    .option('--entity <entityId>', 'Entity ID (required for account-scoped keys)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (file: string, opts: { entity?: string; pretty?: boolean }) => {
      const csvContent = readFileSync(file, 'utf8');
      const filename = file.split('/').pop() || 'tax-calculations.csv';
      const result = await api('POST', '/tax/calculate/import', csvFormData(csvContent, filename), opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  program
    .command('tax-calculation-import-status <batchId>')
    .description('Poll one tax calculation import batch, created via `import-tax-calculations`')
    .option('--page <page>', 'Page number for the transactions list, 1-based')
    .option('--limit <limit>', 'Transactions per page (default 25, max 100)')
    .option('--status <status>', 'Filter the transactions page to COMMITTED or ERROR')
    .option('--entity <entityId>', 'Entity ID (required for account-scoped keys)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (batchId: string, opts: { page?: string; limit?: string; status?: string; entity?: string; pretty?: boolean }) => {
      const qs = new URLSearchParams();
      if (opts.page) qs.set('page', opts.page);
      if (opts.limit) qs.set('limit', opts.limit);
      if (opts.status) qs.set('status', opts.status);
      const q = qs.toString();
      const result = await api('GET', `/tax/calculate/import/${encodeURIComponent(batchId)}${q ? `?${q}` : ''}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  program
    .command('tax-calculation-import-errors <batchId>')
    .description('Every transaction group of a tax calculation import batch that was NOT committed — row range, transaction ref, error code, and message')
    .option('--entity <entityId>', 'Entity ID (required for account-scoped keys)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (batchId: string, opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('GET', `/tax/calculate/import/${encodeURIComponent(batchId)}/errors?format=json`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo amend-report <id> <file> ─────────────────────────────────────────
  // ES SII block 3. Files an AEAT "A1" amendment against an already-registered SII
  // invoice — <file> is the FULL corrected invoice, same JSON shape `send` takes
  // (same invoiceNumber/issueDate as the original; never a rectificativa, never
  // changes the invoice number). Refuses 409 when the record isn't currently
  // ACCEPTED at AEAT, an earlier amend/cancel is still in flight, or the corrected
  // payload would change the IDFactura identity.
  program
    .command('amend-report <id> <file>')
    .description('File an AEAT Spain SII A1 amendment (full corrected invoice from a JSON file)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, file: string, opts: { pretty?: boolean }) => {
      const raw = readFileSync(file, 'utf8');
      const body = JSON.parse(raw) as Record<string, unknown>;
      const idempotencyKey = createHash('sha256').update(`amend|${id}|${raw}`).digest('hex').slice(0, 64);
      const result = await api('POST', `/invoices/${encodeURIComponent(id)}/amend-report`, body, { 'x-idempotency-key': idempotencyKey });
      print(result, !!opts.pretty);
    });
  
  // ── clearvo cancel-report <id> ────────────────────────────────────────────────
  // ES SII block 3. Files an AEAT Baja (withdrawal) against an already-registered SII
  // invoice — identity-only, does not cancel or refund the invoice itself (issue a
  // credit note via `send` for that). Idempotent: cancelling an already-cancelled
  // invoice returns the stored cancelledAt rather than erroring.
  program
    .command('cancel-report <id>')
    .description('File an AEAT Spain SII Baja (withdrawal) against an already-registered invoice')
    .option('--reason <text>', 'Optional free text (<=100 chars), recorded for audit, never sent to AEAT')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { reason?: string; pretty?: boolean }) => {
      const body: Record<string, unknown> = {};
      if (opts.reason) body.reason = opts.reason;
      const idempotencyKey = createHash('sha256').update(`cancel|${id}`).digest('hex').slice(0, 64);
      const result = await api('POST', `/invoices/${encodeURIComponent(id)}/cancel-report`, body, { 'x-idempotency-key': idempotencyKey });
      print(result, !!opts.pretty);
    });

  // ── clearvo business-status <id> ─────────────────────────────────────────────
  // Records a customer-lifecycle ("business") status decision on a received
  // (inbound) invoice — approve, partially approve, dispute, suspend, refuse, or
  // mark paid. Only valid on an INBOUND invoice: the calling entity is the
  // customer recording its own decision. For an invoice you issued, the other
  // side's response syncs automatically once they act on their own side.
  program
    .command('business-status <id>')
    .description('Record a customer-lifecycle status decision on a received (inbound) invoice — FR/DE or Brazil (Manifestação do Destinatário)')
    .requiredOption('--status <status>', 'FR/DE: IN_HAND | APPROVED | PARTIALLY_APPROVED | DISPUTED | SUSPENDED | REFUSED | COMPLETED | PAYMENT_SENT | PAYMENT_RECEIVED. Brazil: CIENCIA | CONFIRMACAO | OPERACAO_NAO_REALIZADA | DESCONHECIMENTO.')
    .option('--reason <reason>', 'Short machine-usable reason code (FR/DE). Required when --status is DISPUTED, REFUSED, or SUSPENDED.')
    .option('--message <message>', 'Human-readable detail — optional alongside --reason for FR/DE, required (15-255 characters) for Brazil\'s OPERACAO_NAO_REALIZADA, and forbidden for DESCONHECIMENTO. Can be passed without --reason.')
    .option('--entity <entityId>', 'Entity that owns the invoice. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { status: string; reason?: string; message?: string; entity?: string; pretty?: boolean }) => {
      const body: Record<string, unknown> = { status: opts.status };
      if (opts.reason || opts.message) {
        body.rejectionDetail = { ...(opts.reason ? { reason: opts.reason } : {}), ...(opts.message ? { message: opts.message } : {}) };
      }
      const result = await api('PATCH', `/invoices/${encodeURIComponent(id)}/business-status`, body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });
  
  // ── clearvo reconciliation [id] ───────────────────────────────────────────────
  // ES SII block 3. Read-only: the AEAT Consulta reconciliation sweep runs on its
  // own schedule, never triggerable on demand. With no id, returns the latest run's
  // id plus a condensed reassurance-line status; pass an id (from that summary, or
  // the dashboard) to fetch the full stored comparison for one run.
  program
    .command('reconciliation [id]')
    .description('Fetch the latest Spain SII Consulta reconciliation summary, or one run by id')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string | undefined, opts: { pretty?: boolean }) => {
      const path = id ? `/sii/reconciliation/${encodeURIComponent(id)}` : '/sii/reconciliation';
      const result = await api('GET', path);
      print(result, !!opts.pretty);
    });
  
  // ── clearvo status <referenceId> ─────────────────────────────────────────────
  program
    .command('status <referenceId>')
    .description('Poll the clearance status of a submitted invoice')
    .requiredOption('--country <code>', 'ISO 3166-1 alpha-2 country code of the invoice (e.g. IT, PL)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (referenceId: string, opts: { country: string; pretty?: boolean }) => {
      const result = await api(
        'GET',
        `/status?id=${encodeURIComponent(referenceId)}&country=${encodeURIComponent(opts.country)}`
      );
      print(result, !!opts.pretty);
    });
  
  // ── clearvo calculate <file> ─────────────────────────────────────────────────
  // The JSON file carries the parties (supplier/customer) directly — there is
  // no per-field CLI override for them; edit the file instead.
  program
    .command('calculate <file>')
    .description('Calculate tax for a transaction from a JSON file. Purchase lines (--direction purchase) take glAccount, costCenter, intendedUse and accountAssignment (stock|expense|asset|project, or a raw ERP code) as plain line fields; customProperties is only for data that is not in the schema, and a built-in field name there is rejected with 400 BUILT_IN_PROPERTY_AS_CUSTOM')
    .option('--commit', 'Record in audit trail (redundant — this is the default; kept for backward compatibility)')
    .option('--dry-run', 'Preview only — do not record or bill this calculation')
    .option('--direction <sale|purchase>', '"sale" (default) — the entity is the supplier and the customer (from the file) is required. "purchase" — the entity is the customer and the supplier (from the file) is required. Overrides transactionDirection in the file when both are given.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (file: string, opts: {
      commit?: boolean;
      dryRun?: boolean;
      pretty?: boolean;
      direction?: 'sale' | 'purchase';
    }) => {
      const body = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      // The API defaults an omitted `commit` to true (persisted/billed) — this
      // command matches that default rather than overriding it. --dry-run is
      // the explicit opt-out; --commit is a harmless no-op kept so existing
      // scripts that already pass it don't break.
      if (opts.dryRun) {
        body.commit = false;
      } else if (opts.commit) {
        body.commit = true;
      }
      if (opts.direction) body.transactionDirection = opts.direction;
      const result = await api('POST', '/tax/calculate', body);
      print(result, !!opts.pretty);
    });
  
  // ── clearvo duties quote <file> ──────────────────────────────────────────────
  // POST /v1/duties/quote: estimated import duty, import VAT/GST and customs
  // fees for a cross-border cart. The JSON file is the same body as `clearvo
  // calculate`; commit, credit-note fields and transactionDirection 'purchase'
  // are rejected by the API. Stateless: nothing is recorded.
  const duties = program.command('duties').description('Estimated import duty, import VAT/GST and customs fees for cross-border carts');
  duties
    .command('quote <file>')
    .description('Estimate import duties and landed cost for a cart from a JSON file (the same body as `clearvo calculate`, without commit). Nothing is recorded, and nothing in the result is tax: it is never added to totalTax/totalAmountWithTax. summary.importChargesAtCheckout is the one amount a checkout may add.')
    .option('--entity <id>', 'Entity ID (x-entity-id), for account-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (file: string, opts: { entity?: string; pretty?: boolean }) => {
      const body = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      const result = await api('POST', '/duties/quote', body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo duties estimate <file> ───────────────────────────────────────────
  // POST /v1/duties/estimate: one product priced across up to 20 destinations.
  // Nothing is recorded; a read-only key is enough.
  duties
    .command('estimate <file>')
    .description('Estimate import duty, import VAT/GST, customs fees and landed cost for ONE product across up to 20 destinations, from a JSON file ({ currency, product, shipFrom, destinations[] }). Nothing is recorded. Each destination has a status (quoted, degraded, not_applicable); one bad destination never fails the call.')
    .option('--entity <id>', 'Entity ID (x-entity-id), for account-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (file: string, opts: { entity?: string; pretty?: boolean }) => {
      const body = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      const result = await api('POST', '/duties/estimate', body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo duties settle <calculationId> <file> ─────────────────────────────
  // POST /v1/tax/calculate/{id}/import-settlement: what customs actually charged.
  duties
    .command('settle <calculationId> <file>')
    .description('Record what customs actually charged for a committed calculation with a duties block, from a JSON file ({ entryNumber, actual: { duty, importTax, fees, currency }, entryDate?, consignmentId?, lines?, notes? }). Append-only and idempotent on the entry number; stores facts only. Returns estimated vs actual, variance and withinEstimate.')
    .option('--entity <id>', 'Entity ID (x-entity-id), for account-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (calculationId: string, file: string, opts: { entity?: string; pretty?: boolean }) => {
      const body = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      const result = await api('POST', `/tax/calculate/${encodeURIComponent(calculationId)}/import-settlement`, body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo duties settlements <calculationId> ───────────────────────────────
  duties
    .command('settlements <calculationId>')
    .description("List a calculation's import settlements and a per-currency summary")
    .option('--entity <id>', 'Entity ID (x-entity-id), for account-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (calculationId: string, opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('GET', `/tax/calculate/${encodeURIComponent(calculationId)}/import-settlement`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo duties variance ──────────────────────────────────────────────────
  duties
    .command('variance')
    .description('Estimate-versus-entry variance of your import settlements, grouped by destination customs territory and precision tier')
    .option('--from <date>', 'Earliest entry date, YYYY-MM-DD')
    .option('--to <date>', 'Latest entry date, YYYY-MM-DD')
    .option('--destination <territory>', 'Destination customs territory id, e.g. EU, GB, US')
    .option('--precision <tier>', 'Precision tier at quote time, e.g. TARIFF_LINE')
    .option('--entity <id>', 'Entity ID (x-entity-id), for account-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { from?: string; to?: string; destination?: string; precision?: string; entity?: string; pretty?: boolean }) => {
      const qs = new URLSearchParams();
      for (const key of ['from', 'to', 'destination', 'precision'] as const) if (opts[key]) qs.set(key, opts[key] as string);
      const q = qs.toString();
      const result = await api('GET', `/duties/settlement-variance${q ? `?${q}` : ''}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo validate-tin ─────────────────────────────────────────────────────
  program
    .command('validate-tin')
    .description('Validate a business tax number against the official authority')
    .requiredOption('--country <code>', 'ISO 3166-1 alpha-2 country code (e.g. DE, GB, AU)')
    .requiredOption('--number <taxNumber>', 'The tax/VAT number to validate')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { country: string; number: string; pretty?: boolean }) => {
      const result = await api('POST', '/tax-numbers/validate', {
        countryCode: opts.country,
        taxNumber: opts.number,
      });
      print(result, !!opts.pretty);
    });
  
  // ── clearvo requirements ─────────────────────────────────────────────────────
  program
    .command('requirements')
    .description('Get e-invoicing and tax requirements for a country')
    .requiredOption('--country <code>', 'ISO 3166-1 alpha-2 country code (e.g. IT, PL, DE)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { country: string; pretty?: boolean }) => {
      const result = await api('GET', `/requirements?country=${encodeURIComponent(opts.country)}`);
      print(result, !!opts.pretty);
    });
  
  // ── clearvo entities ────────────────────────────────────────────────────────
  const entities = program.command('entities').description('Manage entities');
  
  entities
    .command('list')
    .description('List all entities under the account')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { pretty?: boolean }) => {
      const result = await api('GET', '/entities');
      print(result, !!opts.pretty);
    });
  
  entities
    .command('create')
    .description('Create a new entity and receive an API key')
    .requiredOption('--name <legalName>', 'Official registered legal name')
    .requiredOption('--country <code>', 'Country of establishment (ISO 3166-1 alpha-2)')
    .option('--vat <vatNumber>', 'VAT registration number (include country prefix)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { name: string; country: string; vat?: string; pretty?: boolean }) => {
      const body: Record<string, string> = { legalName: opts.name, country: opts.country };
      if (opts.vat) body.vatNumber = opts.vat;
      const result = await api('POST', '/entities', body);
      print(result, !!opts.pretty);
      const r = result as Record<string, unknown>;
      if (r.apiKey) {
        console.error('\nSave this API key — it will not be shown again:');
        console.error(r.apiKey as string);
      }
    });
  
  entities
    .command('get <id>')
    .description('Get a specific entity by ID')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { pretty?: boolean }) => {
      const result = await api('GET', `/entities/${encodeURIComponent(id)}`);
      print(result, !!opts.pretty);
    });
  
  // ── clearvo products ────────────────────────────────────────────────────────
  const products = program.command('products').description('Manage the product catalogue');
  
  products
    .command('list')
    .description('List products in the catalogue')
    .option('--entity <entityId>', 'Filter by entity ID')
    .option('--limit <n>', 'Results per page', '25')
    .option('--page <n>', 'Page number', '1')
    .option('--sort <order>', 'Sort order: newest (default), name, or confidence')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { entity?: string; limit: string; page: string; sort?: string; pretty?: boolean }) => {
      const qs = new URLSearchParams({ limit: opts.limit, page: opts.page });
      if (opts.entity) qs.set('entityId', opts.entity);
      if (opts.sort)   qs.set('sort', opts.sort);
      const result = await api('GET', `/products?${qs}`);
      print(result, !!opts.pretty);
    });
  
  products
    .command('create')
    .description('Create a product in the catalogue')
    .requiredOption('--name <name>', 'Product or service name')
    .option('--sku <sku>', 'Internal SKU or product code')
    .option('--description <text>', 'Optional longer description')
    .option('--tax-category <slug>', 'Tax category slug (e.g. saas_business, physical_goods_general)')
    .option('--classification-code <system:code>', 'Repeatable (max 5). External classification code, e.g. stripe:txcd_10103001, shopify:aa-1-13, hs:610910', collectClassificationCode, [] as string[])
    .option('--entity <entityId>', 'Entity to create the product under')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: {
      name: string;
      sku?: string;
      description?: string;
      taxCategory?: string;
      classificationCode?: string[];
      entity?: string;
      pretty?: boolean;
    }) => {
      const body: Record<string, unknown> = { name: opts.name };
      if (opts.sku) body.sku = opts.sku;
      if (opts.description) body.description = opts.description;
      if (opts.taxCategory) body.taxCategory = opts.taxCategory;
      if (opts.classificationCode?.length) body.classificationCodes = parseClassificationCodes(opts.classificationCode);
      if (opts.entity) body.entityId = opts.entity;
      const result = await api('POST', '/products', body);
      print(result, !!opts.pretty);
    });
  
  products
    .command('update <id>')
    .description('Update a product (name, SKU, description, or tax category)')
    .option('--name <name>', 'Updated product name')
    .option('--sku <sku>', 'Updated SKU')
    .option('--description <text>', 'Updated description')
    .option('--tax-category <slug>', 'Updated tax category slug')
    .option('--classification-code <system:code>', 'Repeatable (max 5). Replaces the product\'s classification codes, e.g. stripe:txcd_10103001, shopify:aa-1-13', collectClassificationCode, [] as string[])
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: {
      name?: string;
      sku?: string;
      description?: string;
      taxCategory?: string;
      classificationCode?: string[];
      pretty?: boolean;
    }) => {
      const body: Record<string, unknown> = {};
      if (opts.classificationCode?.length) body.classificationCodes = parseClassificationCodes(opts.classificationCode);
      if (opts.name) body.name = opts.name;
      if (opts.sku) body.sku = opts.sku;
      if (opts.description) body.description = opts.description;
      if (opts.taxCategory) body.taxCategory = opts.taxCategory;
      const result = await api('PATCH', `/products/${encodeURIComponent(id)}`, body);
      print(result, !!opts.pretty);
    });
  
  products
    .command('get <id>')
    .description('Get a product by ID')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { pretty?: boolean }) => {
      const result = await api('GET', `/products/${encodeURIComponent(id)}`);
      print(result, !!opts.pretty);
    });
  
  // ── clearvo suppliers ───────────────────────────────────────────────────────
  // Mirrors `clearvo customers` (see the MCP list_customers/create_customer/
  // update_customer/delete_customer tools) for the other side of a transaction
  // — suppliers are the vendors on purchase-side tax calculations
  // (`clearvo calculate --direction purchase`) and on received e-invoices.
  const suppliers = program.command('suppliers').description('Manage supplier master data');
  
  suppliers
    .command('list')
    .description('List suppliers')
    .option('--search <text>', 'Case-insensitive substring match against the stored name')
    .option('--limit <n>', 'Results per page', '25')
    .option('--page <n>', 'Page number', '1')
    .option('--entity <entityId>', 'Entity to list suppliers for. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { search?: string; limit: string; page: string; entity?: string; pretty?: boolean }) => {
      const qs = new URLSearchParams({ limit: opts.limit, page: opts.page });
      if (opts.search) qs.set('search', opts.search);
      const result = await api('GET', `/suppliers?${qs}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });
  
  suppliers
    .command('create')
    .description('Create a supplier')
    .requiredOption('--name <name>', 'Supplier name')
    .option('--country <code>', 'ISO 3166-1 alpha-2 country code of the primary registration. Required together with --tax-id.')
    .option('--tax-id <taxId>', 'Tax ID of the primary registration. Required together with --country.')
    .option('--supplier-ref <ref>', 'Your own reference (e.g. ERP vendor id). Must be unique per entity.')
    .option('--establishment-country <code>', 'ISO 3166-1 alpha-2 country of this supplier\'s own place of establishment — independent of --country. Defaults to --country when omitted.')
    .option('--address-line1 <text>', 'Address line 1')
    .option('--address-line2 <text>', 'Address line 2')
    .option('--city <city>', 'City')
    .option('--region <region>', 'State/region/province')
    .option('--postal-code <code>', 'Postal code')
    .option('--entity <entityId>', 'Entity to create the supplier under. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: {
      name: string;
      country?: string;
      taxId?: string;
      supplierRef?: string;
      establishmentCountry?: string;
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      region?: string;
      postalCode?: string;
      entity?: string;
      pretty?: boolean;
    }) => {
      const body: Record<string, string> = { name: opts.name };
      if (opts.country) body.country = opts.country;
      if (opts.taxId) body.taxId = opts.taxId;
      if (opts.supplierRef) body.supplierRef = opts.supplierRef;
      if (opts.establishmentCountry) body.establishmentCountry = opts.establishmentCountry;
      if (opts.addressLine1) body.addressLine1 = opts.addressLine1;
      if (opts.addressLine2) body.addressLine2 = opts.addressLine2;
      if (opts.city) body.city = opts.city;
      if (opts.region) body.region = opts.region;
      if (opts.postalCode) body.postalCode = opts.postalCode;
      const result = await api('POST', '/suppliers', body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });
  
  suppliers
    .command('update <id>')
    .description('Update a supplier (name, tax registration, or address)')
    .option('--name <name>', 'Updated supplier name')
    .option('--country <code>', 'Updated country of the primary registration')
    .option('--tax-id <taxId>', 'Updated tax ID of the primary registration')
    .option('--supplier-ref <ref>', 'Updated own reference')
    .option('--establishment-country <code>', 'Updated place-of-establishment country')
    .option('--address-line1 <text>', 'Updated address line 1')
    .option('--address-line2 <text>', 'Updated address line 2')
    .option('--city <city>', 'Updated city')
    .option('--region <region>', 'Updated state/region/province')
    .option('--postal-code <code>', 'Updated postal code')
    .option('--trusted', 'AP decision layer full override — every vendor-charged-tax verification for this supplier then resolves ACCEPTED_AS_CHARGED regardless of delta')
    .option('--not-trusted', 'Clear the trusted override (set trusted=false)')
    .option('--tolerance-override <json>', 'JSON {absoluteAmount, percent}, or the literal string "null" to clear it back to the entity default')
    .option('--entity <entityId>', 'Entity the supplier belongs to. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: {
      name?: string;
      country?: string;
      taxId?: string;
      supplierRef?: string;
      establishmentCountry?: string;
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      region?: string;
      postalCode?: string;
      trusted?: boolean;
      notTrusted?: boolean;
      toleranceOverride?: string;
      entity?: string;
      pretty?: boolean;
    }) => {
      const body: Record<string, unknown> = {};
      if (opts.name) body.name = opts.name;
      if (opts.country) body.country = opts.country;
      if (opts.taxId) body.taxId = opts.taxId;
      if (opts.supplierRef) body.supplierRef = opts.supplierRef;
      if (opts.establishmentCountry) body.establishmentCountry = opts.establishmentCountry;
      if (opts.addressLine1) body.addressLine1 = opts.addressLine1;
      if (opts.addressLine2) body.addressLine2 = opts.addressLine2;
      if (opts.city) body.city = opts.city;
      if (opts.region) body.region = opts.region;
      if (opts.postalCode) body.postalCode = opts.postalCode;
      if (opts.trusted) body.trusted = true;
      if (opts.notTrusted) body.trusted = false;
      if (opts.toleranceOverride !== undefined) {
        body.toleranceOverride = opts.toleranceOverride === 'null' ? null : parseJsonOption('--tolerance-override', opts.toleranceOverride);
      }
      const result = await api('PATCH', `/suppliers/${encodeURIComponent(id)}`, body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });
  
  suppliers
    .command('get <id>')
    .description('Get a supplier by ID')
    .option('--entity <entityId>', 'Entity the supplier belongs to. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('GET', `/suppliers/${encodeURIComponent(id)}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });
  
  suppliers
    .command('get-by-ref <ref>')
    .description('Get a supplier by your own supplierRef')
    .option('--entity <entityId>', 'Entity the supplier belongs to. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (ref: string, opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('GET', `/suppliers/by-ref/${encodeURIComponent(ref)}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });
  
  suppliers
    .command('delete <id>')
    .description('Soft-delete a supplier')
    .option('--entity <entityId>', 'Entity the supplier belongs to. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('DELETE', `/suppliers/${encodeURIComponent(id)}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo company-codes (Enterprise) ──────────────────────────────────────
  // An internal split of ONE entity's transactions; never deleted, only archived.
  const companyCodes = program.command('company-codes').description('Manage an entity\'s company codes (Enterprise plans only)');

  companyCodes
    .command('list')
    .description('List company codes')
    .option('--active', 'Leave archived codes out')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { active?: boolean; entity?: string; pretty?: boolean }) => {
      const result = await api('GET', `/company-codes${opts.active ? '?status=active' : ''}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  companyCodes
    .command('create')
    .description('Add a company code')
    .requiredOption('--code <code>', 'The code as your ERP writes it (1 to 50 characters)')
    .option('--name <name>', 'Display name')
    .option('--valid-from <date>', 'First day (YYYY-MM-DD, inclusive) the code is valid. Omit for no start limit')
    .option('--valid-to <date>', 'Last day (YYYY-MM-DD, inclusive) the code is valid. Omit for no end limit')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { code: string; name?: string; validFrom?: string; validTo?: string; entity?: string; pretty?: boolean }) => {
      const body: Record<string, string> = { code: opts.code };
      if (opts.name) body.name = opts.name;
      if (opts.validFrom) body.validFrom = opts.validFrom;
      if (opts.validTo) body.validTo = opts.validTo;
      const result = await api('POST', '/company-codes', body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  companyCodes
    .command('update <id>')
    .description('Rename, archive or reactivate a company code (the code itself never changes; there is no delete)')
    .option('--name <name>', 'New display name')
    .option('--archive', 'Set status=archived')
    .option('--activate', 'Set status=active')
    .option('--valid-from <date>', 'First day (YYYY-MM-DD, inclusive) the code is valid; "none" clears the start limit')
    .option('--valid-to <date>', 'Last day (YYYY-MM-DD, inclusive) the code is valid; "none" clears the end limit')
    .option('--clear-valid-from', 'Clear the start limit (same as --valid-from none)')
    .option('--clear-valid-to', 'Clear the end limit (same as --valid-to none)')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { name?: string; archive?: boolean; activate?: boolean; validFrom?: string; validTo?: string; clearValidFrom?: boolean; clearValidTo?: boolean; entity?: string; pretty?: boolean }) => {
      const body: Record<string, string | null> = {};
      if (opts.name) body.name = opts.name;
      if (opts.clearValidFrom || opts.validFrom?.toLowerCase() === 'none') body.validFrom = null;
      else if (opts.validFrom) body.validFrom = opts.validFrom;
      if (opts.clearValidTo || opts.validTo?.toLowerCase() === 'none') body.validTo = null;
      else if (opts.validTo) body.validTo = opts.validTo;
      if (opts.archive) body.status = 'archived';
      if (opts.activate) body.status = 'active';
      const result = await api('PATCH', `/company-codes/${encodeURIComponent(id)}`, body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo bank-accounts ───────────────────────────────────────────────────
  // Entity-owned IBAN/BIC master data (exactly one account is the default) so it
  // doesn't need to be resent on every invoice. An invoice uses its own
  // payment.means[].iban if sent, else the account for its currency, else the default.
  const bankAccounts = program.command('bank-accounts').description('Manage bank-account master data');

  bankAccounts
    .command('list')
    .description('List bank accounts')
    .option('--entity <entityId>', 'Entity to list bank accounts for. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('GET', '/bank-accounts', undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  bankAccounts
    .command('create')
    .description('Store a bank account')
    .requiredOption('--iban <iban>', 'IBAN — format/checksum-validated before storing')
    .option('--currency <code>', 'ISO 4217 alpha-3 currency this account is used for (optional)')
    .option('--default', 'Make this the default account (the first account is the default automatically)')
    .option('--bic <bic>', 'BIC')
    .option('--account-holder-name <name>', 'Name of the account holder. Printed as the payee account name (BT-85) on invoices that use this account when the caller sends no iban')
    .option('--entity <entityId>', 'Entity to create the bank account under. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: {
      iban: string;
      currency?: string;
      default?: boolean;
      bic?: string;
      accountHolderName?: string;
      entity?: string;
      pretty?: boolean;
    }) => {
      const body: Record<string, string | boolean> = { iban: opts.iban };
      if (opts.currency) body.currency = opts.currency;
      if (opts.default) body.isDefault = true;
      if (opts.bic) body.bic = opts.bic;
      if (opts.accountHolderName) body.accountHolderName = opts.accountHolderName;
      const result = await api('POST', '/bank-accounts', body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  bankAccounts
    .command('update <id>')
    .description('Update a bank account')
    .option('--currency <code>', 'Updated currency, or the literal string "null" to clear it')
    .option('--default', 'Make this the default account (to change the default, make another account the default)')
    .option('--iban <iban>', 'Updated IBAN — re-validated (format/checksum)')
    .option('--bic <bic>', 'Updated BIC, or the literal string "null" to clear it')
    .option('--account-holder-name <name>', 'Updated account holder name, or the literal string "null" to clear it')
    .option('--entity <entityId>', 'Entity the bank account belongs to. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: {
      currency?: string;
      default?: boolean;
      iban?: string;
      bic?: string;
      accountHolderName?: string;
      entity?: string;
      pretty?: boolean;
    }) => {
      const body: Record<string, unknown> = {};
      if (opts.currency !== undefined) body.currency = opts.currency === 'null' ? null : opts.currency;
      if (opts.default) body.isDefault = true;
      if (opts.iban) body.iban = opts.iban;
      if (opts.bic !== undefined) body.bic = opts.bic === 'null' ? null : opts.bic;
      if (opts.accountHolderName !== undefined) body.accountHolderName = opts.accountHolderName === 'null' ? null : opts.accountHolderName;
      const result = await api('PATCH', `/bank-accounts/${encodeURIComponent(id)}`, body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  bankAccounts
    .command('get <id>')
    .description('Get a bank account by ID')
    .option('--entity <entityId>', 'Entity the bank account belongs to. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('GET', `/bank-accounts/${encodeURIComponent(id)}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  bankAccounts
    .command('delete <id>')
    .description('Soft-delete a bank account')
    .option('--entity <entityId>', 'Entity the bank account belongs to. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('DELETE', `/bank-accounts/${encodeURIComponent(id)}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo webhooks ────────────────────────────────────────────────────────
  const webhooks = program.command('webhooks').description('Manage webhook endpoints');
  
  webhooks
    .command('list')
    .description('List registered webhook endpoints')
    .option('--limit <n>', 'Results per page', '50')
    .option('--page <n>', 'Page number', '1')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { limit: string; page: string; pretty?: boolean }) => {
      const qs = new URLSearchParams({ limit: opts.limit, page: opts.page });
      const result = await api('GET', `/webhooks?${qs}`);
      print(result, !!opts.pretty);
    });
  
  webhooks
    .command('create')
    .description('Register a new webhook endpoint')
    .requiredOption('--url <url>', 'HTTPS endpoint URL to deliver events to (a public address; no credentials, no internal or private addresses; redirects are not followed)')
    .option('--events <events>', 'Comma-separated event types (default: *, which does NOT include invoice.status_changed; list that one by name). Options: invoice.status_changed,invoice.accepted,invoice.rejected,invoice.duplicate,invoice.undelivered,invoice.pending', '*')
    .option('--statuses <statuses>', 'Comma-separated statuses, only with the invoice.status_changed event (for example NEEDS_INFO,REJECTED,ACCEPTED). Omit for every status change')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { url: string; events: string; statuses?: string; pretty?: boolean }) => {
      const events = opts.events.split(',').map(e => e.trim()).filter(Boolean);
      const body: Record<string, unknown> = { url: opts.url, events };
      if (opts.statuses) body.statuses = opts.statuses.split(',').map(x => x.trim()).filter(Boolean);
      const result = await api('POST', '/webhooks', body);
      print(result, !!opts.pretty);
      const r = result as Record<string, unknown>;
      if (r.secret) {
        console.error('\nSave this webhook secret — it will not be shown again:');
        console.error(r.secret as string);
      }
    });
  
  webhooks
    .command('delete <id>')
    .description('Deactivate a webhook endpoint')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { pretty?: boolean }) => {
      const result = await api('DELETE', `/webhooks?id=${encodeURIComponent(id)}`);
      print(result, !!opts.pretty);
    });

  webhooks
    .command('test <id>')
    .description('Send a signed test event to a webhook endpoint and show what it answered (sent once, nothing is stored)')
    .option('--event <event>', 'Event to simulate: invoice.received (default), accepted, rejected, duplicate, undelivered, pending, business_status_changed or status_changed (prefix invoice.)')
    .option('--to <status>', 'Only with --event invoice.status_changed: the new status the sample reports (for example NEEDS_INFO). Default: the invoice\'s own status, else ACCEPTED')
    .option('--invoice <invoiceId>', 'Build the payload from one of your own invoices instead of sample values')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { event?: string; to?: string; invoice?: string; pretty?: boolean }) => {
      const body: Record<string, string> = { webhookId: id };
      if (opts.event) body.event = opts.event;
      if (opts.to) body.to = opts.to;
      if (opts.invoice) body.invoiceId = opts.invoice;
      const result = await api('POST', '/webhooks/test', body);
      print(result, !!opts.pretty);
    });
  
  // ── clearvo receive simulate ─────────────────────────────────────────────────
  // Sandbox only: creates sample received invoices / credit notes through the real inbound pipeline.
  const receive = program.command('receive').description('Received (inbound) invoices');
  receive
    .command('simulate')
    .description('Sandbox only: create sample received invoices or credit notes from a fictional supplier (needs a csk_test_ key)')
    .option('--country <code>', 'DE or FR: the tax registration the invoices are received under (default: the establishment country, else the single supported registration)')
    .option('--type <type>', 'invoice (default) or credit_note')
    .option('--count <n>', 'How many documents, 1-20 (default 1)')
    .option('--total <amount>', 'Gross total of each document (default 1200)')
    .option('--currency <code>', 'Three-letter currency code (France: EUR only)')
    .option('--issue-date <date>', 'YYYY-MM-DD (default today)')
    .option('--status <status>', 'Move each document to this lifecycle status after it arrives (e.g. APPROVED, DISPUTED, REFUSED)')
    .option('--entity <entityId>', 'Entity ID (required for account-scoped keys)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { country?: string; type?: string; count?: string; total?: string; currency?: string; issueDate?: string; status?: string; entity?: string; pretty?: boolean }) => {
      const body: Record<string, unknown> = {};
      if (opts.country) body.country = opts.country.toUpperCase();
      if (opts.type) body.type = opts.type;
      if (opts.count) body.count = Number(opts.count);
      if (opts.total) body.totalAmount = Number(opts.total);
      if (opts.currency) body.currency = opts.currency.toUpperCase();
      if (opts.issueDate) body.issueDate = opts.issueDate;
      if (opts.status) body.businessStatus = opts.status;
      const result = await api('POST', '/receive/simulate', body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo tests ────────────────────────────────────────────────────────────
  // Sandbox only: run your integration tests (POST /test-runs) and read the outcome. Exit code 1 when the run failed, so CI can gate on it.
  const tests = program.command('tests').description('Your integration tests in the sandbox: run them, read the outcome, manage your own tests');

  function printRunSummary(run: Record<string, unknown>) {
    const sum = (run.summary ?? {}) as Record<string, number>;
    console.log(`Run ${run.runId} "${run.name}": ${String(run.status).toUpperCase()}`);
    console.log(`  passed ${sum.passed ?? 0}, failed ${sum.failed ?? 0}, waiting ${sum.waiting ?? 0}, not run ${sum.notRun ?? 0}, not applicable ${sum.notApplicable ?? 0}`);
    console.log(`  required tests passed: ${sum.requiredPassed ?? 0} of ${sum.required ?? 0} (checked automatically: ${sum.autoVerified ?? 0}, marked done by hand: ${sum.selfAttested ?? 0})`);
    for (const c of (Array.isArray(run.cases) ? run.cases : []) as Array<Record<string, unknown>>) {
      if (c.outcome === 'failed') console.log(`  FAILED: ${c.title}${c.reason ? ` - ${c.reason}` : ''}`);
    }
    if (typeof run.disclaimer === 'string') console.log(`\n${run.disclaimer}`);
  }

  tests
    .command('run')
    .description('Start a run of your integration tests (sandbox key). With --wait, poll until it is no longer queued or running; exits 1 if it failed')
    .option('--name <name>', 'A name for the run')
    .option('--tag <tag>', 'Run only tests with this tag (repeatable; default "automatic")', (v: string, prev: string[] = []) => [...prev, v])
    .option('--case <id>', 'Run only this test (repeatable; ids from "clearvo tests cases list")', (v: string, prev: string[] = []) => [...prev, v])
    .option('--deadline-minutes <n>', 'How long the run may wait for your integration to act, 1-1440 (default 10)')
    .option('--idempotency-key <key>', 'Retrying with the same key returns the same run')
    .option('--wait', 'Wait for the run to finish and print its summary')
    .option('--interval <seconds>', 'Seconds between polls with --wait (default 5)')
    .option('--json', 'Print JSON instead of a summary')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { name?: string; tag?: string[]; case?: string[]; deadlineMinutes?: string; idempotencyKey?: string; wait?: boolean; interval?: string; json?: boolean; pretty?: boolean }) => {
      const body: Record<string, unknown> = {};
      if (opts.name) body.name = opts.name;
      if (opts.tag?.length) body.tags = opts.tag;
      if (opts.case?.length) body.caseIds = opts.case;
      if (opts.deadlineMinutes) body.deadlineMinutes = Number(opts.deadlineMinutes);
      const started = await api('POST', '/test-runs', body, opts.idempotencyKey ? { 'x-idempotency-key': opts.idempotencyKey } : undefined) as Record<string, unknown>;
      if (!opts.wait) {
        if (opts.json) print(started, !!opts.pretty);
        else console.log(`Started run ${started.runId} (${started.status}). Read it with: clearvo tests status ${started.runId}`);
        return;
      }
      const intervalMs = Math.max(0, Number(opts.interval ?? 5)) * 1000;
      let run = started;
      for (;;) {
        run = await api('GET', `/test-runs/${encodeURIComponent(String(started.runId))}`) as Record<string, unknown>;
        if (run.status !== 'queued' && run.status !== 'running') break;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      if (opts.json) print(run, !!opts.pretty);
      else printRunSummary(run);
      if (run.status === 'failed') process.exit(1);
    });

  tests
    .command('status <runId>')
    .description('Show one test run: its status, counts and each test\'s outcome')
    .option('--json', 'Print JSON instead of a summary')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (runId: string, opts: { json?: boolean; pretty?: boolean }) => {
      const run = await api('GET', `/test-runs/${encodeURIComponent(runId)}`) as Record<string, unknown>;
      if (opts.json) print(run, !!opts.pretty);
      else printRunSummary(run);
    });

  tests
    .command('export <runId>')
    .description('Export the record of one test run to keep (JSON): what each test expected, what was observed, the test version and a content digest')
    .option('--out <file>', 'Write the record to this file instead of printing it')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (runId: string, opts: { out?: string; pretty?: boolean }) => {
      const record = await api('GET', `/test-runs/${encodeURIComponent(runId)}/export`);
      if (opts.out) {
        writeFileSync(opts.out, JSON.stringify(record, null, 2));
        console.log(opts.out);
      } else {
        print(record, !!opts.pretty);
      }
    });

  const testCases = tests.command('cases').description('The tests you can run: standard ones and your own');

  testCases
    .command('list')
    .description('List your tests, whether each applies to your setup and how it is checked')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { pretty?: boolean }) => {
      print(await api('GET', '/test-cases'), !!opts.pretty);
    });

  testCases
    .command('create')
    .description('Add a test of your own (see GET /test-cases/catalogue for the checks it accepts)')
    .requiredOption('--title <title>', 'A short name for the test')
    .requiredOption('--step <step>', 'What to do, one step per flag (repeatable)', (v: string, prev: string[] = []) => [...prev, v])
    .requiredOption('--expected <text>', 'What should happen when the steps are done')
    .option('--description <text>', 'Optional extra detail')
    .option('--check <json>', 'Optional check the platform runs, as JSON: {"kind":"...","params":{...}}')
    .option('--applies-when <json>', 'Optional JSON: {"direction":"any|sale|purchase","countries":["FR"]}')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { title: string; step: string[]; expected: string; description?: string; check?: string; appliesWhen?: string; pretty?: boolean }) => {
      const body: Record<string, unknown> = { title: opts.title, steps: opts.step, expected: opts.expected };
      if (opts.description) body.description = opts.description;
      try {
        if (opts.check) body.check = JSON.parse(opts.check);
        if (opts.appliesWhen) body.appliesWhen = JSON.parse(opts.appliesWhen);
      } catch {
        console.error('--check and --applies-when must be valid JSON');
        process.exit(1);
      }
      print(await api('POST', '/test-cases', body), !!opts.pretty);
    });

  tests
    .command('skip <caseId>')
    .description('Skip a test you do not need: it is not run, counts nowhere, and every run and export lists it as skipped')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (caseId: string, opts: { pretty?: boolean }) => {
      print(await api('PUT', `/test-cases/${encodeURIComponent(caseId)}/skip`, { skipped: true }), !!opts.pretty);
    });

  tests
    .command('unskip <caseId>')
    .description('Put a skipped test back so new runs include it again')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (caseId: string, opts: { pretty?: boolean }) => {
      print(await api('PUT', `/test-cases/${encodeURIComponent(caseId)}/skip`, { skipped: false }), !!opts.pretty);
    });

  testCases
    .command('archive <caseId>')
    .description('Remove one of your own tests from new runs (past runs keep showing it)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (caseId: string, opts: { pretty?: boolean }) => {
      print(await api('DELETE', `/test-cases/${encodeURIComponent(caseId)}`), !!opts.pretty);
    });

  // ── clearvo validate-tin-batch ───────────────────────────────────────────────
  program
    .command('validate-tin-batch <file>')
    .description('Validate up to 20 tax numbers from a JSON file (array of {countryCode, taxNumber})')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (file: string, opts: { pretty?: boolean }) => {
      const items = JSON.parse(readFileSync(file, 'utf8')) as unknown[];
      const result = await api('POST', '/tax-numbers/validate-batch', { items });
      print(result, !!opts.pretty);
    });
  
  // ── clearvo registrations ───────────────────────────────────────────────────
  const registrations = program.command('registrations').description('Manage tax registrations');
  
  registrations
    .command('list')
    .description('List tax registrations and obligations for an entity')
    .option('--entity <entityId>', 'Entity ID (required for account-scoped keys)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { entity?: string; pretty?: boolean }) => {
      const qs = opts.entity ? `?entityId=${encodeURIComponent(opts.entity)}` : '';
      const result = await api('GET', `/tax/registrations${qs}`);
      print(result, !!opts.pretty);
    });
  
  registrations
    .command('set-collection <id>')
    .description('Set the collection start date for a registration')
    .option('--immediately', 'Start collecting tax immediately (today)')
    .option('--from <date>', 'Defer collection to a future date (YYYY-MM-DD)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { immediately?: boolean; from?: string; pretty?: boolean }) => {
      if (!opts.immediately && !opts.from) {
        console.error('Error: provide either --immediately or --from <date>');
        process.exit(1);
      }
      const collectFromDate = opts.immediately ? null : (opts.from ?? null);
      const result = await api('PATCH', `/tax/registrations/${encodeURIComponent(id)}`, { collectFromDate });
      print(result, !!opts.pretty);
    });
  
  registrations
    .command('update <id>')
    .description('Edit an existing registration\'s tax number and/or secondary identifiers (e.g. France\'s SIRET, Germany\'s Handelsregisternummer/Kleinunternehmer flag; Spain\'s es_tax_territory: mainland | canary_islands | both — Canary Islands IGIC invoices need it) in place')
    .option('--number <taxNumber>', 'New registration/VAT number (pass an empty string to clear it)')
    .option('--extra <json>', 'JSON object of secondary identifiers to merge in, e.g. \'{"fr_siret":"12345678901234"}\' or \'{"de_handelsregisternummer":"HRB 12345","de_kleinunternehmer":"true"}\' or \'{"es_tax_territory":"canary_islands"}\' — see docs for the full de_* key list')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { number?: string; extra?: string; pretty?: boolean }) => {
      if (opts.number === undefined && opts.extra === undefined) {
        console.error('Error: provide --number and/or --extra');
        process.exit(1);
      }
      const body: Record<string, unknown> = {};
      if (opts.number !== undefined) body.taxNumber = opts.number;
      if (opts.extra !== undefined) {
        try {
          body.extraFields = JSON.parse(opts.extra);
        } catch {
          console.error('Error: --extra must be valid JSON');
          process.exit(1);
        }
      }
      const result = await api('PATCH', `/tax/registrations/${encodeURIComponent(id)}`, body);
      print(result, !!opts.pretty);
    });
  
  registrations
    .command('add')
    .description('Record a new tax registration (VAT, IOSS, OSS, VOEC)')
    .requiredOption('--type <type>', 'Registration type: VAT, IOSS, UNION_OSS, NON_UNION_OSS, VOEC')
    .requiredOption('--number <taxNumber>', 'The registration number issued by the authority')
    .option('--country <code>', 'ISO 3166-1 alpha-2 country code (not required for IOSS)')
    .option('--entity <entityId>', 'Entity to register (required for account-scoped keys)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { type: string; number: string; country?: string; entity?: string; pretty?: boolean }) => {
      const body: Record<string, string> = { type: opts.type.toUpperCase(), taxNumber: opts.number };
      if (opts.country) body.country = opts.country.toUpperCase();
      if (opts.entity) body.entityId = opts.entity;
      const result = await api('POST', '/tax/registrations', body);
      print(result, !!opts.pretty);
    });
  
  // ── clearvo fr credentials ───────────────────────────────────────────────────
  // France platform onboarding/status (POST/GET /v1/fr/credentials). No secret
  // is stored — this registers/reads back the entity's own French VAT number
  // and its per-capability (einvoicing/ereporting) onboarding status.
  const fr = program.command('fr').description('France platform onboarding/status');
  const frCredentials = fr.command('credentials').description('Manage the entity\'s French VAT number and its onboarding status');
  
  frCredentials
    .command('set')
    .description('Register or update the entity\'s French VAT number for e-invoicing/e-reporting onboarding')
    .requiredOption('--tax-number <taxNumber>', 'French VAT number (numéro de TVA intracommunautaire). FR-prefixed, lowercase, spaced, or the bare 11-character SIREN+key form are all accepted and normalised.')
    .option('--entity <entityId>', 'Entity to configure. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { taxNumber: string; entity?: string; pretty?: boolean }) => {
      const result = await api('POST', '/fr/credentials', { taxNumber: opts.taxNumber }, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });
  
  frCredentials
    .command('get')
    .description('Read back the entity\'s French VAT number and its onboarding status')
    .option('--entity <entityId>', 'Entity to read. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('GET', '/fr/credentials', undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // clearvo fr inbound poll — manual trigger, part of the temporary Marosa
  // interim bridge (see the clearvo-fr-marosa skill). Resolves status on this
  // entity's own pending outbound submissions and discovers newly received
  // inbound documents; the automatic poll already runs every 5 minutes, so
  // this is only for when you don't want to wait for it.
  const frInbound = fr.command('inbound').description('France inbound document polling (Marosa interim bridge)');
  frInbound
    .command('poll')
    .description('Manually trigger a France inbound poll for this entity')
    .option('--entity <entityId>', 'Entity to poll. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('POST', '/fr/inbound/poll', {}, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo it profile ────────────────────────────────────────────────────
  // Italy's required Regime Fiscale profile field (GET/PUT /v1/it/profile).
  // Not a credential — Clearvo (Blue Arrow Solutions) is the accredited SDI
  // intermediary, so there's no per-entity Italy credential to register.
  const it = program.command('it').description('Italy profile field (Regime Fiscale)');
  const itProfile = it.command('profile').description('Manage the entity\'s Regime Fiscale');

  itProfile
    .command('set')
    .description('Set the entity\'s Italy Regime Fiscale — requires a current Italy tax registration to already exist')
    .requiredOption('--regime-fiscale <code>', "Regime Fiscale code, e.g. 'RF01'. Run 'clearvo it profile get' to see the full option list.")
    .option('--entity <entityId>', 'Entity to configure. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { regimeFiscale: string; entity?: string; pretty?: boolean }) => {
      const result = await api('PUT', '/it/profile', { regimeFiscale: opts.regimeFiscale }, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  itProfile
    .command('get')
    .description('Read back the entity\'s Italy Regime Fiscale, whether it\'s configured, and the full option list')
    .option('--entity <entityId>', 'Entity to read. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('GET', '/it/profile', undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });


  // Brazil NF-e receiving onboarding/status (POST/GET /v1/br/credentials,
  // POST /v1/br/inbound/poll, GET /v1/br/sync-status, PATCH /v1/br/settings).
  // Mirrors the `fr` namespace's shape. Only A1 (PKCS#12) e-CNPJ certificates
  // are supported — A3 has no headless path and is refused server-side.
  const br = program.command('br').description('Brazil NF-e receiving onboarding/status');
  const brCredentials = br.command('credentials').description('Manage the entity\'s e-CNPJ A1 certificate for Distribuição DFe');

  brCredentials
    .command('set')
    .description('Register or update the entity\'s Brazil e-CNPJ A1 certificate (.pfx)')
    .requiredOption('--pfx-file <path>', 'Path to the e-CNPJ A1 certificate export (.pfx). Read and base64-encoded locally — never sent as a raw file path.')
    .requiredOption('--password <password>', 'The .pfx password. Never stored — used once to unlock the certificate for this save.')
    .requiredOption('--consent', 'Confirms authorization for Clearvo to use this certificate to fetch invoices addressed to this CNPJ and to record this entity\'s own manifestation responses with SEFAZ on its behalf.')
    .option('--auto-ciencia <bool>', 'Whether Clearvo auto-registers Ciência da Operação as documents are discovered. Defaults to true.', (v: string) => v !== 'false')
    .option('--entity <entityId>', 'Entity to configure. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { pfxFile: string; password: string; consent: boolean; autoCiencia?: boolean; entity?: string; pretty?: boolean }) => {
      const pfxBase64 = readFileSync(opts.pfxFile).toString('base64');
      const body: Record<string, unknown> = { pfxBase64, password: opts.password, consent: opts.consent };
      if (opts.autoCiencia !== undefined) body.autoCiencia = opts.autoCiencia;
      const result = await api('POST', '/br/credentials', body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  brCredentials
    .command('get')
    .description('Read back the entity\'s stored e-CNPJ certificate status (CNPJ, expiry, autoCiencia) — no key material returned')
    .option('--entity <entityId>', 'Entity to read. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('GET', '/br/credentials', undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // clearvo br inbound poll — manual trigger. Clearvo's own hourly sweep
  // already does this; the shared SEFAZ 20/hour-per-CNPJ-root budget and the
  // per-entity 60-minute cooldown both still apply and answer 429 before any
  // real SEFAZ call is attempted.
  const brInbound = br.command('inbound').description('Brazil Distribuição DFe inbound polling');
  brInbound
    .command('poll')
    .description('Manually trigger a Distribuição DFe poll cycle for this entity')
    .option('--entity <entityId>', 'Entity to poll. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('POST', '/br/inbound/poll', {}, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  br
    .command('sync-status')
    .description('Check the health of the Brazil Distribuição DFe poll job for an entity — pure DB read, never calls SEFAZ')
    .option('--entity <entityId>', 'Entity to check. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('GET', '/br/sync-status', undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  const brSettings = br.command('settings').description('Configure Brazil-specific entity settings');
  brSettings
    .command('update')
    .description('Flip Brazil auto-Ciência on or off for an entity that already has a certificate on file — never re-requires the certificate')
    .requiredOption('--auto-ciencia <bool>', 'true | false')
    .option('--entity <entityId>', 'Entity to configure. Required for account-scoped keys; omit for entity-scoped keys.')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { autoCiencia: string; entity?: string; pretty?: boolean }) => {
      const result = await api('PATCH', '/br/settings', { autoCiencia: opts.autoCiencia !== 'false' }, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo tax-codes ────────────────────────────────────────────────────────
  // A client tax code maps your own ERP tax code (e.g. a SAP two-digit code) to
  // a Clearvo Tax Decision — movement, taxability, customerType, supplyType,
  // reverseCharge, useTaxSelfAssessed, and (where meaningful) rateBand. The
  // EN16931 taxCode and rate are always computed live, never request fields.
  const taxCodes = program.command('tax-codes').description('Manage client tax codes');
  
  function taxCodeMutationBody(opts: {
    code?: string; country?: string; region?: string;
    movement?: string; taxability?: string; customerType?: string; supplyType?: string;
    rateBand?: string; reverseCharge?: boolean; useTaxSelfAssessed?: boolean;
    filingTag?: string; direction?: string; recoverabilityType?: string; recoverablePercentage?: string;
    exemptionReasonCode?: string; description?: string; invoiceReferenceText?: string;
  }): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    if (opts.code)        body.code = opts.code;
    if (opts.country)     body.country = opts.country.toUpperCase();
    if (opts.region)      body.region = opts.region.toUpperCase();
    if (opts.movement)    body.movement = opts.movement;
    if (opts.taxability)  body.taxability = opts.taxability;
    if (opts.customerType) body.customerType = opts.customerType;
    if (opts.supplyType)  body.supplyType = opts.supplyType;
    if (opts.rateBand)    body.rateBand = opts.rateBand;
    if (opts.reverseCharge !== undefined) body.reverseCharge = opts.reverseCharge;
    if (opts.useTaxSelfAssessed !== undefined) body.useTaxSelfAssessed = opts.useTaxSelfAssessed;
    if (opts.filingTag)   body.filingTag = opts.filingTag;
    if (opts.direction)   body.direction = opts.direction;
    if (opts.recoverabilityType) body.recoverabilityType = opts.recoverabilityType;
    if (opts.recoverablePercentage) body.recoverablePercentage = Number(opts.recoverablePercentage);
    if (opts.exemptionReasonCode) body.exemptionReasonCode = opts.exemptionReasonCode;
    if (opts.description) body.description = opts.description;
    if (opts.invoiceReferenceText) body.invoiceReferenceText = opts.invoiceReferenceText;
    return body;
  }
  
  taxCodes
    .command('list')
    .description('List client tax codes for an entity')
    .option('--entity <entityId>', 'Entity ID (required for account-scoped keys)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('GET', '/tax/client-codes', undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });
  
  taxCodes
    .command('create')
    .description('Create a client tax code')
    .requiredOption('--code <code>', 'Your own ERP tax code, unique per entity')
    .requiredOption('--country <code>', 'ISO 3166-1 alpha-2 or alpha-3 country code (e.g. DE)')
    .option('--region <region>', 'Sub-national scope (e.g. a US state)')
    .requiredOption('--movement <movement>', 'local, intra_community, export, distance_sale, import, or own_goods_movement')
    .requiredOption('--taxability <taxability>', 'taxable, exempt, or out_of_scope')
    .option('--customer-type <type>', 'b2b or b2c — omit for a code that applies to either')
    .requiredOption('--supply-type <type>', 'goods, digital_service, or general_service')
    .option('--rate-band <band>', 'standard, middle, reduced, super_reduced, special, or zero — required when taxability=taxable and the movement/reverseCharge combination doesn\'t already fix the EN16931 code')
    .option('--reverse-charge', 'Independent of movement — some countries require domestic reverse charge even on a wholly local sale')
    .option('--use-tax-self-assessed', 'Mark use tax as self-assessed')
    .option('--filing-tag <tag>', 'Pure metadata for a future Taxsure integration — never consumed by any computation')
    .option('--direction <direction>', 'sale or purchase — omit for a code that applies to both')
    .option('--recoverability-type <type>', 'full, blocked, or restricted — purchase-side input-tax recoverability only')
    .option('--recoverable-percentage <percent>', 'Required (and only meaningful) when --recoverability-type=restricted — strictly between 0 and 100 (0 and 100 are already blocked/full)')
    .option('--exemption-reason-code <code>', 'Free-text reason code for an exempt/out-of-scope row — pure metadata, never validated against an enum, max 30 characters')
    .option('--description <text>', 'Optional longer description')
    .option('--invoice-reference-text <text>', 'Free-text exemption wording, only meaningful for an exempt/out-of-scope/reverse-charge code — passed through verbatim onto every invoice using this code, never derived or auto-generated')
    .option('--entity <entityId>', 'Entity to create the client tax code under (required for account-scoped keys)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: {
      code: string; country: string; region?: string; movement: string; taxability: string;
      customerType?: string; supplyType: string; rateBand?: string; reverseCharge?: boolean;
      useTaxSelfAssessed?: boolean; filingTag?: string; direction?: string;
      recoverabilityType?: string; recoverablePercentage?: string; exemptionReasonCode?: string;
      description?: string; invoiceReferenceText?: string; entity?: string; pretty?: boolean;
    }) => {
      const body = taxCodeMutationBody(opts);
      const result = await api('POST', '/tax/client-codes', body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });
  
  taxCodes
    .command('update <id>')
    .description('Update a client tax code (any subset of its fields)')
    .option('--code <code>', 'Updated code')
    .option('--country <code>', 'Updated country')
    .option('--region <region>', 'Updated region')
    .option('--movement <movement>', 'local, intra_community, export, distance_sale, import, or own_goods_movement')
    .option('--taxability <taxability>', 'taxable, exempt, or out_of_scope')
    .option('--customer-type <type>', 'b2b or b2c')
    .option('--supply-type <type>', 'goods, digital_service, or general_service')
    .option('--rate-band <band>', 'standard, middle, reduced, super_reduced, special, or zero')
    .option('--reverse-charge', 'Set reverseCharge to true')
    .option('--use-tax-self-assessed', 'Set useTaxSelfAssessed to true')
    .option('--filing-tag <tag>', 'Updated filing tag')
    .option('--direction <direction>', 'sale or purchase')
    .option('--recoverability-type <type>', 'full, blocked, or restricted — see `tax-codes create`')
    .option('--recoverable-percentage <percent>', 'See `tax-codes create`')
    .option('--exemption-reason-code <code>', 'Updated free-text exemption reason code — see `tax-codes create`')
    .option('--description <text>', 'Updated description')
    .option('--invoice-reference-text <text>', 'Updated free-text exemption wording — see `tax-codes create`')
    .option('--entity <entityId>', 'Entity the client tax code belongs to (required for account-scoped keys)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: {
      code?: string; country?: string; region?: string; movement?: string; taxability?: string;
      customerType?: string; supplyType?: string; rateBand?: string; reverseCharge?: boolean;
      useTaxSelfAssessed?: boolean; filingTag?: string; direction?: string;
      recoverabilityType?: string; recoverablePercentage?: string; exemptionReasonCode?: string;
      description?: string; invoiceReferenceText?: string; entity?: string; pretty?: boolean;
    }) => {
      const body = taxCodeMutationBody(opts);
      const result = await api('PATCH', `/tax/client-codes/${encodeURIComponent(id)}`, body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });
  
  taxCodes
    .command('delete <id>')
    .description('Delete a client tax code')
    .option('--entity <entityId>', 'Entity the code belongs to (required for account-scoped keys)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('DELETE', `/tax/client-codes/${encodeURIComponent(id)}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });
  
  // GET /v1/tax/codes — the full canonical catalogue (Clearvo's own
  // system_enum/fact content plus this entity's own client tax codes, same
  // rows as `tax-codes list` in the same shape). Use to validate a
  // clientTaxCode/taxTreatment value before `clearvo send`, or to build a
  // picker.
  taxCodes
    .command('search')
    .description('List/search the full canonical tax-code catalogue (Clearvo content + your client tax codes)')
    .option('--code <code>', 'Substring match against `code`, case-insensitive')
    .option('--vocabulary <vocabulary>', 'system_enum, fact, client, or tax_calc — omit to list every vocabulary')
    .option('--country <code>', 'ISO 3166-1 alpha-2 — narrows to this country\'s rows')
    .option('--source-system <system>', 'e.g. xero — narrows to one connector\'s system_enum rows; never matches a client row')
    .option('--date <date>', 'YYYY-MM-DD — resolves each row\'s live rate as of this date. Defaults to now')
    .option('--entity <entityId>', 'Entity ID to scope `client` vocabulary rows to (required for account-scoped keys)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { code?: string; vocabulary?: string; country?: string; sourceSystem?: string; date?: string; entity?: string; pretty?: boolean }) => {
      const qs = new URLSearchParams();
      if (opts.code)         qs.set('code', opts.code);
      if (opts.vocabulary)   qs.set('vocabulary', opts.vocabulary);
      if (opts.country)      qs.set('country', opts.country.toUpperCase());
      if (opts.sourceSystem) qs.set('sourceSystem', opts.sourceSystem);
      if (opts.date)         qs.set('date', opts.date);
      const q = qs.toString();
      const result = await api('GET', `/tax/codes${q ? `?${q}` : ''}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // GET /v1/tax/client-codes/options — valid field combinations for `tax-codes
  // create`/`tax-codes update`. Call this before guessing an enum value — the
  // same source of truth the dashboard's own form uses.
  taxCodes
    .command('options')
    .description('Discover valid movement/rateBand/supplyType values for `tax-codes create`/`update`')
    .option('--country <code>', 'ISO 3166-1 alpha-2 or alpha-3 (e.g. DE). Omit for the unfiltered global option set')
    .option('--region <region>', 'Sub-country scope (e.g. a US state) — refines rateBands\' resolved rate percentages. Only meaningful alongside --country')
    .option('--direction <direction>', 'sale or purchase — further narrows movements')
    .option('--entity <entityId>', 'Entity ID (required for account-scoped keys)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { country?: string; region?: string; direction?: string; entity?: string; pretty?: boolean }) => {
      const qs = new URLSearchParams();
      if (opts.country)   qs.set('country', opts.country.toUpperCase());
      if (opts.region)    qs.set('region', opts.region.toUpperCase());
      if (opts.direction) qs.set('direction', opts.direction);
      const q = qs.toString();
      const result = await api('GET', `/tax/client-codes/options${q ? `?${q}` : ''}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // GET /v1/tax/client-codes/exemption-reasons — candidate exemptionReasonCode
  // values for an in-progress (not yet saved) client tax code.
  taxCodes
    .command('exemption-reasons')
    .description('Candidate exemptionReasonCode values for an in-progress client tax code (call `tax-codes options` first)')
    .option('--country <code>', 'ISO 3166-1 alpha-2 or alpha-3')
    .option('--movement <movement>', 'local, intra_community, export, distance_sale, import, or own_goods_movement')
    .option('--taxability <taxability>', 'taxable, exempt, or out_of_scope')
    .option('--reverse-charge <bool>', 'true or false')
    .option('--supply-type <type>', 'goods, digital_service, or general_service')
    .option('--customer-type <type>', 'b2b or b2c')
    .option('--rate-band <band>', 'standard, middle, reduced, super_reduced, special, or zero')
    .option('--direction <direction>', 'sale or purchase')
    .option('--entity <entityId>', 'Entity ID (required for account-scoped keys)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: {
      country?: string; movement?: string; taxability?: string; reverseCharge?: string;
      supplyType?: string; customerType?: string; rateBand?: string; direction?: string;
      entity?: string; pretty?: boolean;
    }) => {
      const qs = new URLSearchParams();
      if (opts.country)       qs.set('country', opts.country.toUpperCase());
      if (opts.movement)      qs.set('movement', opts.movement);
      if (opts.taxability)    qs.set('taxability', opts.taxability);
      if (opts.reverseCharge) qs.set('reverseCharge', opts.reverseCharge);
      if (opts.supplyType)    qs.set('supplyType', opts.supplyType);
      if (opts.customerType)  qs.set('customerType', opts.customerType);
      if (opts.rateBand)      qs.set('rateBand', opts.rateBand);
      if (opts.direction)     qs.set('direction', opts.direction);
      const q = qs.toString();
      const result = await api('GET', `/tax/client-codes/exemption-reasons${q ? `?${q}` : ''}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo mandate-transactions ─────────────────────────────────────────────
  // Consolidated cross-jurisdiction transaction view — one row per resolved
  // (or in-progress) mandate decision. `--state held` is the direct answer to
  // "which transactions reference a client tax code that does not exist" —
  // inspect holdReason/actionOwner on each row.
  program
    .command('mandate-transactions')
    .description('Query the consolidated cross-jurisdiction transaction view')
    .option('--upload-batch-id <id>', 'Every row a specific bulk upload produced')
    .option('--state <state>', 'PENDING, RESOLVED, NEEDS_INFO, HELD, OPEN, CLOSED, SUBMITTED, FILED, or CLEARED (case-insensitive) — see the API docs for the full raw-state vocabulary')
    .option('--mandate <mandate>', 'Exact match, e.g. FR_EINVOICING, FR_EREPORTING, ES_SII, NONE')
    .option('--period <period>', 'Exact match against the reporting period key, e.g. 2026-09-D1')
    .option('--country <code>', 'ISO 3166-1 alpha-2')
    .option('--from <date>', 'YYYY-MM-DD — issue_date >= this date')
    .option('--to <date>', 'YYYY-MM-DD — issue_date <= this date')
    .option('--page <page>', 'Page number, 1-based')
    .option('--limit <limit>', 'Results per page, 1-200')
    .option('--entity <entityId>', 'Entity ID (required for account-scoped keys)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: {
      uploadBatchId?: string; state?: string; mandate?: string; period?: string; country?: string;
      from?: string; to?: string; page?: string; limit?: string; entity?: string; pretty?: boolean;
    }) => {
      const qs = new URLSearchParams();
      if (opts.uploadBatchId) qs.set('uploadBatchId', opts.uploadBatchId);
      if (opts.state)         qs.set('state', opts.state);
      if (opts.mandate)       qs.set('mandate', opts.mandate);
      if (opts.period)        qs.set('period', opts.period);
      if (opts.country)       qs.set('country', opts.country.toUpperCase());
      if (opts.from)          qs.set('from', opts.from);
      if (opts.to)            qs.set('to', opts.to);
      if (opts.page)          qs.set('page', opts.page);
      if (opts.limit)         qs.set('limit', opts.limit);
      if (opts.entity)        qs.set('entityId', opts.entity);
      const q = qs.toString();
      // entityId is forwarded BOTH ways: as x-entity-id so the backend can resolve entity
      // context for an account-scoped key at all, and as a query param, which the route
      // separately reads as its own secondary filter (same convention as GET /v1/invoices).
      const result = await api('GET', `/mandate-transactions${q ? `?${q}` : ''}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo calculations ─────────────────────────────────────────────────────
  const calculations = program.command('calculations').description('View committed tax calculation history');
  
  calculations
    .command('list')
    .description('List committed tax calculations')
    .option('--entity <entityId>', 'Filter by entity ID')
    .option('--country <code>', 'Filter by jurisdiction country (e.g. DE, US)')
    .option('--stage <stage>', 'Filter by document stage: invoice or purchase_order (default: both). purchase_order is Enterprise only (Purchases (AP))')
    .option('--direction <sale|purchase>', 'Filter by transaction direction (default: both). purchase is Enterprise only (Purchases (AP))')
    .option('--po <purchaseOrderId>', 'Exact purchase-order reference: the PO itself plus every calculation linked to it')
    .option('--limit <n>', 'Results per page', '25')
    .option('--page <n>', 'Page number', '1')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { entity?: string; country?: string; stage?: string; direction?: string; po?: string; limit: string; page: string; pretty?: boolean }) => {
      const qs = new URLSearchParams({ limit: opts.limit, page: opts.page });
      if (opts.entity)  qs.set('entityId', opts.entity);
      if (opts.country) qs.set('country',  opts.country);
      if (opts.stage)   qs.set('documentStage', opts.stage);
      if (opts.direction) qs.set('direction', opts.direction);
      if (opts.po)      qs.set('purchaseOrderId', opts.po);
      const result = await api('GET', `/tax/calculate?${qs}`);
      print(result, !!opts.pretty);
    });
  
  calculations
    .command('requests')
    .description('List the calculation request ledger: every calculation request incl. commit=false quotes and rejections, with quote-to-final links')
    .option('--committed <bool>', 'true = committed only, false = quotes only')
    .option('--differs', 'Only committed calculations whose result differs from the linked quote')
    .option('--outcome <outcome>', 'ok | degraded | rejected | replayed')
    .option('--min-status <code>', 'Only rows with HTTP status >= this (e.g. 400)')
    .option('--endpoint <endpoint>', 'tax_calculate | tax_calculate_partner | csv_import | integration | dashboard')
    .option('--key <keyId>', 'Filter by API key id')
    .option('--from <iso>', 'ISO 8601 start (inclusive)')
    .option('--to <iso>', 'ISO 8601 end (exclusive)')
    .option('--summary <by>', 'key | entity: per-group counts instead of rows')
    .option('--limit <n>', 'Rows per page', '50')
    .option('--cursor <cursor>', 'nextCursor from the previous page')
    .option('--entity <entityId>', 'Entity (organisation keys)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { committed?: string; differs?: boolean; outcome?: string; minStatus?: string; endpoint?: string; key?: string; from?: string; to?: string; summary?: string; limit: string; cursor?: string; entity?: string; pretty?: boolean }) => {
      const qs = new URLSearchParams({ limit: opts.limit });
      if (opts.committed !== undefined) qs.set('committed', opts.committed);
      if (opts.differs)   qs.set('differsFromQuote', 'true');
      if (opts.outcome)   qs.set('outcome', opts.outcome);
      if (opts.minStatus) qs.set('minStatus', opts.minStatus);
      if (opts.endpoint)  qs.set('endpoint', opts.endpoint);
      if (opts.key)       qs.set('keyId', opts.key);
      if (opts.from)      qs.set('from', opts.from);
      if (opts.to)        qs.set('to', opts.to);
      if (opts.summary)   qs.set('summary', opts.summary);
      if (opts.cursor)    qs.set('cursor', opts.cursor);
      const result = await api('GET', `/tax/calculation-ledger?${qs}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo query ────────────────────────────────────────────────────────────
  // Ad-hoc filtered/paginated query over einvoicing_records or tax_calculations —
  // the same engine behind the dashboard's "Explore" page. Run `query fields`
  // first to see the allowlisted fields/operators/enums for a dataset.
  const query = program.command('query').description('Filtered, paginated query over einvoicing_records, tax_calculations or tax_calculation_line_items');
  
  function parseFilterOption(raw: string): { field: string; operator: string; value?: string; values?: string[] } {
    const [field, operator, ...rest] = raw.split(':');
    if (!field || !operator || rest.length === 0) {
      console.error(`Error: --filter must be "field:operator:value", got "${raw}"`);
      process.exit(1);
    }
    const rawValue = rest.join(':');
    if (operator === 'in' || operator === 'between') {
      return { field, operator, values: rawValue.split(',') };
    }
    return { field, operator, value: rawValue };
  }
  
  query
    .command('fields <dataset>')
    .description('List the allowlisted fields, operators, enum values, and limits for a dataset (einvoicing_records | tax_calculations | tax_calculation_line_items)')
    .option('--compact', 'Reference enums of more than 25 values (countries, tax codes) as a count and sample instead of listing them')
    .option('--field <field>', 'Show only this field, with its complete enum list')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (dataset: string, opts: { compact?: boolean; field?: string; pretty?: boolean }) => {
      const qs = new URLSearchParams({ dataset });
      if (opts.compact) qs.set('compact', 'true');
      if (opts.field) qs.set('field', opts.field);
      const result = await api('GET', `/query/fields?${qs}`) as { datasets: Record<string, unknown> };
      print(result.datasets?.[dataset] ?? result, !!opts.pretty);
    });
  
  query
    .command('run')
    .description('Run a filtered, paginated query. Use "query fields <dataset>" to see valid --filter field:operator:value combinations. Read access is enough.')
    .requiredOption('--dataset <dataset>', 'einvoicing_records | tax_calculations | tax_calculation_line_items')
    .option('--filter <field:operator:value>', 'Repeatable. operator is one of eq|ne|gt|lt|between|in|contains|isNull ("in" and "between" take comma-separated values; e.g. apOutcome:in:OVERCHARGED,HELD)', (val: string, prev: string[]) => [...prev, val], [] as string[])
    .option('--columns <fields>', 'Comma-separated allowlisted field names to return (default: dataset defaults)')
    .option('--limit <n>', 'Rows per page (default 25, max 100)')
    .option('--from <date>', 'Inclusive lower bound on the dataset\'s canonical timestamp field')
    .option('--to <date>', 'Inclusive upper bound on the dataset\'s canonical timestamp field')
    .option('--cursor <token>', 'nextCursor from a previous run, to fetch the next page of the same query')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { dataset: string; filter: string[]; columns?: string; limit?: string; from?: string; to?: string; cursor?: string; pretty?: boolean }) => {
      const filters = opts.filter.map(parseFilterOption);
      const body: Record<string, unknown> = { dataset: opts.dataset, filters };
      if (opts.columns) body.columns = opts.columns.split(',');
      if (opts.limit)   body.limit = Number(opts.limit);
      if (opts.from)    body.from = opts.from;
      if (opts.to)      body.to = opts.to;
      if (opts.cursor)  body.cursor = opts.cursor;
      const result = await api('POST', '/query', body);
      print(result, !!opts.pretty);
    });

  // ── clearvo rules (B7 propagation, docs/features/rules-engine/discovery.md) ──
  // CLI twins of every /v1/rules-engine/* operation. Scope (Entity vs
  // Organisation) is always derived server-side from the API key.

  function parseJsonOption(flag: string, raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      console.error(`Error: ${flag} must be valid JSON`);
      process.exit(1);
    }
  }

  const rules = program.command('rules').description('Manage rules-engine rules — schema, CRUD, activate/move/simulate, versions, trace, platform changes');

  rules
    .command('schema')
    .description('Describe the rules-engine\'s own vocabulary (domains, recordTypes, ruleKinds, operators, functions, the property catalog) — call before authoring any rule')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { pretty?: boolean }) => {
      const result = await api('GET', '/rules-engine/schema');
      print(result, !!opts.pretty);
    });

  rules
    .command('list')
    .description('List this key\'s own rules — never the wider "effective set" a Global row would also contribute at evaluation time')
    .option('--domain <domain>', 'Deprecated — prefer --direction. ap or ar')
    .option('--record-type <type>', 'Deprecated. calculation, purchase_order, or invoice')
    .option('--direction <direction>', 'purchase or sale — inclusive of direction-less rows, which apply to both')
    .option('--condition-property <property>', 'Only rules with a condition on this catalog property')
    .option('--condition-value <value>', 'Combined with --condition-property — narrows to a condition whose value equals this')
    .option('--include-defaults', 'Also return this scope\'s Global platform-default rules as defaults[]/defaultsCount (e.g. to find one worth `rules suppress`-ing)')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--company-code <code>', 'Only rules scoped to this company code (case-insensitive)')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: {
      domain?: string; recordType?: string; direction?: string; conditionProperty?: string; conditionValue?: string;
      includeDefaults?: boolean; companyCode?: string; entity?: string; pretty?: boolean;
    }) => {
      const qs = new URLSearchParams();
      if (opts.domain) qs.set('domain', opts.domain);
      if (opts.recordType) qs.set('recordType', opts.recordType);
      if (opts.direction) qs.set('direction', opts.direction);
      if (opts.conditionProperty) qs.set('conditionProperty', opts.conditionProperty);
      if (opts.conditionValue) qs.set('conditionValue', opts.conditionValue);
      if (opts.includeDefaults) qs.set('includeDefaults', '1');
      if (opts.companyCode) qs.set('companyCode', opts.companyCode);
      const q = qs.toString();
      const result = await api('GET', `/rules-engine/rules${q ? `?${q}` : ''}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  rules
    .command('get <id>')
    .description('Read one rule by id, within this key\'s own scope')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('GET', `/rules-engine/rules/${encodeURIComponent(id)}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  rules
    .command('create')
    .description('Create a rule — always starts DRAFT (call `rules activate` separately to make it fire). --conditions/--actions are JSON arrays — call `rules schema` first for the allowed property/operator/fn vocabulary')
    .requiredOption('--domain <domain>', 'ap or ar')
    .option('--record-type <type>', 'calculation, purchase_order, or invoice — default calculation')
    .requiredOption('--rule-kind <kind>', 'NORMALIZATION, ENRICHMENT, ADJUSTMENT, WARNING, or ERROR')
    .requiredOption('--code <code>', 'Letters, numbers, underscore, dot, hyphen only. Unique per (domain, recordType, scope) — re-creating the same code+scope with a byte-identical body returns the existing rule, not an error')
    .requiredOption('--name <name>', 'Rule name')
    .option('--description <text>', 'Rule description')
    .option('--legal-basis-tag <tag>', 'LEGAL_MANDATE or BUSINESS_POLICY — default BUSINESS_POLICY')
    .option('--sort-order <n>', 'Evaluation order within this ruleKind')
    .option('--clearance-status <status>', 'What a matched ERROR rule makes of the document: REJECTED (default), NEEDS_INFO (accepted, flagged for the sender to complete) or EXCLUDED (skipped: recorded, nothing submitted). Only for --rule-kind ERROR')
    .option('--conditions <json>', 'JSON array, ANDed at the top level: each element is {property, operator, value?} or a group {any: [...]} / {all: [...]} (max 50 leaves, 2 levels deep). Omit or [] to always match', '[]')
    .option('--company-code <code>', 'Scope the rule to one of the entity\'s active company codes (Enterprise). Omit for an entity-wide rule')
    .option('--actions <json>', 'JSON array of {property, value} (literal) or {property, fn, args?} (function dispatch)', '[]')
    .option('--template-id <id>', 'Originating template id, if any')
    .option('--effective-from <iso>', 'ISO datetime')
    .option('--effective-to <iso>', 'ISO datetime')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: {
      domain: string; recordType?: string; ruleKind: string; code: string; name: string; description?: string;
      legalBasisTag?: string; sortOrder?: string; clearanceStatus?: string; conditions: string; actions: string; templateId?: string;
      effectiveFrom?: string; effectiveTo?: string; companyCode?: string; entity?: string; pretty?: boolean;
    }) => {
      const body: Record<string, unknown> = {
        domain: opts.domain, ruleKind: opts.ruleKind, code: opts.code, name: opts.name,
        conditions: parseJsonOption('--conditions', opts.conditions),
        actions: parseJsonOption('--actions', opts.actions),
      };
      if (opts.recordType) body.recordType = opts.recordType;
      if (opts.description) body.description = opts.description;
      if (opts.legalBasisTag) body.legalBasisTag = opts.legalBasisTag;
      if (opts.sortOrder) body.sortOrder = Number(opts.sortOrder);
      if (opts.clearanceStatus) body.clearanceStatus = opts.clearanceStatus;
      if (opts.templateId) body.templateId = opts.templateId;
      if (opts.effectiveFrom) body.effectiveFrom = opts.effectiveFrom;
      if (opts.effectiveTo) body.effectiveTo = opts.effectiveTo;
      if (opts.companyCode) body.companyCode = opts.companyCode;
      const result = await api('POST', '/rules-engine/rules', body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  rules
    .command('update <id>')
    .description('Edit a rule. --version (optimistic concurrency — read it from `rules get`/`rules list` first) is REQUIRED')
    .requiredOption('--version <n>', 'Current version — a stale version returns 409 with the current one so you can reload and retry')
    .option('--name <name>')
    .option('--description <text>')
    .option('--legal-basis-tag <tag>', 'LEGAL_MANDATE or BUSINESS_POLICY')
    .option('--sort-order <n>')
    .option('--clearance-status <status>', 'What a matched ERROR rule makes of the document: REJECTED (default), NEEDS_INFO (accepted, flagged for the sender to complete) or EXCLUDED (skipped: recorded, nothing submitted). Only for an ERROR rule')
    .option('--conditions <json>', 'JSON array replacing the rule\'s own conditions (leaves or {any|all: [...]} groups)')
    .option('--company-code <code>', 'Re-scope to another active company code')
    .option('--entity-wide', 'Make the rule entity-wide again (company code null)')
    .option('--actions <json>', 'JSON array replacing the rule\'s own actions')
    .option('--effective-from <iso>')
    .option('--effective-to <iso>')
    .option('--enabled', 'Set enabled=true')
    .option('--disabled', 'Set enabled=false')
    .option('--archive', 'Set status=ARCHIVED — a one-way, terminal retirement; there is no DELETE. Reaching ACTIVE is only ever done via `rules activate`')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: {
      version: string; name?: string; description?: string; legalBasisTag?: string; sortOrder?: string; clearanceStatus?: string;
      conditions?: string; actions?: string; effectiveFrom?: string; effectiveTo?: string;
      companyCode?: string; entityWide?: boolean;
      enabled?: boolean; disabled?: boolean; archive?: boolean; entity?: string; pretty?: boolean;
    }) => {
      const body: Record<string, unknown> = { version: Number(opts.version) };
      if (opts.name) body.name = opts.name;
      if (opts.description) body.description = opts.description;
      if (opts.legalBasisTag) body.legalBasisTag = opts.legalBasisTag;
      if (opts.sortOrder) body.sortOrder = Number(opts.sortOrder);
      if (opts.clearanceStatus) body.clearanceStatus = opts.clearanceStatus;
      if (opts.conditions) body.conditions = parseJsonOption('--conditions', opts.conditions);
      if (opts.actions) body.actions = parseJsonOption('--actions', opts.actions);
      if (opts.effectiveFrom) body.effectiveFrom = opts.effectiveFrom;
      if (opts.effectiveTo) body.effectiveTo = opts.effectiveTo;
      if (opts.companyCode) body.companyCode = opts.companyCode;
      if (opts.entityWide) body.companyCode = null;
      if (opts.enabled) body.enabled = true;
      if (opts.disabled) body.enabled = false;
      if (opts.archive) body.status = 'ARCHIVED';
      const result = await api('PATCH', `/rules-engine/rules/${encodeURIComponent(id)}`, body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  rules
    .command('activate <id>')
    .description('Move a DRAFT rule to ACTIVE — the only path there. Idempotent if already ACTIVE; 409 if ARCHIVED')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('POST', `/rules-engine/rules/${encodeURIComponent(id)}/activate`, {}, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  rules
    .command('move <id>')
    .description('Reorder a rule within its own ruleKind by setting a new sortOrder')
    .requiredOption('--sort-order <n>', 'New sort order')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { sortOrder: string; entity?: string; pretty?: boolean }) => {
      const result = await api('POST', `/rules-engine/rules/${encodeURIComponent(id)}/move`, { sortOrder: Number(opts.sortOrder) }, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  rules
    .command('suppress <id>')
    .description('Opt this key\'s own scope out of a wider-scope platform-default (is_system) rule — the default keeps firing for every other scope. Find the id via `rules list --include-defaults`')
    .option('--reason <text>', 'Optional free-text note on why this scope opted out (1-2000 chars)')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { reason?: string; entity?: string; pretty?: boolean }) => {
      const body: Record<string, unknown> = {};
      if (opts.reason) body.reason = opts.reason;
      const result = await api('POST', `/rules-engine/rules/${encodeURIComponent(id)}/suppress`, body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  rules
    .command('unsuppress <id>')
    .description('Remove this key\'s own scope\'s suppression of a platform-default rule, if one exists — the default resumes firing for this scope. 404 if no active suppression exists')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('DELETE', `/rules-engine/rules/${encodeURIComponent(id)}/suppress`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  rules
    .command('versions <id>')
    .description('List a rule\'s own rules_versions history, newest first')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('GET', `/rules-engine/rules/${encodeURIComponent(id)}/versions`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  rules
    .command('simulate [id]')
    .description('Preview a rule over recent records (read-only, no write) BEFORE activating it. Pass an existing rule id, or omit it and pass --draft alone to preview a rule that does not exist yet')
    .option('--sample-size <n>', 'How many of the most recent records to sample against (1-500, default 50)')
    .option('--draft <json>', 'Required when id is omitted; optional override (domain/recordType/ruleKind/conditions/actions) when id is present')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string | undefined, opts: { sampleSize?: string; draft?: string; entity?: string; pretty?: boolean }) => {
      if (!id && !opts.draft) {
        console.error('Error: pass an existing rule id, or --draft when previewing a rule that does not exist yet');
        process.exit(1);
      }
      const body: Record<string, unknown> = {};
      if (opts.sampleSize) body.sampleSize = Number(opts.sampleSize);
      if (opts.draft) body.draft = parseJsonOption('--draft', opts.draft);
      const path = id ? `/rules-engine/rules/${encodeURIComponent(id)}/simulate` : '/rules-engine/rules/simulate';
      const result = await api('POST', path, body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  rules
    .command('trace')
    .description('B6 — the full rules-engine execution trace for one already-calculated record, in firing order. Never plan-gated')
    .requiredOption('--record-type <type>', 'calculation, purchase_order, or invoice')
    .requiredOption('--record-id <id>', 'The tax_calculations/einvoicing_records id (or purchase-order record id) to trace')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { recordType: string; recordId: string; entity?: string; pretty?: boolean }) => {
      const qs = new URLSearchParams({ recordType: opts.recordType, recordId: opts.recordId });
      const result = await api('GET', `/rules-engine/trace?${qs.toString()}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  rules
    .command('platform-changes')
    .description('B6 — recent Global/Tenant rule changes that apply to this key\'s calculations. Visible even before a change\'s own effectiveFrom date')
    .option('--limit <n>', 'Max rows to return (default 50, max 200)')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { limit?: string; entity?: string; pretty?: boolean }) => {
      const qs = opts.limit ? `?${new URLSearchParams({ limit: opts.limit }).toString()}` : '';
      const result = await api('GET', `/rules-engine/platform-changes${qs}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo rules properties ──────────────────────────────────────────────
  const ruleProperties = rules.command('properties').description('Custom rule-property definitions (customProperties.<key>) for data that is not in the platform schema; built-in fields such as glAccount are regular fields, not custom ones');

  ruleProperties
    .command('list')
    .description('List the custom property definitions of this key\'s own scope. Built-in fields (glAccount, costCenter, intendedUse, accountAssignment, commodityCode, ...) are not custom properties; `clearvo rules schema` lists them')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('GET', '/rules-engine/properties', undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  ruleProperties
    .command('create')
    .description('Define a new custom property, referenced by rules as "customProperties.<propertyKey>". 409 if propertyKey already exists at this scope')
    .requiredOption('--property-key <key>', 'Must start with a letter; letters/numbers/underscore only')
    .requiredOption('--label <label>')
    .requiredOption('--data-type <type>', 'string, number, or boolean')
    .option('--applies-to <target>', 'line or header — default line')
    .option('--not-writable', 'Mark a derived-output fact no rule action may ever target (default writable)')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { propertyKey: string; label: string; dataType: string; appliesTo?: string; notWritable?: boolean; entity?: string; pretty?: boolean }) => {
      const body: Record<string, unknown> = { propertyKey: opts.propertyKey, label: opts.label, dataType: opts.dataType };
      if (opts.appliesTo) body.appliesTo = opts.appliesTo;
      if (opts.notWritable) body.isWritable = false;
      const result = await api('POST', '/rules-engine/properties', body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo rules templates ───────────────────────────────────────────────
  const ruleTemplates = rules.command('templates').description('Starter rule templates');

  ruleTemplates
    .command('list')
    .description('List starter rule templates visible to this key')
    .option('--domain <domain>', 'ap or ar')
    .option('--record-type <type>', 'calculation, purchase_order, or invoice')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { domain?: string; recordType?: string; entity?: string; pretty?: boolean }) => {
      const qs = new URLSearchParams();
      if (opts.domain) qs.set('domain', opts.domain);
      if (opts.recordType) qs.set('recordType', opts.recordType);
      const q = qs.toString();
      const result = await api('GET', `/rules-engine/templates${q ? `?${q}` : ''}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  ruleTemplates
    .command('get <id>')
    .description('Read one template\'s full detail, including its paramsSchema — the exact params `templates instantiate` expects')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('GET', `/rules-engine/templates/${encodeURIComponent(id)}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  ruleTemplates
    .command('instantiate <id>')
    .description('Turn a template into a real rule (always DRAFT) — call `templates get` first to see the exact params expected')
    .requiredOption('--params <json>', 'JSON object keyed by the template\'s own paramsSchema field names')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { params: string; entity?: string; pretty?: boolean }) => {
      const result = await api('PUT', `/rules-engine/templates/${encodeURIComponent(id)}`, { params: parseJsonOption('--params', opts.params) }, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo rules datasets ────────────────────────────────────────────────
  const ruleDatasets = rules.command('datasets').description('Reference datasets ("vlookups")');

  ruleDatasets
    .command('list')
    .description('This key\'s own scope tuple\'s reference datasets')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('GET', '/rules-engine/datasets', undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  ruleDatasets
    .command('create')
    .description('Create a reference dataset')
    .requiredOption('--dataset-key <key>')
    .requiredOption('--name <name>')
    .requiredOption('--key-columns <csv>', 'Comma-separated column names forming this dataset\'s composite key (1-10), e.g. "glAccount,country"')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { datasetKey: string; name: string; keyColumns: string; entity?: string; pretty?: boolean }) => {
      const body = { datasetKey: opts.datasetKey, name: opts.name, keyColumns: opts.keyColumns.split(',').map(s => s.trim()) };
      const result = await api('POST', '/rules-engine/datasets', body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  ruleDatasets
    .command('get <id>')
    .description('One dataset\'s own metadata (keyColumns, rowCount)')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('GET', `/rules-engine/datasets/${encodeURIComponent(id)}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  ruleDatasets
    .command('export <id>')
    .description('Raw CSV export of a dataset\'s rows — printed as text, not JSON')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .action(async (id: string, opts: { entity?: string }) => {
      // Not routed through api() — that helper always parses the response as JSON, and this
      // route responds text/csv (same reason the hosted MCP connector never exposes an
      // export_rules_engine_dataset tool at all — see this file's own `rules` header comment).
      const res = await fetch(`${getBaseUrl()}/rules-engine/datasets/${encodeURIComponent(id)}/export`, {
        method: 'GET',
        headers: { 'x-api-key': getApiKey(), ...(opts.entity ? { 'x-entity-id': opts.entity } : {}) },
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(`HTTP ${res.status}: ${text}`);
        process.exit(1);
      }
      console.log(text);
    });

  ruleDatasets
    .command('import <id>')
    .description('Two-phase CSV import from a file. dryRun (default) computes and returns {adds,changes,deletes} without writing anything; pass --apply to write that same diff (recomputed fresh, never a stale snapshot)')
    .requiredOption('--file <path>', 'Path to a CSV file — header row + data rows')
    .option('--apply', 'Actually write the diff (default: dry-run only)')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { file: string; apply?: boolean; entity?: string; pretty?: boolean }) => {
      const csv = readFileSync(opts.file, 'utf8');
      const body = { csv, dryRun: !opts.apply };
      const result = await api('POST', `/rules-engine/datasets/${encodeURIComponent(id)}/import`, body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  const ruleDatasetRows = ruleDatasets.command('rows').description('A dataset\'s own rows');

  ruleDatasetRows
    .command('list <id>')
    .description('A page of a dataset\'s rows')
    .option('--page <n>', 'Default 1')
    .option('--limit <n>', 'Default 50, max 500')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { page?: string; limit?: string; entity?: string; pretty?: boolean }) => {
      const qs = new URLSearchParams();
      if (opts.page) qs.set('page', opts.page);
      if (opts.limit) qs.set('limit', opts.limit);
      const q = qs.toString();
      const result = await api('GET', `/rules-engine/datasets/${encodeURIComponent(id)}/rows${q ? `?${q}` : ''}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  ruleDatasetRows
    .command('upsert <id>')
    .description('Upsert one row by the dataset\'s own key_columns (never a separate row id — the composite key IS the identity)')
    .requiredOption('--row-data <json>', 'JSON object — must include a value for every one of the dataset\'s own key_columns')
    .option('--source <text>', 'Citation — required for a Global row')
    .option('--verified', 'Mark this row verified')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { rowData: string; source?: string; verified?: boolean; entity?: string; pretty?: boolean }) => {
      const body: Record<string, unknown> = { rowData: parseJsonOption('--row-data', opts.rowData) };
      if (opts.source) body.source = opts.source;
      if (opts.verified) body.verified = true;
      const result = await api('POST', `/rules-engine/datasets/${encodeURIComponent(id)}/rows`, body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  ruleDatasetRows
    .command('delete <id> <rowKey>')
    .description('Remove one row by its already-joined composite key string (each row\'s own rowKey, from `rows list`)')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, rowKey: string, opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('DELETE', `/rules-engine/datasets/${encodeURIComponent(id)}/rows/${encodeURIComponent(rowKey)}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo rules mappings ────────────────────────────────────────────────
  // Field mappings are inherently per-entity — entityId is required (directly, or via an entity-scoped key).
  const ruleMappings = rules.command('mappings').description('Field mappings — the mapping-config replacement for an integration\'s hand-written normalization');

  ruleMappings
    .command('list')
    .description('An entity\'s own field-mapping rows for one source system ("xero" or "coupa")')
    .requiredOption('--source-system <system>', 'e.g. "xero"')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { sourceSystem: string; entity?: string; pretty?: boolean }) => {
      const qs = new URLSearchParams({ sourceSystem: opts.sourceSystem });
      const result = await api('GET', `/rules-engine/mappings?${qs.toString()}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  ruleMappings
    .command('create')
    .description('Add one row to a source that maps a whole calculation request (today "coupa"): companyCode or a defined custom property')
    .requiredOption('--source-system <system>', 'e.g. "coupa"')
    .requiredOption('--field-path <path>', '"companyCode", "customProperties.<key>" or "lineItems[].customProperties.<key>"')
    .requiredOption('--source-path <path>', 'Dot path into the source payload; "a||b" tries a then b')
    .option('--transform <json>', 'JSON object {fn, args?}')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { sourceSystem: string; fieldPath: string; sourcePath: string; transform?: string; entity?: string; pretty?: boolean }) => {
      const body: Record<string, unknown> = { sourceSystem: opts.sourceSystem, fieldPath: opts.fieldPath, sourcePath: opts.sourcePath };
      if (opts.transform) body.transform = parseJsonOption('--transform', opts.transform);
      const result = await api('POST', '/rules-engine/mappings', body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  ruleMappings
    .command('get <id>')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('GET', `/rules-engine/mappings/${encodeURIComponent(id)}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  ruleMappings
    .command('update <id>')
    .description('Edit a field-mapping row, or retire it with --archive (the only status a PATCH may ever set). No optimistic-concurrency version on this resource')
    .option('--source-path <path>')
    .option('--transform <json>', 'JSON object {fn, args?}')
    .option('--enabled', 'Set enabled=true')
    .option('--disabled', 'Set enabled=false')
    .option('--sort-order <n>')
    .option('--archive', 'Set status=ARCHIVED')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { sourcePath?: string; transform?: string; enabled?: boolean; disabled?: boolean; sortOrder?: string; archive?: boolean; entity?: string; pretty?: boolean }) => {
      const body: Record<string, unknown> = {};
      if (opts.sourcePath) body.sourcePath = opts.sourcePath;
      if (opts.transform) body.transform = parseJsonOption('--transform', opts.transform);
      if (opts.enabled) body.enabled = true;
      if (opts.disabled) body.enabled = false;
      if (opts.sortOrder) body.sortOrder = Number(opts.sortOrder);
      if (opts.archive) body.status = 'ARCHIVED';
      const result = await api('PATCH', `/rules-engine/mappings/${encodeURIComponent(id)}`, body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  ruleMappings
    .command('reset')
    .description('Discard every one of this entity\'s own edits for one source system and re-instantiate fresh copies of the current Global starter template ("Reset to defaults")')
    .requiredOption('--source-system <system>', 'e.g. "xero"')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { sourceSystem: string; entity?: string; pretty?: boolean }) => {
      const qs = new URLSearchParams({ sourceSystem: opts.sourceSystem });
      const result = await api('POST', `/rules-engine/mappings/reset?${qs.toString()}`, {}, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo adjustments (AP manual adjustments, lib/ap/manual-adjustments.ts) ──
  // Propose/list/read-options only — there is no `adjustments confirm/revert/
  // reject` command: confirming is a dedicated, admin-only, dashboard-only action.
  const adjustments = program.command('adjustments').description('Propose/list manual adjustments against an already-calculated transaction');

  adjustments
    .command('propose <calculationId>')
    .description(
      'Propose a manual adjustment — always creates a DRAFT; there is no way to confirm one here (dashboard-admin-only, ' +
      'via a separate permission). FORCED_INPUT (default, preferred) re-runs the original calculation with genuine ' +
      'input facts pinned; POST_CALCULATION_OVERRIDE directly replaces result columns (requires --document-url). ' +
      'Run `adjustments options` first to see the exact allowed forcedInputs/overrides keys.'
    )
    .requiredOption('--mode <mode>', 'FORCED_INPUT or POST_CALCULATION_OVERRIDE')
    .requiredOption('--original-value <json>', 'JSON object — what the engine actually computed for the field(s) being changed, for audit comparison')
    .requiredOption('--reason <text>', 'Mandatory — why this adjustment is being made')
    .option('--forced-inputs <json>', 'FORCED_INPUT only — JSON object {property: value}')
    .option('--overrides <json>', 'POST_CALCULATION_OVERRIDE only — JSON object {column: value}')
    .option('--document-url <url>', 'Supporting document URL — effectively required for POST_CALCULATION_OVERRIDE')
    .option('--target-type <type>', 'tax_calculation, tax_calculation_line, or einvoicing_record — default tax_calculation')
    .option('--target-id <id>', 'Overrides calculationId as the actual target id')
    .option('--target-line-id <id>', 'Set for a line-level FORCED_INPUT adjustment')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (calculationId: string, opts: {
      mode: string; originalValue: string; reason: string; forcedInputs?: string; overrides?: string;
      documentUrl?: string; targetType?: string; targetId?: string; targetLineId?: string; entity?: string; pretty?: boolean;
    }) => {
      const body: Record<string, unknown> = {
        mode: opts.mode,
        originalValue: parseJsonOption('--original-value', opts.originalValue),
        reason: opts.reason,
      };
      if (opts.forcedInputs) body.forcedInputs = parseJsonOption('--forced-inputs', opts.forcedInputs);
      if (opts.overrides) body.overrides = parseJsonOption('--overrides', opts.overrides);
      if (opts.documentUrl) body.documentUrl = opts.documentUrl;
      if (opts.targetType) body.targetType = opts.targetType;
      if (opts.targetId) body.targetId = opts.targetId;
      if (opts.targetLineId) body.targetLineId = opts.targetLineId;
      const result = await api('POST', `/tax/calculate/${encodeURIComponent(calculationId)}/adjustments`, body, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  adjustments
    .command('list <calculationId>')
    .description('List manual adjustments proposed against a tax calculation, newest first')
    .option('--status <status>', 'DRAFT, CONFIRMED, REJECTED, or REVERTED')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (calculationId: string, opts: { status?: string; entity?: string; pretty?: boolean }) => {
      const qs = opts.status ? `?status=${encodeURIComponent(opts.status)}` : '';
      const result = await api('GET', `/tax/calculate/${encodeURIComponent(calculationId)}/adjustments${qs}`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  adjustments
    .command('options <calculationId>')
    .description('The backend-owned closed option lists for `adjustments propose` — modes, target types, and the exact set of catalog properties/columns a --forced-inputs/--overrides key may name')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (calculationId: string, opts: { entity?: string; pretty?: boolean }) => {
      const result = await api('GET', `/tax/calculate/${encodeURIComponent(calculationId)}/adjustment-options`, undefined, opts.entity ? { 'x-entity-id': opts.entity } : undefined);
      print(result, !!opts.pretty);
    });

  // ── clearvo filings ──────────────────────────────────────────────────────────
  // Tax filing for any country or scheme the filing service supports (US states are one example): setup (GET /filings/setups, GET|PUT /tax/registrations/{id}/filing), the return lifecycle
  // (/filings/*) and the data upload (/filings/upload/*). The key needs the `filings` product; changes need a write key.
  const filings = program.command('filings').description('Tax filing: set up, review and approve returns, upload your data');
  const entityHdr = (entity?: string): Record<string, string> | undefined => (entity ? { 'x-entity-id': entity } : undefined);
  const parseVersion = (v: string): number => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) {
      console.error('Error: --snapshot-version must be the filing\'s snapshotVersion (a whole number from `clearvo filings get`)');
      process.exit(1);
    }
    return n;
  };
  const writeOut = (out: string | undefined, data: Uint8Array | string, label: string) => {
    if (out) {
      writeFileSync(out, data);
      console.log(`Saved ${label} to ${out}`);
    } else if (typeof data === 'string') {
      process.stdout.write(data);
    } else {
      console.error(`Error: ${label} is a binary file — pass --out <file>`);
      process.exit(1);
    }
  };

  filings
    .command('list')
    .description('List your returns')
    .option('--view <view>', 'open (not yet filed, backdated included, soonest due first), upcoming (open go-forward returns), filed, or backdated (catch-up returns)')
    .option('--backdated <true|false>', 'true = only backdated returns, false = only returns that are not backdated (combined with --view)')
    .option('--status <status>', 'Only returns with this exact status')
    .option('--jurisdiction <id>', 'e.g. US_CA')
    .option('--limit <n>', '1 to 100 (default 25)')
    .option('--offset <n>', 'Skip this many returns')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { view?: string; backdated?: string; status?: string; jurisdiction?: string; limit?: string; offset?: string; entity?: string; pretty?: boolean }) => {
      const qs = new URLSearchParams();
      if (opts.view) qs.set('view', opts.view);
      if (opts.backdated) qs.set('backdated', opts.backdated);
      if (opts.status) qs.set('status', opts.status);
      if (opts.jurisdiction) qs.set('jurisdictionId', opts.jurisdiction);
      if (opts.limit) qs.set('limit', opts.limit);
      if (opts.offset) qs.set('offset', opts.offset);
      const q = qs.toString();
      print(await api('GET', `/filings${q ? `?${q}` : ''}`, undefined, entityHdr(opts.entity)), !!opts.pretty);
    });

  filings
    .command('get <id>')
    .description('One return with totals, lines by tax authority, scope notes and timeline; shows snapshotVersion and allowedActions')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { entity?: string; pretty?: boolean }) => {
      print(await api('GET', `/filings/${encodeURIComponent(id)}`, undefined, entityHdr(opts.entity)), !!opts.pretty);
    });

  filings
    .command('approve <id>')
    .description('Approve a return for submission to the tax authority. A stored return (fil_) needs --snapshot-version and can be undone until it is submitted; a live return (ret_) needs none and can never be undone or withdrawn')
    .option('--snapshot-version <n>', 'The return\'s current snapshotVersion (from `filings get`); a mismatch is 409 FILING_STALE. Not needed for a ret_ id')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { snapshotVersion?: string; entity?: string; pretty?: boolean }) => {
      if (opts.snapshotVersion === undefined && !id.startsWith('ret_')) {
        console.error('Error: --snapshot-version is required for a stored return (a whole number from `clearvo filings get`); only a live ret_ return needs none');
        process.exit(1);
      }
      const body = opts.snapshotVersion === undefined ? {} : { snapshotVersion: parseVersion(opts.snapshotVersion) };
      print(await api('POST', `/filings/${encodeURIComponent(id)}/approve`, body, entityHdr(opts.entity)), !!opts.pretty);
    });

  filings
    .command('document <id> <docId>')
    .description('Download a document of a live return (ret_ id); the ids are in `filings get` under documents')
    .requiredOption('--out <file>', 'Where to save the file')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .action(async (id: string, docId: string, opts: { out: string; entity?: string }) => {
      const res = await apiFile(`/filings/${encodeURIComponent(id)}/documents/${encodeURIComponent(docId)}`, entityHdr(opts.entity));
      writeOut(opts.out, new Uint8Array(await res.arrayBuffer()), 'the document');
    });

  filings
    .command('undo <id>')
    .description('Take an approval back to PENDING_APPROVAL (only before submission)')
    .requiredOption('--snapshot-version <n>', 'The return\'s current snapshotVersion (from `filings get`); a mismatch is 409 FILING_STALE')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { snapshotVersion: string; entity?: string; pretty?: boolean }) => {
      print(await api('POST', `/filings/${encodeURIComponent(id)}/undo`, { snapshotVersion: parseVersion(opts.snapshotVersion) }, entityHdr(opts.entity)), !!opts.pretty);
    });

  filings
    .command('pause <id>')
    .description('Pause a return so we do not finalise it before the pause ends (limited per year; the on-time filing commitment is lost while paused). A live return (ret_) can be paused once, for up to 10 days')
    .option('--snapshot-version <n>', 'The return\'s current snapshotVersion (from `filings get`); a mismatch is 409 FILING_STALE. Not needed for a ret_ id')
    .option('--end-date <yyyy-mm-dd>', 'Live return only: the last day of the pause, within pause.allowedEnd in `filings get`. Omit for the latest allowed day')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { snapshotVersion?: string; endDate?: string; entity?: string; pretty?: boolean }) => {
      if (opts.snapshotVersion === undefined && !id.startsWith('ret_')) {
        console.error('Error: --snapshot-version is required for a stored return (a whole number from `clearvo filings get`); only a live ret_ return needs none');
        process.exit(1);
      }
      if (opts.endDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(opts.endDate)) {
        console.error('Error: --end-date must be a date in the form yyyy-mm-dd');
        process.exit(1);
      }
      const body = { ...(opts.snapshotVersion === undefined ? {} : { snapshotVersion: parseVersion(opts.snapshotVersion) }), ...(opts.endDate === undefined ? {} : { endDate: opts.endDate }) };
      print(await api('POST', `/filings/${encodeURIComponent(id)}/pause`, body, entityHdr(opts.entity)), !!opts.pretty);
    });

  filings
    .command('resume <id>')
    .description('Resume a paused return. A live return (ret_) has its pause ended early and needs no version')
    .option('--snapshot-version <n>', 'The return\'s current snapshotVersion (from `filings get`); a mismatch is 409 FILING_STALE. Not needed for a ret_ id')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { snapshotVersion?: string; entity?: string; pretty?: boolean }) => {
      if (opts.snapshotVersion === undefined && !id.startsWith('ret_')) {
        console.error('Error: --snapshot-version is required for a stored return (a whole number from `clearvo filings get`); only a live ret_ return needs none');
        process.exit(1);
      }
      const body = opts.snapshotVersion === undefined ? {} : { snapshotVersion: parseVersion(opts.snapshotVersion) };
      print(await api('POST', `/filings/${encodeURIComponent(id)}/resume`, body, entityHdr(opts.entity)), !!opts.pretty);
    });

  filings
    .command('skip <id>')
    .description('Skip a return: it becomes NOT_FILED and is not filed (only before submission)')
    .requiredOption('--snapshot-version <n>', 'The return\'s current snapshotVersion')
    .requiredOption('--reason <text>', 'Why it is being skipped (up to 500 characters)')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { snapshotVersion: string; reason: string; entity?: string; pretty?: boolean }) => {
      print(await api('POST', `/filings/${encodeURIComponent(id)}/skip`, { snapshotVersion: parseVersion(opts.snapshotVersion), reason: opts.reason }, entityHdr(opts.entity)), !!opts.pretty);
    });

  filings
    .command('prepayment <id>')
    .description('Record an amount already paid for the period (only before approval)')
    .requiredOption('--snapshot-version <n>', 'The return\'s current snapshotVersion')
    .requiredOption('--amount <amount>', 'Amount already paid, zero or more, in the return\'s currency')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { snapshotVersion: string; amount: string; entity?: string; pretty?: boolean }) => {
      const amount = Number(opts.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        console.error('Error: --amount must be a number, zero or more');
        process.exit(1);
      }
      print(await api('POST', `/filings/${encodeURIComponent(id)}/prepayment`, { snapshotVersion: parseVersion(opts.snapshotVersion), amount }, entityHdr(opts.entity)), !!opts.pretty);
    });

  const filingChanges = filings.command('change-requests').description('Requests to change something on a return that cannot be edited directly');

  filingChanges
    .command('list <id>')
    .description('List the change requests already sent for a return')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { entity?: string; pretty?: boolean }) => {
      print(await api('GET', `/filings/${encodeURIComponent(id)}/change-requests`, undefined, entityHdr(opts.entity)), !!opts.pretty);
    });

  filingChanges
    .command('create <id>')
    .description('Ask Clearvo to change something on a return (the transactions in a return are frozen)')
    .requiredOption('--message <text>', 'What to change (up to 2000 characters)')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (id: string, opts: { message: string; entity?: string; pretty?: boolean }) => {
      print(await api('POST', `/filings/${encodeURIComponent(id)}/change-requests`, { message: opts.message }, entityHdr(opts.entity)), !!opts.pretty);
    });

  filings
    .command('csv <id>')
    .description('Download the summary by authority (CSV), or with --transactions the transaction lines frozen into the return')
    .option('--transactions', 'The transaction lines instead of the summary')
    .option('--out <file>', 'Write to a file instead of stdout')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .action(async (id: string, opts: { transactions?: boolean; out?: string; entity?: string }) => {
      const res = await apiFile(`/filings/${encodeURIComponent(id)}/${opts.transactions ? 'transactions.csv' : 'csv'}`, entityHdr(opts.entity));
      writeOut(opts.out, await res.text(), 'the CSV');
    });

  filings
    .command('proof <id>')
    .description('Download the proof-of-filing document (PDF, PNG or JPEG)')
    .requiredOption('--out <file>', 'File to write')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .action(async (id: string, opts: { out: string; entity?: string }) => {
      const res = await apiFile(`/filings/${encodeURIComponent(id)}/proof`, entityHdr(opts.entity));
      writeOut(opts.out, new Uint8Array(await res.arrayBuffer()), 'the proof of filing');
    });

  filings
    .command('bank-account')
    .description('The account the tax authority debits (last four digits only). Bank details are changed in the dashboard')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { entity?: string; pretty?: boolean }) => {
      print(await api('GET', '/filings/bank-account', undefined, entityHdr(opts.entity)), !!opts.pretty);
    });

  filings
    .command('sandbox-generate')
    .description('Sandbox keys only: build a return on demand for a registration whose filing frequency is set (a live key gets 409 SANDBOX_ONLY)')
    .requiredOption('--registration <id>', 'The registration id (from `registrations list`)')
    .option('--period <periodKey>', 'e.g. 2026-09 or 2026-Q3 (default: the most recent closed period)')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { registration: string; period?: string; entity?: string; pretty?: boolean }) => {
      const body: Record<string, string> = { registrationId: opts.registration };
      if (opts.period) body.periodKey = opts.period;
      print(await api('POST', '/filings/sandbox/generate', body, entityHdr(opts.entity)), !!opts.pretty);
    });

  // ── clearvo filings setup ──
  filings
    .command('setups')
    .description('Where filing setup stands for each registration, and the next step')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { entity?: string; pretty?: boolean }) => {
      print(await api('GET', '/filings/setups', undefined, entityHdr(opts.entity)), !!opts.pretty);
    });

  const filingSetup = filings.command('setup').description('The filing setup of one registration');

  filingSetup
    .command('get <registrationId>')
    .description('The full setup: frequencies the tax authority offers, start periods, bank requirement and whether it can start')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (registrationId: string, opts: { entity?: string; pretty?: boolean }) => {
      print(await api('GET', `/tax/registrations/${encodeURIComponent(registrationId)}/filing`, undefined, entityHdr(opts.entity)), !!opts.pretty);
    });

  filingSetup
    .command('request <registrationId>')
    .description('Request filing for a registration. Filing starts once Clearvo has completed onboarding. Without a subscription this is 402 plan_required')
    .requiredOption('--frequency <code>', 'A frequency code from `filings setup get` (frequencyOptions[].code), e.g. Monthly')
    .option('--attest', 'Confirm this is the filing frequency on your tax account (required)')
    .option('--start <choice>', 'asap (first available period, default) or later', 'asap')
    .option('--start-period <key>', 'Required with --start later: a key from startOptionsByFrequency[frequency].later, e.g. 2026-12')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (registrationId: string, opts: { frequency: string; attest?: boolean; start: string; startPeriod?: string; entity?: string; pretty?: boolean }) => {
      if (!opts.attest) {
        console.error('Error: pass --attest to confirm the frequency is the one on your tax account');
        process.exit(1);
      }
      if (opts.start !== 'asap' && opts.start !== 'later') {
        console.error('Error: --start must be asap or later');
        process.exit(1);
      }
      if (opts.start === 'later' && !opts.startPeriod) {
        console.error('Error: --start later needs --start-period <key>');
        process.exit(1);
      }
      const body: Record<string, unknown> = { frequencyCode: opts.frequency, frequencyAttested: true, startChoice: opts.start };
      if (opts.startPeriod) body.startPeriodKey = opts.startPeriod;
      print(await api('PUT', `/tax/registrations/${encodeURIComponent(registrationId)}/filing`, body, entityHdr(opts.entity)), !!opts.pretty);
    });

  filingSetup
    .command('defer <registrationId>')
    .description('Move the first filing period later, before it has been prepared')
    .requiredOption('--to <date>', 'The date (YYYY-MM-DD) filing should start from')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (registrationId: string, opts: { to: string; entity?: string; pretty?: boolean }) => {
      print(await api('PUT', `/tax/registrations/${encodeURIComponent(registrationId)}/filing`, { deferFirstPeriodTo: opts.to }, entityHdr(opts.entity)), !!opts.pretty);
    });

  filingSetup
    .command('stop <registrationId>')
    .description('Stop filing from the next period (the current period is still prepared)')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (registrationId: string, opts: { entity?: string; pretty?: boolean }) => {
      print(await api('PUT', `/tax/registrations/${encodeURIComponent(registrationId)}/filing`, { stop: true }, entityHdr(opts.entity)), !!opts.pretty);
    });

  // ── clearvo filings upload ──
  // Add your own transaction data to a filing month: one or several files per month, then confirm and process the month once.
  const upload = filings.command('upload').description('Add your own transaction data to a filing month (one or several files, then process once)');

  upload
    .command('months')
    .description('The months you can add data to, newest first, with their window state')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (opts: { entity?: string; pretty?: boolean }) => {
      print(await api('GET', '/filings/upload/months', undefined, entityHdr(opts.entity)), !!opts.pretty);
    });

  upload
    .command('month <month>')
    .description('One month (yyyy-MM): its files with counts, the window, canUpload/canConfirm and the declaration to accept')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (month: string, opts: { entity?: string; pretty?: boolean }) => {
      print(await api('GET', `/filings/upload/months/${encodeURIComponent(month)}`, undefined, entityHdr(opts.entity)), !!opts.pretty);
    });

  upload
    .command('add <month> <file>')
    .description('Add a data file (.csv, .xlsx or .xls, up to 25 MB) to a month. Run it again for each further file in the month')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (month: string, file: string, opts: { entity?: string; pretty?: boolean }) => {
      const name = basename(file);
      const lower = name.toLowerCase();
      if (!['.csv', '.xlsx', '.xls'].some((e) => lower.endsWith(e))) {
        console.error('Error: the file must be a .csv, .xlsx or .xls file');
        process.exit(1);
      }
      let bytes: Buffer;
      try {
        bytes = readFileSync(file);
      } catch {
        console.error(`Error: cannot read ${file}`);
        process.exit(1);
      }
      if (bytes.length === 0) {
        console.error('Error: the file is empty');
        process.exit(1);
      }
      if (bytes.length > 25 * 1024 * 1024) {
        console.error('Error: the file is larger than 25 MB');
        process.exit(1);
      }
      const type = lower.endsWith('.csv') ? 'text/csv' : lower.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.ms-excel';
      const form = new FormData();
      form.append('file', new Blob([bytes], { type }), name);
      print(await api('POST', `/filings/upload/months/${encodeURIComponent(month)}/files`, form, entityHdr(opts.entity)), !!opts.pretty);
    });

  upload
    .command('delete <month> <fileId>')
    .description('Remove a file you added while the month is open (the calculated file cannot be removed)')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (month: string, fileId: string, opts: { entity?: string; pretty?: boolean }) => {
      print(await api('DELETE', `/filings/upload/months/${encodeURIComponent(month)}/files/${encodeURIComponent(fileId)}`, undefined, entityHdr(opts.entity)), !!opts.pretty);
    });

  upload
    .command('process <month>')
    .description('Confirm that all data for the month is added and process it once (refused while any file has errors: fix or remove it first). Read the declaration first: `filings upload month <month>` shows declaration.text and declaration.version')
    .option('--accept-declaration', 'The person confirming has read and accepts the declaration (required)')
    .requiredOption('--declaration-version <version>', 'The declaration version shown with the month (month.declaration.version)')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (month: string, opts: { acceptDeclaration?: boolean; declarationVersion: string; entity?: string; pretty?: boolean }) => {
      if (!opts.acceptDeclaration) {
        console.error('Error: pass --accept-declaration to confirm the declaration (read it with `clearvo filings upload month ' + month + '`)');
        process.exit(1);
      }
      const body: Record<string, unknown> = { declarationAccepted: true, declarationVersion: opts.declarationVersion };
      print(await api('POST', `/filings/upload/months/${encodeURIComponent(month)}/process`, body, entityHdr(opts.entity)), !!opts.pretty);
    });

  upload
    .command('error-report <month> <fileId>')
    .description('A fresh download link for the error and warning report of a processed file (the link is new on every call; do not store it)')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .option('--pretty', 'Pretty-print JSON output')
    .action(async (month: string, fileId: string, opts: { entity?: string; pretty?: boolean }) => {
      print(await api('GET', `/filings/upload/months/${encodeURIComponent(month)}/files/${encodeURIComponent(fileId)}/error-report`, undefined, entityHdr(opts.entity)), !!opts.pretty);
    });

  upload
    .command('template')
    .description('The upload template: the columns Clearvo expects')
    .option('--format <format>', 'csv (default), xlsx or json', 'csv')
    .option('--out <file>', 'Write to a file instead of stdout (required for xlsx)')
    .option('--entity <entityId>', 'Required for account-scoped keys; omit for entity-scoped keys')
    .action(async (opts: { format: string; out?: string; entity?: string }) => {
      if (!['csv', 'xlsx', 'json'].includes(opts.format)) {
        console.error('Error: --format must be csv, xlsx or json');
        process.exit(1);
      }
      const res = await apiFile(`/filings/upload/template?format=${opts.format}`, entityHdr(opts.entity));
      if (opts.format === 'xlsx') writeOut(opts.out, new Uint8Array(await res.arrayBuffer()), 'the template');
      else writeOut(opts.out, await res.text(), 'the template');
    });

  return program;
}

export const program = createProgram();
