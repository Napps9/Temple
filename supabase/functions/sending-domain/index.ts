// Communications Suite — per-gym sending domain management.
//
// Backs the "Sending domain" card on the comms settings screen. A gym
// connects a domain they own; we register it with Resend, hand back the
// DKIM / SPF / DMARC DNS records to add, and once their DNS verifies,
// send-campaign sends from that gym's own address instead of the shared
// platform one.
//
// Actions (POST JSON { action, gym_id, ... }):
//   connect           { domain, from_local? } — register with Resend, store records
//   verify            — re-check Resend, refresh status/records
//   disconnect        — delete from Resend, clear the row
//   update_from_local { from_local }           — change the sender local part
//
// Every action re-authorises the caller via effective_can(can_manage_comms)
// for the target gym (the service client used for writes bypasses RLS), so
// a stray JWT can't touch another gym's domain. All Resend-managed state is
// written here under the service role — the table has no client write
// policy.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
// Needs RESEND_API_KEY for everything except update_from_local.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const RESEND_BASE = 'https://api.resend.com/domains';

// Defence in depth — mirrors src/lib/sending-domain.ts. The client
// validates for UX; this is the authoritative gate.
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com',
  'gmx.com', 'gmx.net', 'mail.com', 'zoho.com', 'yandex.com', 'yandex.ru',
  'fastmail.com', 'pm.me',
]);

const FQDN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');
}

function normalizeLocalPart(input: string | undefined): string {
  const l = (input ?? '').trim().toLowerCase();
  return /^[a-z0-9._-]{1,64}$/.test(l) ? l : '';
}

function mapResendStatus(raw: unknown): string {
  switch (raw) {
    case 'verified':
      return 'verified';
    case 'failed':
    case 'failure':
      return 'failed';
    case 'temporary_failure':
      return 'temporary_failure';
    default:
      // not_started / pending / verifying
      return 'pending';
  }
}

type ResendResult = { ok: boolean; status: number; data: any; errorText: string };

