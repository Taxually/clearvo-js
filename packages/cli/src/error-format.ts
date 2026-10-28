// Shared error-body handling for the SDK, the CLI and the stdio MCP server.
//
// CANONICAL COPY: packages/sdk/src/error-format.ts. packages/cli/src/error-format.ts and
// packages/mcp/src/error-format.ts are byte-identical copies (the three packages are published
// independently, so they cannot import each other). the "copies stay in sync" test in
// packages/sdk/test/error-passthrough.test.ts fails when a copy drifts: edit the SDK file, then copy it over the other two.
//
// Pure functions only: no I/O, no dependencies.

export interface FieldIssue {
  path?: string;
  message: string;
}

/** What a failed HTTP response carried, normalised from every error shape the backend produces. */
export interface ParsedError {
  status: number;
  message: string;
  code?: string;
  hint?: string;
  field?: string;
  /** The `{error:'Invalid request body', details:{formErrors,fieldErrors}}` object (or array), as sent. */
  details?: unknown;
  /** The backend's `issues:[{path,message}]` (full dotted paths). */
  issues?: FieldIssue[];
  /** `errors[]` entries (`{path,errorCode|code,message,field}`) of a send rejection or `{ok:false,errors}` body. */
  errors?: Array<Record<string, unknown>>;
  requestId?: string;
  /** Seconds, from the Retry-After header. */
  retryAfter?: number;
  idempotencyKey?: string;
  /** The body's own `retryable` flag (the backend's central normaliser sets it on every v1 error), when present. */
  retryable?: boolean;
  /** First 500 characters of the body when it was not JSON (an HTML gateway page, a plain-text 413, ...). */
  rawBody?: string;
  /** The parsed JSON body, when it was a JSON object. */
  body?: Record<string, unknown>;
}

export const MAX_FIELD_ERRORS = 25;
const RAW_BODY_LIMIT = 500;

export const GATEWAY_MESSAGE = 'gateway timeout or unavailable; the request may have been processed, check status before retrying';
export const PAYLOAD_TOO_LARGE_MESSAGE = 'payload too large';

interface HeaderLike { get(name: string): string | null }
export interface ResponseLike {
  status: number;
  headers?: HeaderLike;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function header(res: ResponseLike, name: string): string | undefined {
  try {
    const v = res.headers?.get?.(name);
    return v ? v : undefined;
  } catch {
    return undefined;
  }
}

/** The body of a 2xx response could not be read. `timedOut` is true for an abort or timeout. */
export class BodyReadError extends Error {
  readonly timedOut: boolean;
  constructor(public readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'BodyReadError';
    this.timedOut = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
  }
}

/**
 * An AbortSignal that fires after `ms`. Uses AbortSignal.timeout where it exists (Node 17.3+, modern browsers) and an
 * AbortController with an unref'd timer elsewhere (Node 16, React Native, older runtimes).
 */
export function timeoutSignal(ms: number): AbortSignal {
  const native = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout;
  if (typeof native === 'function') return native.call(AbortSignal, ms);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const reason = new Error('The operation timed out');
    reason.name = 'TimeoutError';
    controller.abort(reason);
  }, ms) as unknown as { unref?: () => void };
  timer.unref?.();
  return controller.signal;
}

/** Reads a response body ONCE. `json` is set when the text parsed (a literal `null` stays `null`). */
export async function readBody(res: ResponseLike): Promise<{ text: string; json?: unknown; isJson: boolean }> {
  let text = '';
  if (typeof res.text === 'function') {
    try {
      text = await res.text();
    } catch (cause) {
      // A body that cannot be read on a 2xx (abort, reset, truncated stream) is a failure, never "success with nothing".
      // On an error status the status line is the answer, so the read error is swallowed.
      if (res.status >= 200 && res.status < 300) throw new BodyReadError(cause);
      text = '';
    }
  }
  if (text.trim() === '' && typeof res.json === 'function') {
    // A minimal Response stand-in (tests) that only offers json(), or text() that returns ''. On a real Response the
    // body is already consumed here, so json() throws and the body counts as empty.
    try {
      const j = await res.json();
      return { text: JSON.stringify(j) ?? '', json: j, isJson: true };
    } catch {
      return { text: '', isJson: false };
    }
  }
  if (text.trim() === '') return { text: '', isJson: false };
  try {
    return { text, json: JSON.parse(text), isJson: true };
  } catch {
    return { text, isJson: false };
  }
}

