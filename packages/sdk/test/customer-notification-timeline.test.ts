// Coverage for getInvoice (customerNotification.events) and resendCustomerNotification (optional email).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';
import { ClearvoError } from '../src/types';

describe('customer notification timeline', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  const client = () => new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });
  const mockOk = (body: unknown) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  };

  it('getInvoice reads the id-encoded path with the entity header and returns the event history', async () => {
    const detail = {
      id: 'inv_1',
      customerNotification: {
        eligible: true, status: 'BOUNCED', sentAt: '2026-11-27T10:00:00Z', viewedAt: null, downloadedAt: null,
        bouncedAt: '2026-11-27T10:01:00Z', complainedAt: null, errorMessage: null,
        events: [
          { type: 'sent', occurredAt: '2026-11-27T10:00:00Z', reason: null },
          { type: 'bounced', occurredAt: '2026-11-27T10:01:00Z', reason: 'mailbox full' },
        ],
      },
    };
    const fetchMock = mockOk(detail);
    const out = await client().getInvoice('inv/1 2', 'ent_1');
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/invoices/inv%2F1%202');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    expect(fetchMock.mock.calls[0][1].headers['x-entity-id']).toBe('ent_1');
    expect(out.customerNotification.events.map(e => e.type)).toEqual(['sent', 'bounced']);
    expect(out.customerNotification.events[1].reason).toBe('mailbox full');
  });

  it('resendCustomerNotification posts the email override', async () => {
    const fetchMock = mockOk({ ok: true, customerNotification: { status: 'SENT' } });
    const out = await client().resendCustomerNotification('inv_1', { email: 'billing@customer.example' }, 'ent_1');
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/invoices/inv_1/resend-notification');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'billing@customer.example' });
    expect(fetchMock.mock.calls[0][1].headers['x-entity-id']).toBe('ent_1');
    expect(out.customerNotification.status).toBe('SENT');
  });

  it('resendCustomerNotification without an email sends an empty body', async () => {
    const fetchMock = mockOk({ ok: true, customerNotification: { status: 'SENT' } });
    await client().resendCustomerNotification('inv_1');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({});
  });

  it('resendCustomerNotification throws ClearvoError on a 400 invalid email', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: 'email must be a valid email address', hint: 'Pass the address.' }),
    }) as unknown as typeof fetch;
    await expect(client().resendCustomerNotification('inv_1', { email: 'nope' })).rejects.toBeInstanceOf(ClearvoError);
  });
});
