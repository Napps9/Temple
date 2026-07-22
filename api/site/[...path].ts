// Public, unauthenticated route for a gym's published website —
// /site/<slug> for the home page, /site/<slug>/<page-slug> for every
// other page, both rewritten here from vercel.json. A catch-all
// function (not a plain [slug].ts) so one file serves both shapes
// without duplicating the gym/schedule/plans/team fetch — Vercel
// passes every path segment after /site/ as req.query.path.
// Deliberately a standalone Vercel Serverless Function, not an Expo Router screen:
// Expo Router in this project is static-export only and doesn't
// support per-route server rendering (confirmed before building this),
// so a normal app route would ship an empty HTML shell to crawlers —
// exactly the SEO failure mode that sank a competitor's launch. This
// function renders real HTML server-side on every request instead.
//
// Uses relative imports rather than the `@/` alias on purpose: this
// runs through Vercel's own Node function bundler, not Metro/Expo's,
// so it shouldn't depend on tsconfig path aliases resolving the same
// way there. It also can't import src/lib/supabase.ts — that client
// pulls in react-native-url-polyfill and AsyncStorage, neither of
// which exist in a Node serverless runtime — so this builds its own
// minimal, unauthenticated client instead.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

import { composeThemeWithBrand, BRAND_THEMES, isThemeId } from '../../src/lib/brand-themes';
import { coerceDocument, findStructuredAddress } from '../../src/lib/site-blocks';
import {
  renderSiteHtml,
  type PublicPlan,
  type ScheduleSession,
  type TeamMember,
} from '../../src/lib/site-render';
import type { Database } from '../../src/types/database';

