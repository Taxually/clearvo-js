// Compile-time guard for the customer notification email timeline: the closed event type, the opt-in webhook names and the
// resend options.

import type {
  ClearvoClient,
  CustomerNotificationEventType,
  CustomerNotificationWebhookEventName,
  CustomerNotificationWebhookPayload,
  ResendCustomerNotificationInput,
} from '../src/index.js';

declare const client: ClearvoClient;

async function _detail() {
  const detail = await client.getInvoice('inv_1');
  const type: CustomerNotificationEventType = detail.customerNotification.events[0].type;
  const reason: string | null = detail.customerNotification.events[0].reason;
  return [type, reason];
}

// @ts-expect-error not a lifecycle event type
const _badType: CustomerNotificationEventType = 'read';
const _name: CustomerNotificationWebhookEventName = 'invoice.customer_notification.bounced';
// @ts-expect-error not one of the ten opt-in webhook names
const _badName: CustomerNotificationWebhookEventName = 'invoice.customer_notification.read';
const _sub: Parameters<ClearvoClient['createWebhook']>[0] = { url: 'https://example.com/hook', events: ['invoice.customer_notification.delivered'] };
const _resend: ResendCustomerNotificationInput = { email: 'billing@customer.example' };
// @ts-expect-error email is a string
const _badResend: ResendCustomerNotificationInput = { email: 42 };

function _payload(p: CustomerNotificationWebhookPayload) {
  const domain: string | null = p.recipientDomain;
  const entity: string | null = p.entityId;
  return [p.type, p.notificationId, domain, entity];
}
