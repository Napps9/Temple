// Site builder — per-gym custom domain management.
//
// Backs the "Custom domain" card on Manage → Website → Domain. A gym
// connects a domain they own; we register it on Temple's own Vercel
// project (no per-gym OAuth needed — unlike Stripe Connect, this isn't a
// separate account per gym, just one platform API token), hand back the
// DNS records to add, and once DNS resolves, middleware.ts routes
// requests on that domain to the gym's published site.
//
// Actions (POST JSON { action, gym_id, domain? }):
//   connect     { domain } — register with Vercel, store DNS records
//   verify      — re-check Vercel, refresh status/records
//   disconnect  — remove from Vercel, clear the row
//
// Every action re-authorises the caller via effective_can(can_manage_website)
// for the target gym, and re-checks gyms.website_builder_enabled explicitly
// (the service client used for writes bypasses RLS, so that business gate
// has to be asserted here too — same rigor gym_public_schedule/
// gym_public_plans already apply to `published`). All Vercel-managed state
// is written here under the service role — the table has no client write
// policy.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
// Needs VERCEL_API_TOKEN + VERCEL_PROJECT_ID for everything except
// disconnect's local cleanup. VERCEL_TEAM_ID only if the project is
// team-scoped.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const VERCEL_BASE = 'https://api.vercel.com';

// Domains this feature must never let a gym "connect" — the platform's
// own app host and Vercel's own preview domain suffix.
const PLATFORM_HOSTS = new Set(['app.jointemple.io', 'jointemple.io']);

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
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');
}

type DnsRecord = { type: string; name: string; value: string; priority?: number };

type VercelResult = { ok: boolean; status: number; data: any; errorText: string };

async function vercel(
  method: string,
  path: string,
  token: string,
  teamId: string | undefined,
  body?: unknown,
): Promise<VercelResult> {
  const url = new URL(`${VERCEL_BASE}${path}`);
  if (teamId) url.searchParams.set('teamId', teamId);
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
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
    errorText: (data?.error?.message ?? data?.error ?? text ?? '').toString().slice(0, 500),
  };
}

