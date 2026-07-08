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
import { coerceDocument } from '../../src/lib/site-blocks';
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const pathParam = req.query.path;
  const segments = Array.isArray(pathParam) ? pathParam : pathParam ? [pathParam] : [];
  const slug = segments[0];
  // /site/<slug>[/<page-slug>] only — a third segment (or none) has
  // nothing to resolve to.
  if (!slug || segments.length > 2) {
    res.status(400).send(notFoundHtml());
    return;
  }
  const pageSlug = segments[1] ?? '';

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

    const [scheduleResult, plansResult, teamResult] = await Promise.all([
      supabase.rpc('gym_public_schedule', { p_slug: slug }),
      supabase.rpc('gym_public_plans', { p_slug: slug }),
      supabase.rpc('gym_public_team', { p_slug: slug }),
    ]);
    if (scheduleResult.error) throw scheduleResult.error;
    if (plansResult.error) throw plansResult.error;
    if (teamResult.error) throw teamResult.error;

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
      // Same hardcoded-fallback precedent as send-invite's origin.
      platformOrigin: 'https://app.jointemple.io',
      supabaseUrl,
      supabaseAnonKey,
      editable: false,
      pages: document.pages.map((p) => ({ slug: p.slug, title: p.title })),
      activePageSlug: page.slug,
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
