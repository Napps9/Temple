// Phase 1 / Track G: CSV exports (§6.2).
//
// Owner-only. Returns CSV inline as text/csv with a Content-Disposition
// hint so browsers prompt to save. Sprint 5 supports two kinds:
//
//   members        — full_name, email, role, joined_at, current_plan_status,
//                    current_plan_name
//   subscriptions  — full_name, plan_name, status, paid_period_end,
//                    billing_interval, monthly_price_cents
//
// Async Supabase Storage delivery for >10k rows is the next
// refinement; for now we cap at 5,000 rows and stream the response.

import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, content-type',
};

const MAX_ROWS = 5000;
type Kind = 'members' | 'subscriptions';

type Body = { gymId?: string; kind?: Kind };

function bad(status: number, msg: string) {
  return new Response(msg, { status, headers: corsHeaders });
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return bad(405, 'method not allowed');

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return bad(401, 'missing auth');

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return bad(400, 'invalid json');
  }
  const { gymId, kind } = body;
  if (!gymId || !kind) return bad(400, 'missing gymId or kind');
  if (kind !== 'members' && kind !== 'subscriptions') {
    return bad(400, `unsupported kind: ${kind}`);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userResp, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userResp.user) return bad(401, 'unauthorized');

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Owner-only — mirrors can_see_money capability.
  const { data: membership } = await supabase
    .from('gym_memberships')
    .select('role')
    .eq('gym_id', gymId)
    .eq('profile_id', userResp.user.id)
    .maybeSingle();
  if (membership?.role !== 'owner') return bad(403, 'owner only');

  const filenameDate = new Date().toISOString().slice(0, 10);
  const filename = `${kind}-${filenameDate}.csv`;

  let csv = '';

  if (kind === 'members') {
    const { data, error } = await supabase
      .from('gym_memberships')
      .select(
        'role, created_at, profiles!gym_memberships_profile_id_fkey(full_name, phone), plan_subscriptions(status, plan:membership_plans(name))',
      )
      .eq('gym_id', gymId)
      .limit(MAX_ROWS);
    if (error) return bad(500, `db: ${error.message}`);

    csv = csvRow([
      'full_name',
      'phone',
      'role',
      'joined_at',
      'current_plan_status',
      'current_plan_name',
    ]) + '\n';

    type Row = {
      role: string;
      created_at: string;
      profiles: { full_name: string | null; phone: string | null } | null;
      plan_subscriptions: { status: string; plan: { name: string } | null }[];
    };

    for (const row of (data ?? []) as unknown as Row[]) {
      const ranked = row.plan_subscriptions ?? [];
      const primary = ranked.find((p) => p.status === 'active')
                   ?? ranked.find((p) => p.status === 'paused')
                   ?? ranked.find((p) => p.status === 'cancelled_at_period_end')
                   ?? ranked[0]
                   ?? null;
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      csv += csvRow([
        profile?.full_name ?? '',
        profile?.phone ?? '',
        row.role,
        row.created_at,
        primary?.status ?? '',
        primary?.plan?.name ?? '',
      ]) + '\n';
    }
  } else {
    const { data, error } = await supabase
      .from('plan_subscriptions')
      .select(
        'status, paid_period_end, billing_interval, profiles!plan_subscriptions_profile_id_fkey(full_name), plan:membership_plans(name, monthly_price_cents)',
      )
      .eq('gym_id', gymId)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS);
    if (error) return bad(500, `db: ${error.message}`);

    csv = csvRow([
      'full_name',
      'plan_name',
      'status',
      'paid_period_end',
      'billing_interval',
      'monthly_price_cents',
    ]) + '\n';

    type Row = {
      status: string;
      paid_period_end: string | null;
      billing_interval: string | null;
      profiles: { full_name: string | null } | null;
      plan: { name: string; monthly_price_cents: number | null } | null;
    };

    for (const row of (data ?? []) as unknown as Row[]) {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      const plan = Array.isArray(row.plan) ? row.plan[0] : row.plan;
      csv += csvRow([
        profile?.full_name ?? '',
        plan?.name ?? '',
        row.status,
        row.paid_period_end ?? '',
        row.billing_interval ?? '',
        plan?.monthly_price_cents ?? '',
      ]) + '\n';
    }
  }

  return new Response(csv, {
    status: 200,
    headers: {
      ...corsHeaders,
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
});
