// Drains agent_storage_purge_queue: deletes the queued recording objects
// through the Storage API (the only sanctioned deletion path — direct SQL
// deletes from storage.objects are blocked by storage.protect_delete) and
// clears queue rows that were actually removed. Idempotent and self-healing:
// anything that fails stays queued for the next nightly poke from the
// retention sweeps.
//
// Guard: x-purge-secret header must match PURGE_STORAGE_SECRET (the same
// value the SQL side reads from Vault as agent_storage_purge_secret —
// mirrors the security-alert pairing).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PURGE_STORAGE_SECRET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const SECRET = Deno.env.get('PURGE_STORAGE_SECRET');
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'Function is not configured' }, 500);
  }
  if (!SECRET || req.headers.get('x-purge-secret') !== SECRET) {
    return json({ error: 'Not authorised' }, 403);
  }

  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: rows, error } = await service
    .from('agent_storage_purge_queue')
    .select('id, bucket, path')
    .order('created_at')
    .limit(500);
  if (error) return json({ error: error.message }, 500);

  const byBucket = new Map<string, { id: string; path: string }[]>();
  for (const r of (rows ?? []) as { id: string; bucket: string; path: string }[]) {
    const list = byBucket.get(r.bucket) ?? [];
    list.push({ id: r.id, path: r.path });
    byBucket.set(r.bucket, list);
  }

  let removed = 0;
  for (const [bucket, items] of byBucket) {
    const { error: rmErr } = await service.storage
      .from(bucket)
      .remove(items.map((i) => i.path));
    // remove() succeeds for already-missing objects, so a clean call means
    // every queued row in this batch is safe to clear.
    if (rmErr) {
      console.error('storage remove failed', bucket, rmErr.message);
      continue;
    }
    const { error: delErr } = await service
      .from('agent_storage_purge_queue')
      .delete()
      .in('id', items.map((i) => i.id));
    if (delErr) console.error('queue clear failed', delErr.message);
    else removed += items.length;
  }

  return json({ removed, pending: (rows?.length ?? 0) - removed });
});