async function resend(
  method: string,
  path: string,
  apiKey: string,
  body?: unknown,
): Promise<ResendResult> {
  const res = await fetch(`${RESEND_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return {
    ok: res.ok,
    status: res.status,
    data,
    errorText: (data?.message ?? text ?? '').toString().slice(0, 500),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: 'Function is not configured' }, 500);
  }

  let action: string | undefined;
  let gymId: string | undefined;
  let domainInput: string | undefined;
  let fromLocalInput: string | undefined;
  try {
    const body = await req.json();
    action = body?.action;
    gymId = body?.gym_id;
    domainInput = body?.domain;
    fromLocalInput = body?.from_local;
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  if (!action || !gymId) return json({ error: 'action and gym_id are required' }, 400);

  const authHeader = req.headers.get('Authorization') ?? '';
  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // Authorise the caller for this gym.
  const { data: allowed, error: aErr } = await caller.rpc('effective_can', {
    p_gym_id: gymId,
    p_capability: 'can_manage_comms',
  });
  if (aErr || allowed !== true) return json({ error: 'Not authorised' }, 403);

  const { data: existing } = await service
    .from('gym_sending_domains')
    .select('*')
    .eq('gym_id', gymId)
    .maybeSingle();

  // --- update_from_local: no Resend needed -------------------------------
  if (action === 'update_from_local') {
    if (!existing) return json({ error: 'Connect a domain first' }, 400);
    const fromLocal = normalizeLocalPart(fromLocalInput);
    if (!fromLocal) return json({ error: 'Invalid sender name' }, 400);
    const { error } = await service
      .from('gym_sending_domains')
      .update({ from_local: fromLocal, updated_at: new Date().toISOString() })
      .eq('gym_id', gymId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, from_local: fromLocal });
  }

  // --- disconnect: always clears the local row (so a gym can never be stuck
  // with an un-removable domain), best-effort deleting on Resend's side.
  if (action === 'disconnect') {
    if (existing?.resend_domain_id && RESEND_API_KEY) {
      // 404 is fine — already gone on Resend's side.
      await resend('DELETE', `/${existing.resend_domain_id}`, RESEND_API_KEY);
    }
    const { error } = await service
      .from('gym_sending_domains')
      .delete()
      .eq('gym_id', gymId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // Everything below needs Resend.
  if (!RESEND_API_KEY) {
    return json(
      { error: 'Email delivery isn’t configured yet (missing Resend API key).' },
      503,
    );
  }

  // --- connect -----------------------------------------------------------
  if (action === 'connect') {
    const domain = normalizeDomain(domainInput ?? '');
    if (!domain || !FQDN_RE.test(domain)) {
      return json({ error: 'That doesn’t look like a valid domain.' }, 400);
    }
    if (FREE_EMAIL_DOMAINS.has(domain)) {
      return json(
        { error: 'You can’t send from a free email provider. Use a domain you own.' },
        400,
      );
    }
    if (existing?.resend_domain_id) {
      return json(
        { error: 'A domain is already connected. Disconnect it first.' },
        409,
      );
    }
    const fromLocal = normalizeLocalPart(fromLocalInput) || 'news';

    // Reuse an existing Resend domain with this name instead of creating a
    // duplicate. Resend allows multiple same-name domains (e.g. one per
    // region); a second one silently splits DNS ownership of
    // resend._domainkey so neither can verify cleanly. Prefer an
    // already-verified match, then any match, else create fresh.
    let record: any = null;
    const list = await resend('GET', '', RESEND_API_KEY);
    const listed: any[] = Array.isArray(list.data?.data)
      ? list.data.data
      : Array.isArray(list.data)
        ? list.data
        : [];
    const matches = listed.filter((d) => normalizeDomain(d?.name ?? '') === domain);
    const match = matches.find((d) => d?.status === 'verified') ?? matches[0] ?? null;
    if (match?.id) {
      const got = await resend('GET', `/${match.id}`, RESEND_API_KEY);
      record = got.ok ? got.data : match;
    }

    if (!record) {
      const created = await resend('POST', '', RESEND_API_KEY, { name: domain });
      if (!created.ok) {
        return json(
          { error: created.errorText || 'Resend rejected the domain.' },
          created.status === 422 || created.status === 400 ? 400 : 502,
        );
      }
      record = created.data ?? {};
    }
    const { error: upErr } = await service.from('gym_sending_domains').upsert(
      {
        gym_id: gymId,
        domain,
        from_local: fromLocal,
        resend_domain_id: record.id ?? null,
        status: mapResendStatus(record.status),
        records: record.records ?? [],
        last_checked_at: new Date().toISOString(),
        created_by: (await caller.auth.getUser()).data.user?.id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'gym_id' },
    );
    if (upErr) return json({ error: upErr.message }, 500);
    return json({
      ok: true,
      domain,
      from_local: fromLocal,
      status: mapResendStatus(record.status),
      records: record.records ?? [],
    });
  }

  // --- verify ------------------------------------------------------------
  if (action === 'verify') {
    if (!existing?.resend_domain_id) {
      return json({ error: 'Connect a domain first' }, 400);
    }
    // Trigger a verification attempt, then read the fresh state. The verify
    // call can 4xx if it's mid-check; we still GET the latest either way.
    await resend('POST', `/${existing.resend_domain_id}/verify`, RESEND_API_KEY);
    const got = await resend('GET', `/${existing.resend_domain_id}`, RESEND_API_KEY);
    if (!got.ok) {
      return json({ error: got.errorText || 'Could not read domain status.' }, 502);
    }
    const record = got.data ?? {};
    const status = mapResendStatus(record.status);
    const nowIso = new Date().toISOString();
    const { error: upErr } = await service
      .from('gym_sending_domains')
      .update({
        status,
        records: record.records ?? existing.records ?? [],
        last_checked_at: nowIso,
        verified_at:
          status === 'verified' ? existing.verified_at ?? nowIso : existing.verified_at,
        updated_at: nowIso,
      })
      .eq('gym_id', gymId);
    if (upErr) return json({ error: upErr.message }, 500);
    return json({ ok: true, status, records: record.records ?? existing.records ?? [] });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