/** Seconds from a Retry-After header (delta-seconds or an HTTP date); undefined when absent or unreadable. */
export function parseRetryAfter(value: string | undefined | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return n;
  const t = Date.parse(value);
  if (Number.isFinite(t)) return Math.max(0, Math.ceil((t - Date.now()) / 1000));
  return undefined;
}

function pathToString(p: unknown): string | undefined {
  if (typeof p === 'string') return p === '' || p === '/' ? undefined : p;
  if (Array.isArray(p)) return p.length ? p.map(String).join('.') : undefined;
  return undefined;
}

function toIssues(v: unknown): FieldIssue[] {
  if (!Array.isArray(v)) return [];
  const out: FieldIssue[] = [];
  for (const e of v) {
    if (typeof e === 'string') { out.push({ message: e }); continue; }
    if (!isRecord(e)) continue;
    const message = typeof e.message === 'string' ? e.message : undefined;
    if (!message) continue;
    out.push({ path: pathToString(e.path) ?? (typeof e.field === 'string' ? e.field : undefined), message });
  }
  return out;
}

/** Zod `flatten()` output: `{formErrors: string[], fieldErrors: {field: string[]}}`. */
function flattenIssues(details: unknown): FieldIssue[] {
  if (Array.isArray(details)) return toIssues(details);
  if (!isRecord(details)) return [];
  const out: FieldIssue[] = [];
  if (Array.isArray(details.formErrors)) {
    for (const m of details.formErrors) if (typeof m === 'string') out.push({ message: m });
  }
  if (isRecord(details.fieldErrors)) {
    for (const [field, msgs] of Object.entries(details.fieldErrors)) {
      const list = Array.isArray(msgs) ? msgs : [msgs];
      for (const m of list) if (typeof m === 'string') out.push({ path: field, message: m });
    }
  }
  return out;
}

/**
 * Every field-level problem in a body as FieldIssue[], deduplicated. The backend's `issues` (full dotted
 * paths) win over the flatten-style `details.fieldErrors` (which can only name the top-level key).
 */