function notFoundHtml(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Page not found</title><meta name="robots" content="noindex"></head><body style="font-family:-apple-system,sans-serif;text-align:center;padding:80px 20px;color:#334155;"><h1>This page isn't available.</h1><p>The site you're looking for may not be published yet.</p></body></html>`;
}

// req.query.path is meant to be populated automatically for this
// catch-all route, but has been observed coming back empty when the
// request arrives via the /site/:path* -> /api/site/:path* rewrite in
// vercel.json (confirmed in production: every /site/<slug> request,
// including tenants that long predate this comment, returned 400).
// Parsing the segments directly from the actual invoked URL sidesteps
// whatever is breaking Vercel's automatic query population, without
// removing it — req.query.path is tried first so this is a no-op if
// that mechanism is ever working correctly again.
//
// req.url's exact shape here has been observed to vary (sometimes the
// pre-rewrite /site/<slug> path, sometimes the post-rewrite
// /api/site/<slug> path) — stripping only a fixed "/api/site/" prefix
// left the wrong segment as the slug when req.url turned out to still
// be the pre-rewrite path. Stripping any leading "api"/"site" tokens
// (in whatever combination is actually present) is robust to both.
function segmentsFromUrl(url: string | undefined): string[] {
  if (!url) return [];
  const pathname = url.split('?')[0];
  const parts = pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  while (parts.length && (parts[0] === 'api' || parts[0] === 'site')) {
    parts.shift();
  }
  return parts;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const pathParam = req.query.path;
  const querySegments = Array.isArray(pathParam) ? pathParam : pathParam ? [pathParam] : [];
  const segments = querySegments.length > 0 ? querySegments : segmentsFromUrl(req.url);
  const slug = segments[0];
  // /site/<slug>[/<page-slug>] only — a third segment (or none) has
  // nothing to resolve to.
  if (!slug || segments.length > 2) {
    res.status(400).send(notFoundHtml());
    return;
  }
  // Vercel compiles the catch-all `api/site/[...path]` into a
  // single-segment matcher (^/api/site/([^/]+)$), so a rewritten
  // /site/<slug>/<page-slug> two-segment path never reaches this
  // function — it 404s at the edge. vercel.json therefore rewrites the
  // page shape to /api/site/<slug>?page=<page-slug>, keeping the path to
  // one segment; the page arrives here as a query param. segments[1] is
  // kept as a fallback for the (currently unroutable) two-segment path.
  const pageParam = req.query.page;
  const pageFromQuery = Array.isArray(pageParam) ? pageParam[0] : pageParam;
  const pageSlug = pageFromQuery ?? segments[1] ?? '';

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).send('Server misconfigured.');
    return;
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  });

  try {
    const { data: siteRows, error: siteError } = await supabase.rpc('gym_website_by_slug', {
      p_slug: slug,
    });
    if (siteError) throw siteError;
    const site = siteRows?.[0];
    if (!site) {
      res.status(404).send(notFoundHtml());
      return;
    }

    const [scheduleResult, plansResult, teamResult, canonicalDomainResult] = await Promise.all([
      supabase.rpc('gym_public_schedule', { p_slug: slug }),
      supabase.rpc('gym_public_plans', { p_slug: slug }),
      supabase.rpc('gym_public_team', { p_slug: slug }),
      supabase.rpc('gym_website_canonical_domain', { p_slug: slug }),
    ]);
    if (scheduleResult.error) throw scheduleResult.error;
    if (plansResult.error) throw plansResult.error;
    if (teamResult.error) throw teamResult.error;
    if (canonicalDomainResult.error) throw canonicalDomainResult.error;

    const schedule: ScheduleSession[] = (scheduleResult.data ?? []).map((s) => ({
      sessionId: s.session_id,
      startsAt: s.starts_at,
      durationMinutes: s.duration_minutes,
      classTypeName: s.class_type_name,
      classTypeColor: s.class_type_color,
      coachName: s.coach_name,
    }));
    const plans: PublicPlan[] = (plansResult.data ?? []).map((p) => ({
      planId: p.plan_id,
      name: p.name,
      kind: p.kind,
      creditCount: p.credit_count,
      monthlyPriceCents: p.monthly_price_cents,
    }));
    const team: TeamMember[] = (teamResult.data ?? []).map((m) => ({
      profileId: m.profile_id,
      fullName: m.full_name ?? 'Team member',
      avatarUrl: m.avatar_url,
    }));

    const themeId = isThemeId(site.theme) ? site.theme : 'forged';
    const theme = composeThemeWithBrand(BRAND_THEMES[themeId], site.gym_primary_color);
    const document = coerceDocument(site.design);
    // Home's slug is always '' (coerceDocument forces it), so the
    // no-second-segment case (pageSlug === '') resolves to home here
    // with no special-casing needed.
    const page = document.pages.find((p) => p.slug === pageSlug);
    if (!page) {
      res.status(404).send(notFoundHtml());
      return;
    }

    const platformOrigin = (process.env.APP_ORIGIN ?? 'https://app.jointemple.io').replace(/\/+$/, '');
    // Home is the only page a connected custom domain actually serves
    // (middleware.ts only rewrites that domain's bare root) — a non-home
    // page has just one real URL today, so it's self-canonical. Without
    // this, the platform path stays live and indexable alongside the
    // custom domain with nothing telling a crawler which one is
    // authoritative.
    const canonicalUrl =
      pageSlug === ''
        ? canonicalDomainResult.data
          ? `https://${canonicalDomainResult.data}`
          : `${platformOrigin}/site/${encodeURIComponent(slug)}`
        : `${platformOrigin}/site/${encodeURIComponent(slug)}/${encodeURIComponent(pageSlug)}`;

    const html = renderSiteHtml(page.blocks, {
      slug,
      gymName: site.gym_name,
      gymLogoUrl: site.gym_logo_url,
      gymCurrency: site.gym_currency,
      theme,
      schedule,
      plans,
      team,
      now: new Date().toISOString(),
      // Env-driven with the prod apex as fallback, matching the edge
      // functions' APP_ORIGIN convention — so a preview/staging deploy
      // renders links to its own origin rather than production.
      platformOrigin,
      supabaseUrl,
      supabaseAnonKey,
      editable: false,
      pages: document.pages.map((p) => ({
        slug: p.slug,
        title: p.title,
        metaDescription: p.metaDescription,
      })),
      activePageSlug: page.slug,
      structuredAddress: findStructuredAddress(document),
      canonicalUrl,
      searchConsoleVerification: document.settings.searchConsoleVerification,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Short cache with background revalidation: fresh enough that a
    // schedule/pricing edit shows up quickly, cheap enough that repeat
    // crawler/visitor hits don't hammer the database.
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.status(200).send(html);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('gym website render failed', e);
    res.status(500).send('Something went wrong rendering this page.');
  }
}
