import type { Deprecation, ChangelogEntry, DeprecationNoticeWebhookPayload, WebhookEventName, ListChangelogResponse } from '../src/index';
import { ClearvoClient } from '../src/index';

const d = {} as Deprecation;
const kind: 'endpoint' | 'field' | 'error_code' = d.kind;
const replacement: string | null = d.replacement;
const category: 'breaking-change' | 'new-feature' | 'improvement' | 'bug-fix' = ({} as ChangelogEntry).category;
const next: string | null = ({} as ListChangelogResponse).nextCursor;
const stage: 90 | 30 | 7 = ({} as DeprecationNoticeWebhookPayload).deprecation.stage;
const ev: WebhookEventName = 'deprecation.notice';
new ClearvoClient({ apiKey: 'k', onDeprecation: false });
new ClearvoClient({ apiKey: 'k', onDeprecation: (i) => { const s: string = i.surface; void s; } });
void [kind, replacement, category, next, stage, ev];
