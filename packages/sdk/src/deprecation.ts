// Client-side deprecation awareness. A v1 call to a deprecated endpoint is answered with `Deprecation` (RFC 9745),
// `Sunset` (RFC 8594) and a `Link` header (`rel="deprecation"`, plus `rel="successor-version"` when there is a replacement
// endpoint). This module parses them and warns once per surface.

/** What the API said about a deprecated endpoint on one response. */
export interface DeprecationInfo {
  /** The surface the call hit, `METHOD /v1/path` with identifier-like path segments shown as `{id}`. */
  surface: string;
  /** When the endpoint was deprecated (ISO 8601), or null when the `Deprecation` header carried no date (`true`). */
  deprecatedAt: string | null;
  /** When the endpoint stops working (ISO 8601), or null when no `Sunset` header was sent. */
  sunsetAt: string | null;
  /** Link to the replacement endpoint (`rel="successor-version"`), or null. */
  replacement: string | null;
  /** The deprecation notice link (`rel="deprecation"`, GET /v1/deprecations), or null. */
  noticeUrl: string | null;
}

/** `onDeprecation` option: a function replaces the default `console.warn`; `false` silences the warning. */
export type OnDeprecation = ((info: DeprecationInfo) => void) | false;

const ID_LIKE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*)$/i;

/** `/v1/invoices/abc123/fix` becomes `/v1/invoices/{id}/fix`: the surface is the route, not the one id called. */
function templatePath(path: string): string {
  const bare = path.split('?')[0];
  return bare.split('/').map(seg => (seg && ID_LIKE.test(seg) && !/^v\d+$/.test(seg) ? '{id}' : seg)).join('/');
}

function linkTarget(link: string, rel: string): string | null {
  for (const part of link.split(/,(?=\s*<)/)) {
    const m = /<([^>]*)>(.*)/.exec(part.trim());
    if (m && new RegExp(`rel="?(?:[^";]*\\s)?${rel}(?:\\s[^";]*)?"?`, 'i').test(m[2])) return m[1];
  }
  return null;
}

/** Parses the deprecation headers of a response; null when it carries neither `Deprecation` nor `Sunset`. */
export function parseDeprecationHeaders(headers: { get(name: string): string | null }, method: string, path: string, baseUrl = ''): DeprecationInfo | null {
  const deprecation = headers.get('deprecation');
  const sunset = headers.get('sunset');
  if (!deprecation && !sunset) return null;
  let deprecatedAt: string | null = null;
  const at = /^@(\d+)$/.exec((deprecation ?? '').trim());
  if (at) deprecatedAt = new Date(Number(at[1]) * 1000).toISOString();
  else if (deprecation && deprecation.trim().toLowerCase() !== 'true') {
    const d = new Date(deprecation);
    if (!Number.isNaN(d.getTime())) deprecatedAt = d.toISOString();
  }
  let sunsetAt: string | null = null;
  if (sunset) {
    const d = new Date(sunset);
    if (!Number.isNaN(d.getTime())) sunsetAt = d.toISOString();
  }
  const link = headers.get('link') ?? '';
  const resolve = (target: string | null): string | null => {
    if (!target) return null;
    return /^https?:\/\//i.test(target) ? target : `${baseUrl.replace(/\/v1\/?$/, '')}${target}`;
  };
  return {
    surface: `${method.toUpperCase()} /v1${templatePath(path)}`,
    deprecatedAt,
    sunsetAt,
    replacement: resolve(linkTarget(link, 'successor-version')),
    noticeUrl: resolve(linkTarget(link, 'deprecation')),
  };
}

/** One-line human warning naming the surface, the sunset date and the replacement. */
export function formatDeprecationWarning(info: DeprecationInfo): string {
  const sunset = info.sunsetAt ? ` and stops working on ${info.sunsetAt.slice(0, 10)}` : '';
  const replacement = info.replacement ? ` Use ${info.replacement} instead.` : '';
  const more = info.noticeUrl ? ` Details: ${info.noticeUrl}` : '';
  return `Clearvo API deprecation: ${info.surface} is deprecated${sunset}.${replacement}${more}`;
}

/** Remembers which surfaces were already reported, so a surface warns once. */
export class DeprecationTracker {
  private readonly seen = new Map<string, DeprecationInfo>();

  constructor(private readonly handler: OnDeprecation | undefined) {}

  /** Records the response's deprecation info, warning the first time a surface is seen. */
  observe(info: DeprecationInfo | null): void {
    if (!info) return;
    const first = !this.seen.has(info.surface);
    this.seen.set(info.surface, info);
    if (!first || this.handler === false) return;
    if (typeof this.handler === 'function') {
      try { this.handler(info); } catch { /* a throwing callback must never fail the API call */ }
    } else {
      console.warn(formatDeprecationWarning(info));
    }
  }

  /** Every deprecated surface seen so far on this client. */
  all(): DeprecationInfo[] {
    return [...this.seen.values()];
  }
}
