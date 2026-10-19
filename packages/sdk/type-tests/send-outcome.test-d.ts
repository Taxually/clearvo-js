import type { SendResult, StatusChangedWebhookPayload } from '../src/types.js';

declare const r: SendResult;
const outcome: 'CLEARED' | 'REJECTED' | 'ACCUMULATED' | 'NEEDS_INFO' | 'NO_OBLIGATION' | 'HELD' | 'PROCESSING' | undefined = r.outcome;
void outcome;

declare const w: StatusChangedWebhookPayload;
const eventId: string = w.eventId;
const seq: number = w.seq;
void eventId;
void seq;
