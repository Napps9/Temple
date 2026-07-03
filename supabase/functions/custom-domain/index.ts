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

// The platform's own domain — a gym must never "connect" it or any of
// its subdomains. Keep in sync with PLATFORM_HOSTS in middleware.ts,
// which uses the same value to route platform traffic past the
// custom-domain lookup.
const PLATFORM_APEX = 'jointemple.io';

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

type DnsRecord = { type: string; name: string; value: string; priority?: number; note?: string };

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
  const rawError = data?.error;
  const errorText =
    rawError?.message ??
    (typeof rawError === 'string' ? rawError : rawError?.code) ??
    text ??
    '';
  return {
    ok: res.ok,
    status: res.status,
    data,
    errorText: errorText.toString().slice(0, 500),
  };
}

// Vercel returns ownership-verification TXT records only when the domain
// needs them (e.g. it's already attached elsewhere), and routing records
// (A / CNAME) from the separate domain-config endpoint. Combined here into
// one flat list the UI renders as-is, same shape as gym_sending_domains.records.
//
// Both the A and the CNAME option are emitted, each named with the full
// connected domain, rather than guessing apex-vs-subdomain to pick one:
// label-count heuristics misclassify .co.uk apexes (mainstream for a
// UK/EU product) into a silently wrong single instruction, and a proper
// Public Suffix List is too heavy for an edge function. Offering both
// degrades gracefully — Vercel's anycast A record works for subdomains
// too, and registrars themselves reject a CNAME at an apex.
function buildRecords(domainData: any, configData: any, domain: string): DnsRecord[] {
  const records: DnsRecord[] = [];
  const verification = Array.isArray(domainData?.verification) ? domainData.verification : [];
  for (const v of verification) {
    if (v?.domain && v?.value) {
      records.push({ type: v.type ?? 'TXT', name: v.domain, value: v.value });
    }
  }
  // rank is a 1-based preference order — take the lowest-ranked entry of
  // each recommendation array (defensively sorted, not tested for === 1).
  const preferred = (arr: unknown): any => {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr.slice().sort((a, b) => (a?.rank ?? 99) - (b?.rank ?? 99))[0];
  };
  const ipv4 = preferred(configData?.recommendedIPv4);
  for (const value of ipv4?.value ?? []) {
    records.push({
      type: 'A',
      name: domain,
      value,
      note: `Use this if ${domain} is your root domain. Most registrars accept the full name or "@" as the host.`,
    });
  }
  const cname = preferred(configData?.recommendedCNAME);
  if (cname?.value) {
    records.push({
      type: 'CNAME',
      name: domain,
      value: cname.value,
      note: `Use this instead if ${domain} is a subdomain (like www.…). Registrars won't accept a CNAME on a root domain — use the A record there.`,
    });
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

  // --- disconnect ------------------------------------------------------------
  if (action === 'disconnect') {
    if (existing?.domain && VERCEL_API_TOKEN && VERCEL_PROJECT_ID) {
      const removed = await vercel(
        'DELETE',
        `/v9/projects/${VERCEL_PROJECT_ID}/domains/${encodeURIComponent(existing.domain)}`,
        VERCEL_API_TOKEN,
        VERCEL_TEAM_ID,
      );
      // 404 is fine — already gone on Vercel's side. Any other failure
      // keeps the local row so the gym can retry: silently deleting the
      // row while the domain stays attached to the Vercel project would
      // orphan it permanently, with no app-driven path to remove it.
      if (!removed.ok && removed.status !== 404) {
        return json(
          { error: 'Couldn’t remove the domain from our hosting provider — try again in a moment.' },
          502,
        );
      }
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
    if (domain === PLATFORM_APEX || domain.endsWith(`.${PLATFORM_APEX}`) || domain.endsWith('.vercel.app')) {
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
    const records = buildRecords(added.data, config.ok ? config.data : null, domain);
    // Vercel's `verified` only means the ownership challenge passed (true
    // immediately for any fresh domain) — "live" additionally requires the
    // config endpoint to confirm DNS routing (misconfigured === false).
    // A failed config read here just means 'pending', which is safe.
    const ownershipVerified = added.data?.verified === true;
    const live = ownershipVerified && config.ok && config.data?.misconfigured === false;
    const nowIso = new Date().toISOString();

    const { error: insErr } = await service.from('gym_website_domains').insert({
      gym_id: gymId,
      domain,
      status: live ? 'verified' : 'pending',
      records,
      error_message: null,
      last_checked_at: nowIso,
      verified_at: live ? nowIso : null,
      created_by: (await caller.auth.getUser()).data.user?.id ?? null,
    });
    if (insErr) {
      // Don't leave the domain attached to the Vercel project with no row
      // to manage it by — best-effort compensating delete before erroring.
      // Guarded on no OTHER row referencing this domain: if another gym
      // holds it (the domain-key 23505 case), the Vercel attachment is
      // theirs and deleting it would take their live site down.
      const { data: holder } = await service
        .from('gym_website_domains')
        .select('gym_id')
        .eq('domain', domain)
        .maybeSingle();
      if (!holder) {
        await vercel(
          'DELETE',
          `/v9/projects/${VERCEL_PROJECT_ID}/domains/${encodeURIComponent(domain)}`,
          VERCEL_API_TOKEN,
          VERCEL_TEAM_ID,
        );
      }
      if ((insErr as { code?: string }).code === '23505') {
        // Two constraints raise 23505: the domain unique index (another gym
        // holds this domain) and the gym_id primary key (this gym
        // double-connected concurrently) — tell them apart.
        const detail = `${insErr.message ?? ''} ${(insErr as { details?: string }).details ?? ''}`;
        return json(
          detail.includes('gym_website_domains_domain_key')
            ? { error: 'That domain is already connected to another site.' }
            : { error: 'A domain is already connected. Disconnect it first.' },
          409,
        );
      }
      return json({ error: insErr.message }, 500);
    }
    return json({
      ok: true,
      domain,
      status: live ? 'verified' : 'pending',
      records,
      ownership_verified: ownershipVerified,
      misconfigured: config.ok ? config.data?.misconfigured === true : null,
    });
  }

  // --- verify ----------------------------------------------------------------
  if (action === 'verify') {
    if (!existing) return json({ error: 'Connect a domain first' }, 400);

    const domainPath = `/v9/projects/${VERCEL_PROJECT_ID}/domains/${encodeURIComponent(existing.domain)}`;
    const [domainRes, config] = await Promise.all([
      vercel('GET', domainPath, VERCEL_API_TOKEN, VERCEL_TEAM_ID),
      vercel(
        'GET',
        `/v6/domains/${encodeURIComponent(existing.domain)}/config`,
        VERCEL_API_TOKEN,
        VERCEL_TEAM_ID,
      ),
    ]);

    // The one genuinely hard failure: the domain is no longer attached to
    // the Vercel project at all (removed externally). Recorded as 'error'
    // and answered with HTTP 200 — the client mutation only refetches the
    // row on success, so a 4xx here would leave the card showing stale
    // pending/verified state.
    if (domainRes.status === 404) {
      const message =
        'This domain is no longer attached to your site. Disconnect it below, then connect it again.';
      const nowIso = new Date().toISOString();
      const { error: upErr } = await service
        .from('gym_website_domains')
        .update({
          status: 'error',
          error_message: message,
          last_checked_at: nowIso,
          updated_at: nowIso,
        })
        .eq('gym_id', gymId);
      if (upErr) return json({ error: upErr.message }, 500);
      return json({ ok: true, status: 'error', error_message: message, records: existing.records });
    }

    // Never downgrade (or upgrade) on a non-authoritative read: a
    // transient Vercel failure while someone happens to click Verify must
    // not flip a live domain to pending and knock its routing out. State
    // only changes on authoritative 200s or the specific 404 above.
    if (!domainRes.ok) {
      return json({ error: domainRes.errorText || 'Could not read domain status.' }, 502);
    }
    if (!config.ok) {
      return json({ error: config.errorText || 'Could not read domain DNS configuration.' }, 502);
    }

    // Only trigger an ownership re-check when it hasn't passed — calling
    // POST /verify on an already-verified domain can flip it into a
    // transient state (same reasoning sending-domain applies to Resend).
    // The POST returns the domain object, so no third GET is needed; the
    // parallel config read stays valid since /verify only affects
    // ownership, not DNS routing.
    let domainData = domainRes.data;
    if (domainData?.verified !== true) {
      const verifyRes = await vercel('POST', `${domainPath}/verify`, VERCEL_API_TOKEN, VERCEL_TEAM_ID);
      if (verifyRes.ok && verifyRes.data) domainData = verifyRes.data;
    }

    // Vercel's `verified` covers ownership only; live additionally needs
    // DNS routing confirmed (misconfigured === false). A previously
    // verified domain whose DNS broke legitimately downgrades to pending
    // here; verified_at keeps its first-verified value as an audit trail.
    const ownershipVerified = domainData?.verified === true;
    const live = ownershipVerified && config.data?.misconfigured === false;
    const records = buildRecords(domainData, config.data, existing.domain);
    const finalRecords = records.length > 0 ? records : existing.records;
    const nowIso = new Date().toISOString();

    const { error: upErr } = await service
      .from('gym_website_domains')
      .update({
        status: live ? 'verified' : 'pending',
        records: finalRecords,
        error_message: null,
        last_checked_at: nowIso,
        verified_at: live ? existing.verified_at ?? nowIso : existing.verified_at,
        updated_at: nowIso,
      })
      .eq('gym_id', gymId);
    if (upErr) return json({ error: upErr.message }, 500);
    return json({
      ok: true,
      status: live ? 'verified' : 'pending',
      records: finalRecords,
      ownership_verified: ownershipVerified,
      misconfigured: config.data?.misconfigured === true,
    });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
