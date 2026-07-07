// Site builder — Pexels stock-photo search + save.
//
// Backs the "Search stock photos" button beside every image upload in
// the site editor. `search` proxies Pexels so the API key never reaches
// the client; `save` copies the one photo the user picked into the
// gym's own storage folder, so published sites serve from our bucket
// and never depend on Pexels being up.
//
// Actions (POST JSON { action, gym_id, ... }):
//   search { query, page? } — trimmed photo list from Pexels /v1/search
//   save   { photo_id }     — re-fetch the photo by id from Pexels,
//                             download Pexels' own src URL, copy into
//                             gym-website-assets/<gym_id>/
//
// `save` never fetches a client-supplied URL: the only client input
// that reaches Pexels is an integer photo id, and the download URL
// comes from Pexels' response for that id (host-pinned to
// images.pexels.com besides). Every action re-authorises the caller via
// effective_can(can_manage_website) and re-checks
// gyms.website_builder_enabled — the service client used for the
// storage write bypasses RLS, so the business gate has to be asserted
// here (same rigor as custom-domain).
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// SUPABASE_ANON_KEY. Needs PEXELS_API_KEY for everything — without it
// both actions answer 503 "not configured" and the editor degrades to
// upload-only.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const PEXELS_BASE = 'https://api.pexels.com/v1';
const PEXELS_IMAGE_HOST = 'images.pexels.com';
const BUCKET = 'gym-website-assets';

// Fixed server-side so a client can't inflate page size — rate-limit
// hygiene (the free key is 200 req/hour platform-wide) and Pexels'
// no-mass-downloading guideline in one.
const PER_PAGE = 24;
const MAX_DOWNLOAD_BYTES = 15_000_000;

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

type PexelsResult = { ok: boolean; status: number; data: any };

async function pexels(path: string, apiKey: string): Promise<PexelsResult> {
  const res = await fetch(`${PEXELS_BASE}${path}`, { headers: { Authorization: apiKey } });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

function pexelsFailure(r: PexelsResult): Response {
  if (r.status === 429) {
    return json({ error: 'Stock photo search is busy right now — try again in a few minutes.' }, 429);
  }
  return json({ error: 'Couldn’t reach the stock photo service — try again shortly.' }, 502);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const PEXELS_API_KEY = Deno.env.get('PEXELS_API_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: 'Function is not configured' }, 500);
  }

  let action: string | undefined;
  let gymId: string | undefined;
  let queryInput: unknown;
  let pageInput: unknown;
  let photoIdInput: unknown;
  try {
    const body = await req.json();
    action = body?.action;
    gymId = body?.gym_id;
    queryInput = body?.query;
    pageInput = body?.page;
    photoIdInput = body?.photo_id;
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  if (!action || !gymId) return json({ error: 'action and gym_id are required' }, 400);

  const authHeader = req.headers.get('Authorization') ?? '';
  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // effective_can's p_gym_id parameter is a uuid — a non-UUID gym_id
  // errors the RPC and 403s here, so by the time gymId prefixes a
  // storage path below it is guaranteed UUID-shaped (no traversal).
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

  if (!PEXELS_API_KEY) {
    return json({ error: 'Stock photos aren’t configured yet' }, 503);
  }

  // --- search ----------------------------------------------------------------
  if (action === 'search') {
    const query = typeof queryInput === 'string' ? queryInput.trim().slice(0, 100) : '';
    if (!query) return json({ error: 'query is required' }, 400);
    const pageNum = Number(pageInput ?? 1);
    const page = Number.isSafeInteger(pageNum) ? Math.min(Math.max(pageNum, 1), 50) : 1;

    // orientation=landscape: every slot this picker feeds (full-bleed
    // hero, about side image, gallery grid) renders wide.
    const r = await pexels(
      `/search?query=${encodeURIComponent(query)}&per_page=${PER_PAGE}&page=${page}&orientation=landscape`,
      PEXELS_API_KEY,
    );
    if (!r.ok) return pexelsFailure(r);

    const photos = (Array.isArray(r.data?.photos) ? r.data.photos : []).map((p: any) => ({
      id: p?.id,
      alt: typeof p?.alt === 'string' ? p.alt : '',
      photographer: p?.photographer ?? '',
      photographer_url: p?.photographer_url ?? '',
      thumb: p?.src?.medium ?? p?.src?.small ?? '',
      avg_color: typeof p?.avg_color === 'string' ? p.avg_color : '#e5e7eb',
    }));
    return json({ photos, page, has_more: Boolean(r.data?.next_page) });
  }

  // --- save ------------------------------------------------------------------
  if (action === 'save') {
    const photoId = Number(photoIdInput);
    if (!Number.isSafeInteger(photoId) || photoId <= 0) {
      return json({ error: 'photo_id must be a positive integer' }, 400);
    }

    const r = await pexels(`/photos/${photoId}`, PEXELS_API_KEY);
    if (r.status === 404) {
      return json({ error: 'That photo is no longer available on Pexels.' }, 404);
    }
    if (!r.ok) return pexelsFailure(r);

    // large2x is `original` re-served through Pexels' resizer at 1880px
    // with auto=compress — hero-quality at a few hundred KB, where
    // original can be 6000px+ and many MB for no visual gain at web
    // sizes.
    const srcUrl: string | undefined =
      r.data?.src?.large2x ?? r.data?.src?.large ?? r.data?.src?.original;
    if (!srcUrl) return json({ error: 'Unexpected photo source' }, 502);
    try {
      if (new URL(srcUrl).hostname !== PEXELS_IMAGE_HOST) {
        return json({ error: 'Unexpected photo source' }, 502);
      }
    } catch {
      return json({ error: 'Unexpected photo source' }, 502);
    }

    const dl = await fetch(srcUrl);
    if (!dl.ok) return json({ error: 'Couldn’t download the photo from Pexels.' }, 502);
    const declaredLength = Number(dl.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_DOWNLOAD_BYTES) {
      return json({ error: 'That photo is too large to import.' }, 502);
    }
    const bytes = new Uint8Array(await dl.arrayBuffer());
    if (bytes.byteLength > MAX_DOWNLOAD_BYTES) {
      return json({ error: 'That photo is too large to import.' }, 502);
    }
    const headerType = dl.headers.get('content-type') ?? '';
    const contentType = headerType.startsWith('image/') ? headerType : 'image/jpeg';

    // Service role bypasses the bucket's folder-scoped insert policy —
    // the authorisation for this write IS the effective_can +
    // website_builder_enabled checks above, plus the UUID-guaranteed
    // gymId prefix.
    const path = `${gymId}/pexels-${photoId}-${Date.now()}.jpg`;
    const { error: upErr } = await service.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: false });
    if (upErr) return json({ error: upErr.message }, 500);

    const { data: pub } = service.storage.from(BUCKET).getPublicUrl(path);
    return json({
      url: pub.publicUrl,
      alt: typeof r.data?.alt === 'string' ? r.data.alt : '',
      photographer: r.data?.photographer ?? '',
      photographer_url: r.data?.photographer_url ?? '',
    });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
