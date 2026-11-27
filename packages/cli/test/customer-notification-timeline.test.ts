// `clearvo invoices get`, `clearvo invoices resend-notification --email` and the webhook event list for
// invoice.customer_notification.*.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createProgram } from '../src/program';

const originalFetch = global.fetch;
const originalApiKey = process.env.CLEARVO_API_KEY;
const originalBaseUrl = process.env.CLEARVO_BASE_URL;

beforeEach(() => {
  process.env.CLEARVO_API_KEY = 'csk_live_testkey';
  process.env.CLEARVO_BASE_URL = 'http://x/v1';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  global.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.CLEARVO_API_KEY; else process.env.CLEARVO_API_KEY = originalApiKey;
  if (originalBaseUrl === undefined) delete process.env.CLEARVO_BASE_URL; else process.env.CLEARVO_BASE_URL = originalBaseUrl;
  vi.restoreAllMocks();
});

const run = async (args: string[]) => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
  global.fetch = fetchMock as unknown as typeof fetch;
  await createProgram().parseAsync(args, { from: 'user' });
  return fetchMock.mock.calls[0] as [string, { method: string; body?: string; headers: Record<string, string> }];
};

describe('customer notification commands', () => {
  it('invoices get reads the invoice detail with the entity header', async () => {
    const [url, init] = await run(['invoices', 'get', 'inv/1', '--entity', 'ent_1']);
    expect(url).toBe('http://x/v1/invoices/inv%2F1');
    expect(init.method).toBe('GET');
    expect(init.headers['x-entity-id']).toBe('ent_1');
  });

  it('resend-notification --email sends the override', async () => {
    const [url, init] = await run(['invoices', 'resend-notification', 'inv_1', '--email', 'billing@customer.example']);
    expect(url).toBe('http://x/v1/invoices/inv_1/resend-notification');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'billing@customer.example' });
  });

  it('resend-notification without --email sends an empty body', async () => {
    const [, init] = await run(['invoices', 'resend-notification', 'inv_1']);
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it('webhooks create passes a customer notification event by name', async () => {
    const [, init] = await run(['webhooks', 'create', '--url', 'https://example.com/h', '--events', 'invoice.customer_notification.bounced,invoice.customer_notification.opened']);
    expect(JSON.parse(init.body as string).events).toEqual(['invoice.customer_notification.bounced', 'invoice.customer_notification.opened']);
  });

  it('webhooks create rejects an unknown customer notification event before calling the API', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(createProgram().parseAsync(['webhooks', 'create', '--url', 'https://example.com/h', '--events', 'invoice.customer_notification.read'], { from: 'user' })).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
