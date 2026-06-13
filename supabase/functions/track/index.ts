// Communications Suite — public tracking endpoint.
//
// Three GET surfaces, distinguished by the `e` query param. Every link a
// delivered email carries points here; the recipient id (`r`) is an
// unguessable uuid, the capability-URL model email open tracking has
// always used.
//
//   e=o  open pixel    → records an open, returns a 1x1 transparent GIF
//   e=c  click         → records a click, 302-redirects to `u`
//   e=u  unsubscribe   → records the opt-out + suppression, shows a page
//
// Writes go through the comms_track_event RPC (atomic increments, one
// recipient only). verify_jwt is off for this function (see config.toml)
// because inboxes fetch these unauthenticated.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// 1x1 transparent GIF.
const PIXEL = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (c) => c.charCodeAt(0),
);

function pixelResponse(): Response {
  return new Response(PIXEL, {
    headers: {
      'content-type': 'image/gif',
      'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      pragma: 'no-cache',
      expires: '0',
    },
  });
}

function unsubscribePage(ok: boolean): Response {
  const body = ok
    ? `<h1>You're unsubscribed</h1><p>You won't receive any more marketing emails from this gym. You can ask a staff member to re-subscribe you at any time.</p>`
    : `<h1>Something went wrong</h1><p>We couldn't process that unsubscribe link. It may have expired.</p>`;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title></head><body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#F1F5F9;color:#0F172A;"><div style="max-width:480px;margin:64px auto;padding:32px;background:#fff;border-radius:12px;text-align:center;">${body}</div></body></html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function safeRedirectTarget(raw: string | null): string {
  if (!raw) return '/';
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {
    // not an absolute URL — fall through
  }
  return '/';
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const event = url.searchParams.get('e');
  const campaignId = url.searchParams.get('c');
  const recipientId = url.searchParams.get('r');

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const service =
    SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY) : null;

  async function record(kind: string, eventUrl: string | null = null) {
    if (!service || !campaignId || !recipientId) return;
    try {
      await service.rpc('comms_track_event', {
        p_campaign_id: campaignId,
        p_recipient_id: recipientId,
        p_kind: kind,
        p_url: eventUrl,
      });
    } catch {
      // Tracking is best-effort — never block the pixel / redirect on a
      // write failure.
    }
  }

  if (event === 'o') {
    await record('open');
    return pixelResponse();
  }

  if (event === 'c') {
    const target = safeRedirectTarget(url.searchParams.get('u'));
    await record('click', target);
    return Response.redirect(target, 302);
  }

  if (event === 'u') {
    await record('unsubscribe');
    return unsubscribePage(Boolean(campaignId && recipientId));
  }

  return new Response('Not found', { status: 404 });
});