export function collectFieldIssues(body: Record<string, unknown> | undefined): FieldIssue[] {
  if (!body) return [];
  const fromIssues = toIssues(body.issues);
  const fromDetails = flattenIssues(body.details);
  const all = fromIssues.length > 0
    ? [...fromIssues, ...fromDetails.filter(d => !d.path)] // form-level messages only; paths come from `issues`
    : fromDetails;
  const seen = new Set<string>();
  return all.filter(i => {
    const k = `${i.path ?? ''}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** `path: message` lines (message alone for a form-level error), capped. */
export function fieldErrorLines(issues: FieldIssue[], cap = MAX_FIELD_ERRORS): string[] {
  const lines = issues.slice(0, cap).map(i => (i.path ? `${i.path}: ${i.message}` : i.message));
  if (issues.length > cap) lines.push(`and ${issues.length - cap} more`);
  return lines;
}

/** One line per `errors[]` entry, e.g. `/customer/address MISSING_CUSTOMER_ADDRESS: Customer address is required`. */
export function errorEntryLines(errors: Array<Record<string, unknown>> | undefined, cap = MAX_FIELD_ERRORS): string[] {
  if (!errors) return [];
  const lines = errors.slice(0, cap).map(e => {
    const where = e.path ?? e.field ?? '/';
    const code = e.errorCode ?? e.code ?? '';
    return `${where} ${code}: ${e.message ?? ''}`.replace(/\s+:/, ':');
  });
  if (errors.length > cap) lines.push(`and ${errors.length - cap} more`);
  return lines;
}

/** The status-specific sentence for a non-JSON error body (a gateway page), or undefined. */
export function statusHint(status: number): string | undefined {
  if (status === 502 || status === 503 || status === 504) return GATEWAY_MESSAGE;
  if (status === 413) return PAYLOAD_TOO_LARGE_MESSAGE;
  return undefined;
}

/** Normalises a failed response (status, headers, body already read) into a ParsedError. */
export function parseErrorResponse(res: ResponseLike, body: { text: string; json?: unknown; isJson: boolean }): ParsedError {
  const status = res.status;
  const data = isRecord(body.json) ? body.json : undefined; // a null / array / scalar JSON body has no fields to read
  const base: ParsedError = {
    status,
    message: `HTTP ${status}`,
    requestId: header(res, 'x-request-id') ?? header(res, 'x-ms-request-id') ?? undefined,
    retryAfter: parseRetryAfter(header(res, 'retry-after')),
    idempotencyKey: header(res, 'x-idempotency-key'),
  };

  if (!data) {
    // Not an object: HTML from the gateway, plain text, empty, or a bare JSON scalar.
    const raw = body.text.slice(0, RAW_BODY_LIMIT);
    const hint = statusHint(status);
    return {
      ...base,
      message: hint ? `HTTP ${status}: ${hint}` : raw && !body.isJson && !/^\s*</.test(raw) ? `HTTP ${status}: ${raw.split('\n')[0].slice(0, 200)}` : `HTTP ${status}`,
      rawBody: raw || undefined,
    };
  }

  const errObj = isRecord(data.error) ? data.error : null;
  // The Filings routes put the stable code in `error` and the sentence in `message` or `detail`.
  const filingsCode = !errObj && typeof data.error === 'string' && (typeof data.message === 'string' || typeof data.detail === 'string') ? data.error : undefined;
  const errors = Array.isArray(data.errors) ? data.errors.filter(isRecord) : undefined;

  // Headline: the top-level `message` (every v1 error carries one now); else `error.message`; else the sentence in `detail`
  // (an `error` that is a bare code like INVALID_TAX_NUMBER is not a sentence); else `error` as it is, even a bare code.
  let message: string;
  if (typeof data.message === 'string' && data.message) message = data.message;
  else if (errObj) message = String(errObj.message ?? errObj.code ?? `HTTP ${status}`);
  else if (typeof data.error === 'string' && data.error && typeof data.detail === 'string' && data.detail) message = data.detail;
  else if (typeof data.error === 'string' && data.error) message = data.error;
  else if (typeof data.detail === 'string' && data.detail) message = data.detail;
  else if (errors?.length && typeof errors[0].message === 'string') message = errors[0].message as string;
  else message = `HTTP ${status}`;

  const issues = collectFieldIssues(data);
  if (issues.length > 0) {
    const lines = fieldErrorLines(issues);
    // Do not repeat what the message already says.
    if (!lines.every(l => message.includes(l))) message = `${message}: ${lines.join('; ')}`;
  }

  return {
    ...base,
    message,
    code: typeof data.code === 'string' ? data.code : typeof errObj?.code === 'string' ? errObj.code : filingsCode,
    hint: typeof data.hint === 'string' ? data.hint : typeof errObj?.hint === 'string' ? errObj.hint : undefined,
    field: typeof data.field === 'string' ? data.field : typeof errObj?.field === 'string' ? errObj.field : undefined,
    retryable: typeof data.retryable === 'boolean' ? data.retryable : typeof errObj?.retryable === 'boolean' ? errObj.retryable : undefined,
    details: data.details,
    issues: toIssues(data.issues).length > 0 ? toIssues(data.issues) : undefined,
    errors: errors && errors.length > 0 ? errors : undefined,
    idempotencyKey: base.idempotencyKey ?? (typeof data.idempotencyKey === 'string' ? data.idempotencyKey : undefined),
    body: data,
  };
}

/** Transient by status: worth another attempt after a pause (429 and the gateway family). */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/** Exit code for a failed HTTP call: 3 auth, 4 validation, 5 server or network, 1 other. 2 is reserved for usage errors. */
export function exitCodeForStatus(status: number): number {
  if (status === 401 || status === 403) return 3;
  if (status === 400 || status === 422) return 4;
  if (status === 0 || status >= 500) return 5;
  return 1;
}

/** A per-row outcome that did not succeed. */
export const FAILED_ROW_OUTCOMES = ['ERRORED', 'NEEDS_INFO'];

/** Rows of a bulk result that ERRORED or NEEDS_INFO. */
export function failedRows(body: unknown): Array<Record<string, unknown>> {
  if (!isRecord(body) || !Array.isArray(body.rows)) return [];
  return body.rows.filter((r): r is Record<string, unknown> => isRecord(r) && typeof r.outcome === 'string' && FAILED_ROW_OUTCOMES.includes(r.outcome));
}

/**
 * True when a 2xx body is a failure: `ok === false`. Deliberately nothing broader: a top-level `error` or `code` can sit
 * in a correct result (a FAILED batch status read, a validation result, a test-run record). Per-row ERRORED / NEEDS_INFO
 * outcomes of a bulk SUBMIT are checked separately with {@link failedRows}: a tool that merely lists rows must not turn
 * an error row into a failed call.
 */
export function isFailureBody(body: unknown): boolean {
  return isRecord(body) && body.ok === false;
}

/**
 * Plain-text rendering of a ParsedError, one fact per line: used by the CLI (stderr) and the stdio MCP server
 * (tool result text). `extra` lines (a code-specific next step) go after the field errors.
 */
export function formatErrorLines(e: ParsedError): string[] {
  const out = [e.status === 0 ? e.message : e.message.startsWith('HTTP ') ? e.message : `HTTP ${e.status}: ${e.message}`];
  if (e.code) out.push(`Code: ${e.code}`);
  if (e.field) out.push(`Field: ${e.field}`);
  if (e.hint) out.push(`Hint: ${e.hint}`);
  if (e.retryable !== undefined) out.push(`Retryable: ${e.retryable ? 'yes' : 'no'}`);
  // Field errors are already in the message (up to 25): not printed a second time.
  const entries = errorEntryLines(e.errors);
  if (entries.length > 0) {
    out.push('Errors:');
    for (const l of entries) out.push(`  - ${l}`);
  }
  if (e.rawBody && !e.body) out.push(`Response body: ${e.rawBody.replace(/\s+/g, ' ').slice(0, 300)}`);
  if (e.retryAfter !== undefined) out.push(`Retry-After: ${e.retryAfter}s`);
  if (e.requestId) out.push(`Request-Id: ${e.requestId}`);
  return out;
}

/** The machine-readable error object printed by `--json-errors` and returned in an MCP error result. */
export function errorToJson(e: ParsedError): Record<string, unknown> {
  const j: Record<string, unknown> = {
    status: e.status,
    code: e.code,
    message: e.message,
    field: e.field,
    hint: e.hint,
    details: e.details,
    issues: e.issues ?? (collectFieldIssues(e.body).length > 0 ? collectFieldIssues(e.body) : undefined),
    errors: e.errors,
    requestId: e.requestId,
    retryAfter: e.retryAfter,
    retryable: e.retryable,
    rawBody: e.rawBody,
    // The whole parsed body, so a piped caller loses nothing (existingId, reason, filesWithErrors, contactUrl, currentVersion, ...).
    body: e.body,
  };
  for (const k of Object.keys(j)) if (j[k] === undefined) delete j[k];
  return j;
}