// Vercel returns ownership-verification TXT records only when the domain
// needs them (e.g. it's already attached elsewhere), and routing records
// (A / CNAME) from the separate domain-config endpoint. Combined here into
// one flat list the UI renders as-is, same shape as gym_sending_domains.records.
function buildRecords(addData: any, configData: any): DnsRecord[] {
  const records: DnsRecord[] = [];
  const verification = Array.isArray(addData?.verification) ? addData.verification : [];
  for (const v of verification) {
    if (v?.domain && v?.value) {
      records.push({ type: v.type ?? 'TXT', name: v.domain, value: v.value });
    }
  }
  const ipv4 = Array.isArray(configData?.recommendedIPv4) ? configData.recommendedIPv4 : [];
  for (const rec of ipv4) {
    for (const value of rec?.value ?? []) {
      records.push({ type: 'A', name: '@', value });
    }
  }
  const cname = Array.isArray(configData?.recommendedCNAME) ? configData.recommendedCNAME : [];
  for (const rec of cname) {
    if (rec?.value) records.push({ type: 'CNAME', name: rec.rank === 0 ? '@' : 'www', value: rec.value });
  }
  return records;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const VERCEL_API_TOKEN = Deno.env.get('VERCEL_API_TOKEN');
  const VERCEL_PROJECT_ID = Deno.env.get('VERCEL_PROJECT_ID');
  const VERCEL_TEAM_ID = Deno.env.get('VERCEL_TEAM_ID') || undefined;
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: 'Function is not configured' }, 500);
  }

  let action: string | undefined;
  let gymId: string | undefined;
  let domainInput: string | undefined;
  try {
    const body = await req.json();
    action = body?.action;
    gymId = body?.gym_id;
    domainInput = body?.domain;
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  if (!action || !gymId) return json({ error: 'action and gym_id are required' }, 400);

  const authHeader = req.headers.get('Authorization') ?? '';
  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: allowed, error: aErr } = await caller.rpc('effective_can', {
    p_gym_id: gymId,
    p_capability: 'can_manage_website',
  });
  if (aErr || allowed !== true) return json({ error: 'Not authorised' }, 403);

  const { data: gym } = await service
    .from('gyms')
    .select('website_builder_enabled')
    .eq('id', gymId)
    .maybeSingle();
  if (!gym?.website_builder_enabled) {
    return json({ error: 'The website builder isn’t turned on for this gym' }, 403);
  }

  const { data: existing } = await service
    .from('gym_website_domains')
    .select('*')
    .eq('gym_id', gymId)
    .maybeSingle();

  // --- disconnect: always clears the local row (so a gym can never be stuck
  // with an un-removable domain), best-effort removing it on Vercel's side.
  if (action === 'disconnect') {
    if (existing?.domain && VERCEL_API_TOKEN && VERCEL_PROJECT_ID) {
      // 404 is fine — already gone on Vercel's side.
      await vercel(
        'DELETE',
        `/v9/projects/${VERCEL_PROJECT_ID}/domains/${encodeURIComponent(existing.domain)}`,
        VERCEL_API_TOKEN,
        VERCEL_TEAM_ID,
      );
    }
    const { error } = await service.from('gym_website_domains').delete().eq('gym_id', gymId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // Everything below needs Vercel.
  if (!VERCEL_API_TOKEN || !VERCEL_PROJECT_ID) {
    return json({ error: 'Custom domains aren’t configured yet' }, 503);
  }

  // --- connect -------------------------------------------------------------
  if (action === 'connect') {
    const domain = normalizeDomain(domainInput ?? '');
    if (!domain || !FQDN_RE.test(domain)) {
      return json({ error: 'That doesn’t look like a valid domain.' }, 400);
    }
    if (PLATFORM_HOSTS.has(domain) || domain.endsWith('.vercel.app')) {
      return json({ error: 'That domain is reserved.' }, 400);
    }
    if (existing) {
      return json({ error: 'A domain is already connected. Disconnect it first.' }, 409);
    }

    const added = await vercel(
      'POST',
      `/v10/projects/${VERCEL_PROJECT_ID}/domains`,
      VERCEL_API_TOKEN,
      VERCEL_TEAM_ID,
      { name: domain },
    );
    if (!added.ok) {
      return json(
        { error: added.errorText || 'Vercel rejected the domain.' },
        added.status === 409 ? 409 : added.status === 422 || added.status === 400 ? 400 : 502,
      );
    }

    const config = await vercel(
      'GET',
      `/v6/domains/${encodeURIComponent(domain)}/config`,
      VERCEL_API_TOKEN,
      VERCEL_TEAM_ID,
    );
    const records = buildRecords(added.data, config.ok ? config.data : null);
    const verified = added.data?.verified === true;
    const nowIso = new Date().toISOString();

    const { error: insErr } = await service.from('gym_website_domains').insert({
      gym_id: gymId,
      domain,
      status: verified ? 'verified' : 'pending',
      records,
      error_message: null,
      last_checked_at: nowIso,
      verified_at: verified ? nowIso : null,
      created_by: (await caller.auth.getUser()).data.user?.id ?? null,
    });
    if (insErr) {
      // Unique-violation: another gym already holds this domain (race, or
      // this gym re-adding one someone else grabbed a moment earlier).
      if ((insErr as { code?: string }).code === '23505') {
        return json({ error: 'That domain is already connected to another site.' }, 409);
      }
      return json({ error: insErr.message }, 500);
    }
    return json({ ok: true, domain, status: verified ? 'verified' : 'pending', records });
  }

  // --- verify ----------------------------------------------------------------
  if (action === 'verify') {
    if (!existing) return json({ error: 'Connect a domain first' }, 400);

    // Read current state first. Calling POST /verify on an already-verified
    // domain can flip it into a transient state — same reasoning
    // sending-domain applies to Resend — so only trigger a verify when it
    // isn't verified yet.
    let status = await vercel(
      'GET',
      `/v9/projects/${VERCEL_PROJECT_ID}/domains/${encodeURIComponent(existing.domain)}`,
      VERCEL_API_TOKEN,
      VERCEL_TEAM_ID,
    );
    if (!status.ok) {
      return json({ error: status.errorText || 'Could not read domain status.' }, 502);
    }
    if (status.data?.verified !== true) {
      await vercel(
        'POST',
        `/v9/projects/${VERCEL_PROJECT_ID}/domains/${encodeURIComponent(existing.domain)}/verify`,
        VERCEL_API_TOKEN,
        VERCEL_TEAM_ID,
      );
      status = await vercel(
        'GET',
        `/v9/projects/${VERCEL_PROJECT_ID}/domains/${encodeURIComponent(existing.domain)}`,
        VERCEL_API_TOKEN,
        VERCEL_TEAM_ID,
      );
      if (!status.ok) {
        return json({ error: status.errorText || 'Could not read domain status.' }, 502);
      }
    }

    const config = await vercel(
      'GET',
      `/v6/domains/${encodeURIComponent(existing.domain)}/config`,
      VERCEL_API_TOKEN,
      VERCEL_TEAM_ID,
    );
    const records = buildRecords(status.data, config.ok ? config.data : null);
    const verified = status.data?.verified === true;
    const nowIso = new Date().toISOString();

    const { error: upErr } = await service
      .from('gym_website_domains')
      .update({
        status: verified ? 'verified' : 'pending',
        records: records.length > 0 ? records : existing.records,
        error_message: null,
        last_checked_at: nowIso,
        verified_at: verified ? existing.verified_at ?? nowIso : existing.verified_at,
        updated_at: nowIso,
      })
      .eq('gym_id', gymId);
    if (upErr) return json({ error: upErr.message }, 500);
    return json({
      ok: true,
      status: verified ? 'verified' : 'pending',
      records: records.length > 0 ? records : existing.records,
    });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
