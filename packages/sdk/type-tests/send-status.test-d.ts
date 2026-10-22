import type { SendResult, StatusChangedWebhookPayload, InvoiceStatus, InvoiceStage, InvoiceReason, BuyerResponse, Issue } from '../src/types.js';

declare const r: SendResult;
const status: 'RECEIVED' | 'PENDING' | 'WAITING_FOR_YOU' | 'WAITING_FOR_PLATFORM' | 'ACCUMULATED' | 'COMPLETED' | 'REJECTED' | 'CANCELLED' | 'SKIPPED' | 'NOT_APPLICABLE' = r.status;
const stage: 'queued' | 'awaiting_authority' | 'generated' | 'reported' | 'cleared' | 'delivered' | 'received' | null = r.stage;
const reason: InvoiceReason = r.reason;
const issues: Issue[] = r.issues;
const buyer: BuyerResponse | null = r.buyerResponse;
const terminal: boolean = r.terminal;
void status;
void stage;
void reason;
void issues;
void buyer;
void terminal;

// The retired alias is gone from the public types.
// @ts-expect-error clearanceStatus was removed
r.clearanceStatus;

// @ts-expect-error the old enum value is not a status
const old: InvoiceStatus = 'NEEDS_INFO';
void old;
const okReason: InvoiceReason = 'NEEDS_INFO';
const okStage: InvoiceStage = 'cleared';
void okReason;
void okStage;

declare const w: StatusChangedWebhookPayload;
const eventId: string = w.eventId;
const seq: number = w.seq;
const to: InvoiceStatus = w.status;
const prev: InvoiceStatus | null = w.previousStatus;
const why: string = w.cause.message ?? '';
void eventId;
void seq;
void to;
void prev;
void why;
