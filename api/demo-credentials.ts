// Serves the current login for the public marketing demo tenant
// (demo-launchpad) to the marketing site's "Launch your gym" section.
// Kept in sync with the real seeded accounts by the nightly
// demo-marketing-rotate workflow, via publish-demo-credentials.ts.
//
// Same standalone-Vercel-function reasoning as api/site/[...path].ts:
// relative imports (not `@/`), own minimal anon-key client rather than
// src/lib/supabase.ts (that pulls in RN-only polyfills). Uses the anon
// key deliberately — this endpoint only ever reads, never writes.
//
// Takes zero request parameters on purpose: the RPC always returns the
// single most-recently-rotated row, so there's no slug/id a caller could
// pass to fish for a different tenant's data. That's the real
// abuse-resistance property here, more than any rate limit would add —
// see demo_marketing_credentials() in migration 0122.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '../src/types/database';

// Origins allowed to read this — the production marketing site only.
// Not '*': no reason to widen this beyond the one caller, even though
// the data itself is deliberately public. TODO: add the marketing
// site's actual Vercel preview-deployment domain pattern here once
// confirmed, so preview builds can exercise this endpoint too.
const ALLOWED_ORIGINS = new Set([
  'https://jointemple.io',
  'https://www.jointemple.io',
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).json({ error: 'server misconfigured' });
    return;
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  });

  try {
    const { data, error } = await supabase.rpc('demo_marketing_credentials');
    if (error) throw error;
    const row = data?.[0];
    if (!row) {
      res.status(404).json({ error: 'no demo tenant published yet' });
      return;
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // Short cache with background revalidation, same as api/site: the
    // primary abuse-resistance mechanism for this endpoint — Vercel's
    // edge cache absorbs repeat traffic before it ever reaches the RPC.
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.status(200).json({
      slug: row.slug,
      gymName: row.gym_name,
      owner: { email: row.owner_email, password: row.owner_password },
      member: { email: row.member_email, password: row.member_password },
      rotatedAt: row.rotated_at,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('demo credentials fetch failed', e);
    res.status(500).json({ error: 'something went wrong' });
  }
}
