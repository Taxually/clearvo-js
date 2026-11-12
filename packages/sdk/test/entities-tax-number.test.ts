// Entities: taxNumber filter on list, taxNumber on every entity, DUPLICATE_ENTITY on create.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClearvoClient } from '../src/client';
import { ClearvoError } from '../src/types';

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function mock(body: unknown, status = 200) {
  const m = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  global.fetch = m as unknown as typeof fetch;
  return m;
}
const client = () => new ClearvoClient({ apiKey: 'csk_live_x', baseUrl: 'http://x/v1' });

describe('entities taxNumber', () => {
  it('listEntities sends no query without a filter', async () => {
    const m = mock({ entities: [] });
    await client().listEntities();
    expect(m.mock.calls[0][0]).toBe('http://x/v1/entities');
  });

  it('listEntities encodes the taxNumber filter and exposes taxNumber on entities', async () => {
    const m = mock({ entities: [{ id: 'e1', name: 'A', country: 'DE', vatNumber: 'DE123456788', taxNumber: 'DE123456788', isDefault: true, createdAt: 'x' }] });
    const out = await client().listEntities({ taxNumber: 'DE 1234-56788' });
    expect(m.mock.calls[0][0]).toBe('http://x/v1/entities?taxNumber=DE%201234-56788');
    expect(out.entities[0].taxNumber).toBe('DE123456788');
  });

  it('createEntity surfaces DUPLICATE_ENTITY with the existing entityId', async () => {
    mock({ error: 'DUPLICATE_ENTITY', message: 'exists', entityId: 'ent_9' }, 409);
    const err = await client().createEntity({ legalName: 'A', country: 'DE', vatNumber: 'DE123456788' }).catch((e) => e);
    expect(err).toBeInstanceOf(ClearvoError);
    expect(err.status).toBe(409);
    expect(err.code).toBe('DUPLICATE_ENTITY');
    expect(err.body?.entityId).toBe('ent_9');
  });
});
