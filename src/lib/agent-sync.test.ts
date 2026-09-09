import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

const { deprovisionFrontDesk, provisionFrontDesk } = await import('./agent-sync');

// What an owner is told when provisioning refuses. supabase-js throws a
// FunctionsHttpError for every non-2xx whose message is the literal "Edge
// Function returned a non-2xx status code", and hangs the real response off
// error.context. Rendering that generic sentence is how a 409 that said
// "this is a demo gym" reached a screen as no information at all.

function httpError(status: number, body: unknown) {
  return { context: new Response(JSON.stringify(body), { status }) };
}

beforeEach(() => invoke.mockReset());

describe('provisionFrontDesk', () => {
  it('surfaces the function own message from a non-2xx body', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(409, { error: 'This is a demo gym — Temple won’t buy it a phone number' }),
    });
    await expect(provisionFrontDesk('g1')).rejects.toThrow(/demo gym/);
  });

  it('maps a reason from a non-2xx body to owner-facing copy', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(500, { reason: 'bundle_not_approved' }),
    });
    await expect(provisionFrontDesk('g1')).rejects.toThrow(/paperwork with Twilio/);
  });

  // The body is not always JSON — a gateway timeout is HTML, and a thrown
  // network error has no context at all. Neither may produce "undefined".
  it('falls back to the generic message when the body is unreadable', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(504, 'not json at all') });
    await expect(provisionFrontDesk('g1')).rejects.toThrow(/safe to try again/);
  });

  it('falls back when the error carries no response at all', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('network down') });
    await expect(provisionFrontDesk('g1')).rejects.toThrow(/safe to try again/);
  });

  // A 200 that says it did not provision still has to be read, which is the
  // path not_configured takes.
  it('reads a reason out of a 200 body', async () => {
    invoke.mockResolvedValue({ data: { provisioned: false, reason: 'not_configured' }, error: null });
    await expect(provisionFrontDesk('g1')).rejects.toThrow(/isn't set up on Temple's side/);
  });

  it('returns the number on success', async () => {
    invoke.mockResolvedValue({ data: { provisioned: true, number: '+447700900123' }, error: null });
    await expect(provisionFrontDesk('g1')).resolves.toEqual({ number: '+447700900123' });
  });
});

describe('deprovisionFrontDesk', () => {
  it('surfaces the function own message rather than the wrapper', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(403, { error: 'Not authorised' }),
    });
    await expect(deprovisionFrontDesk('g1')).rejects.toThrow('Not authorised');
  });
});
