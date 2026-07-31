// Delivery reports from Resend.
//
// Until this existed, the campaign report's "Delivered" was the count of
// messages the Resend API accepted, and "bounced" was structurally zero
// because nothing ever wrote it. Resend knows what actually happened and
// will say so here; 0229 is the database half.
//
// Three event types are consumed and everything else is acknowledged and
// dropped:
//
//   email.delivered  → delivered_at, status 'delivered'
//   email.bounced    → a permanent bounce marks the recipient 'bounced'
//                      and suppresses the address; a transient one is
//                      recorded and nothing more, because the provider is
//                      still trying
//   email.complained → someone pressed "this is spam" — recorded and
//                      suppressed, the one thing in email you never retry
//
// verify_jwt is off: Resend carries no JWT. The signature IS the guard,
// and the function refuses every request without a valid one. There is no
// unsigned path and no fallback if the secret is missing — an endpoint
// that accepts unsigned webhooks lets anyone mark any address bounced and
// stop a gym's mail.
//
// Signing follows the Standard Webhooks scheme Resend uses (Svix):
// base64 HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`, keyed on the
// bytes of the secret after its `whsec_` prefix, compared against every
// v1 signature in the header — plural because a secret rotation sends
// both for a while.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_WEBHOOK_SECRET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// Five minutes, the Standard Webhooks default. A replayed payload older
// than this is refused even with a valid signature.
const TOLERANCE_SECONDS = 300;

function decodeBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function encodeBase64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i += 1) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function verify(
  raw: string,
  headers: Headers,
  secret: string,
): Promise<boolean> {
  // Svix's own header names and the vendor-neutral Standard Webhooks ones
  // are both accepted: Resend sends svix-*, the spec says webhook-*, and
  // which one arrives is not something to find out in production.
  const id = headers.get('svix-id') ?? headers.get('webhook-id');
  const ts = headers.get('svix-timestamp') ?? headers.get('webhook-timestamp');
  const sig = headers.get('svix-signature') ?? headers.get('webhook-signature');
  if (!id || !ts || !sig) return false;

  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

  const keyPart = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = decodeBase64(keyPart);
  } catch {
    return false;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${ts}.${raw}`),
  );
  const expected = encodeBase64(mac);

  // "v1,<sig> v1,<sig>" — more than one during a secret rotation.
  for (const part of sig.split(' ')) {
    const comma = part.indexOf(',');
    if (comma < 0) continue;
    if (part.slice(0, comma) !== 'v1') continue;
    if (constantTimeEquals(expected, part.slice(comma + 1))) return true;
  }
  return false;
}

type ResendEvent = {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    bounce?: { type?: string; subType?: string; message?: string };
  };
};

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET');
  if (!SUPABASE_URL || !SERVICE_KEY || !SECRET) {
    // Deliberately a 500, not a 200-and-ignore: an unconfigured endpoint
    // that acknowledges events looks healthy in Resend's dashboard while
    // silently discarding every delivery report.
    return new Response(JSON.stringify({ error: 'Function is not configured' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const raw = await req.text();
  if (!(await verify(raw, req.headers, SECRET))) {
    return new Response(JSON.stringify({ error: 'Bad signature' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response(JSON.stringify({ error: 'Expected a JSON body' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const messageId = event.data?.email_id;
  const kind =
    event.type === 'email.delivered'
      ? 'delivered'
      : event.type === 'email.bounced'
        ? 'bounced'
        : event.type === 'email.complained'
          ? 'complained'
          : null;

  // Opens, clicks, sends and delivery delays all arrive here too. Opens
  // and clicks are already recorded by the pixel and the redirect in
  // `track`, per-recipient and without depending on this endpoint being
  // wired up, so taking them from both would double-count.
  if (!kind || !messageId) {
    return new Response(JSON.stringify({ ok: true, ignored: event.type ?? null }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const bounce = event.data?.bounce;
  // Resend reports 'Permanent' | 'Transient' | 'Undetermined'. Only a
  // permanent one suppresses; an undetermined one is treated as transient
  // because the cost of being wrong is one wasted send, and the cost the
  // other way is a member who never hears from their gym again.
  const hard = kind === 'bounced' ? bounce?.type === 'Permanent' : true;
  const detail =
    kind === 'bounced'
      ? [bounce?.subType, bounce?.message].filter(Boolean).join(': ') || null
      : null;

  const occurredAt = event.created_at ?? new Date().toISOString();

  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await service.rpc('comms_apply_delivery_event', {
    p_provider_message_id: messageId,
    p_kind: kind,
    p_hard: hard,
    p_detail: detail,
    p_occurred_at: occurredAt,
  });

  if (error) {
    // A 500 makes Resend retry, which is what we want for a transient
    // database problem and harmless for a permanent one — the RPC is
    // idempotent on every path.
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, matched: data === true }), {
    headers: { 'content-type': 'application/json' },
  });
});
