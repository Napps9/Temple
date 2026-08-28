-- What the site counts
--
-- jointemple.io has never recorded anything. There is one `<Analytics />`
-- from Vercel in the layout and not a single custom event; app/api/demo's
-- handler sends an email and stores nothing, so there is no server-side
-- record that a conversion has ever happened, and nothing that could
-- connect a booking to the visit that produced it. Every argument about the
-- site has therefore been an argument about page structure.
--
-- 0233 already decided the hard part of this. It counts which staff screens
-- get opened with no profile_id column, nothing written to any device, and
-- deliberately not behind the consent banner — the reasoning is in its
-- header, in docs/legal/lawful-basis-register.md item 6, and in
-- docs/legal/dpia.md. This extends the same posture to the marketing site,
-- and adds one thing 0233 did not need.
--
-- TWO LAYERS, BECAUSE ONE QUESTION NEEDS A NAME AND THE OTHER DOES NOT.
--
--   site_events is a rollup: an event, a day, a page, where they came from,
--   what they were on, and a count. It identifies nobody, leaves nothing on
--   any device, needs no banner, and covers every visitor. It answers "how
--   many reached each step".
--
--   site_visits is a timeline keyed by a visitor id, written ONLY for a
--   visitor who accepted the cookie banner. It answers "did the person who
--   reached Billing go on to book" — which is a different question, needs a
--   name to answer, and therefore needs consent. src/lib/cookie-consent.ts
--   has said since it was written that hasAnalyticsConsent() "is the gate
--   any future tracking init must check"; this is the first caller.
--
-- The rollup is not a log on purpose. A row per event carrying a timestamp
-- alongside source, device and page is a fingerprint; a count is not. Order
-- and timing live in site_visits, where a name is already attached and the
-- visitor agreed to it.
--
-- NO FOREIGN KEY TO gyms, ANYWHERE IN THIS FILE, AND THAT IS THE POINT.
-- The demo half of the funnel happens on tenants that are torn down and
-- reseeded every night at 03:00 (demo-marketing-rotate.yml), which deletes
-- the gym row and hands the replacement a new uuid. route_opens.gym_id is
-- `on delete cascade`, so a demo gym's rows there survive about a day and
-- cannot be joined across the boundary. These tables record the gym's SLUG,
-- which is stable across a reseed, and hold no reference that a cascade
-- could reach.
--
-- And demo tenants ONLY. record_demo_event refuses a gym that is not
-- is_demo (0278). That is what keeps 0233's promise intact: no table here
-- can ever become a record of which screens a real gym's staff opened,
-- whoever later decides they would like one.

begin;

-- ---------------------------------------------------------------------------
-- The vocabulary
-- ---------------------------------------------------------------------------
--
-- One place, used by both CHECK constraints, so the list cannot disagree
-- with itself. The marketing site mirrors it as a TypeScript union and
-- scripts/check-ia.mjs asserts the two agree — the same cross-repo mirror
-- problem as lib/demo-redirects.ts, and the same fix.
--
-- Two names people will look for and not find:
--
--   demo_stop_viewed is here, but demo_tour_completed is not. The site
--   cannot observe a tour stop — the stops happen inside the app, across an
--   origin the parent frame is not allowed to read — so "completed" is a
--   question asked of the data afterwards (a visitor with three or more
--   distinct stops), not a thing a client could know to send.

create function public.is_site_event(p_event text)
returns boolean
language sql
immutable
as $$
  select p_event in (
    'site_entered',
    'pricing_viewed',
    'switching_viewed',
    'comparison_viewed',
    'demo_started',
    'demo_authenticated',
    'demo_tour_started',
    'demo_stop_viewed',
    'demo_cta_clicked',
    'contact_cta_clicked',
    'book_demo_started',
    'book_demo_submitted'
  );
$$;

-- ---------------------------------------------------------------------------
-- Layer 1 — the rollup
-- ---------------------------------------------------------------------------

create table public.site_events (
  event  text    not null check (public.is_site_event(event)),
  day    date    not null,
  page   text    not null,
  source text    not null default 'direct',
  device text    not null check (device in ('mobile', 'desktop', 'app')),
  detail text    not null default '',
  count  integer not null default 0,
  primary key (event, day, page, source, device, detail)
);

create index site_events_day_idx on public.site_events (day desc, event);

alter table public.site_events enable row level security;
-- No policies at all, the same argument 0233 makes: the only writer is the
-- definer function below, so a count cannot be forged, inflated or quietly
-- edited from a client. Reading is a SQL question for now — there is no
-- screen, and inventing one before there are numbers in here would be
-- building a dashboard for an empty table.

-- ---------------------------------------------------------------------------
-- Layer 2 — the consented timeline
-- ---------------------------------------------------------------------------

create table public.site_visits (
  visitor     uuid        not null,
  event       text        not null check (public.is_site_event(event)),
  occurred_at timestamptz not null default now(),
  page        text        not null,
  source      text        not null default 'direct',
  device      text        not null check (device in ('mobile', 'desktop', 'app')),
  detail      text        not null default ''
);

create index site_visits_visitor_idx on public.site_visits (visitor, occurred_at);
create index site_visits_occurred_idx on public.site_visits (occurred_at desc);

alter table public.site_visits enable row level security;
-- Same: definer-only writes, no client policy.

-- ---------------------------------------------------------------------------
-- Writing one
-- ---------------------------------------------------------------------------

-- Bound and flatten anything a stranger controls. `source` comes from a
-- utm_source in a URL somebody else wrote, `page` from a path, `detail` from
-- a slug — all three are attacker-chosen text, and a client is not where
-- that rule gets enforced. Ids in a path are collapsed with the same three
-- regexes record_route_open uses (0233:91-97), so a page can never carry
-- one in through here either.
create function public._site_dimension(p_value text, p_fallback text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(
      regexp_replace(
        lower(left(trim(coalesce(p_value, '')), 80)),
        '[^a-z0-9/_.:\[\]-]', '', 'g'
      ),
      ''
    ),
    p_fallback
  );
$$;

create function public._record_site_event(
  p_event   text,
  p_page    text,
  p_source  text,
  p_device  text,
  p_detail  text,
  p_visitor uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_page   text;
  v_source text;
  v_device text;
  v_detail text;
begin
  -- Silent rather than raising, all the way down. Every caller is
  -- fire-and-forget from a click handler or a navigation effect, and an
  -- exception there is a broken page for the sake of a counter.
  if not public.is_site_event(p_event) then
    return;
  end if;

  v_page := public._site_dimension(p_page, '/');
  v_page := regexp_replace(
    v_page,
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    '/[id]', 'g');
  v_page := regexp_replace(v_page, '/[a-z0-9_-]{24,}', '/[id]', 'g');
  v_page := regexp_replace(v_page, '/[0-9]+', '/[id]', 'g');

  v_source := public._site_dimension(p_source, 'direct');
  v_detail := public._site_dimension(p_detail, '');
  v_device := public._site_dimension(p_device, 'desktop');
  if v_device not in ('mobile', 'desktop', 'app') then
    v_device := 'desktop';
  end if;

  insert into public.site_events (event, day, page, source, device, detail, count)
  values (p_event, (now() at time zone 'UTC')::date, v_page, v_source, v_device, v_detail, 1)
  on conflict (event, day, page, source, device, detail)
    do update set count = public.site_events.count + 1;

  -- The named half, only when the visitor said yes. A caller that passes no
  -- visitor is not a caller that failed to — it is a visitor who rejected
  -- the banner or never answered it, and the rollup above is all they get.
  if p_visitor is not null then
    insert into public.site_visits (visitor, event, page, source, device, detail)
    values (p_visitor, p_event, v_page, v_source, v_device, v_detail);
  end if;
end;
$$;

revoke execute on function public._record_site_event(text, text, text, text, text, uuid)
  from public, anon, authenticated;

-- The marketing site's writer. Granted to anon because the caller is a
-- stranger on a public page — the precedent is comms_track_event (0044),
-- the one analytics RPC already reachable that way. The anon key itself
-- never reaches a browser: the site posts to its own /api/events, which
-- calls this server-side.
--
-- Anyone who finds it can inflate a count. That is true of every web
-- analytics endpoint ever built, the blast radius is a wrong marketing
-- number, and the alternative is putting a service-role key on the
-- marketing site. Worth writing down rather than discovering later.
create function public.record_site_event(
  p_event   text,
  p_page    text,
  p_source  text default 'direct',
  p_device  text default 'desktop',
  p_detail  text default '',
  p_visitor uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._record_site_event(p_event, p_page, p_source, p_device, p_detail, p_visitor);
end;
$$;

grant execute on function public.record_site_event(text, text, text, text, text, uuid)
  to anon, authenticated;

-- The app's writer, for the half of the funnel that happens after sign-in.
-- Two things it does that the public one must not:
--
--   It refuses any gym that is not a demo tenant. Without that line this
--   table becomes a record of which screens a real gym's staff opened,
--   which is the exact thing 0233 was built not to be.
--
--   It resolves the gym's slug rather than storing its id, so a night's
--   teardown and reseed does not orphan the history.
create function public.record_demo_event(
  p_gym_id  uuid,
  p_event   text,
  p_page    text,
  p_visitor uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
begin
  if p_gym_id is null or not public.gym_is_demo(p_gym_id) then
    return;
  end if;
  select slug into v_slug from public.gyms where id = p_gym_id;
  if v_slug is null then
    return;
  end if;
  perform public._record_site_event(p_event, p_page, 'app', 'app', v_slug, p_visitor);
end;
$$;

grant execute on function public.record_demo_event(uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Ninety days
-- ---------------------------------------------------------------------------
--
-- The same window as route_opens, for the same reason: data kept past the
-- point it can answer anything is just data being kept. Named purge_expired_*
-- so supabase/tests/sweeps_are_cron_only.sql, which matches on
-- `proname like 'purge\_%'`, covers it without being edited.

create function public.purge_expired_site_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_events integer;
  v_visits integer;
begin
  with deleted as (
    delete from public.site_events where day < current_date - 90 returning 1
  )
  select count(*)::int into v_events from deleted;

  with deleted as (
    delete from public.site_visits
      where occurred_at < now() - interval '90 days' returning 1
  )
  select count(*)::int into v_visits from deleted;

  return v_events + v_visits;
end;
$$;

revoke execute on function public.purge_expired_site_events()
  from public, anon, authenticated;

-- 03:50 — 03:00 health, 03:20 chat turns, 03:30 leads, 03:40 route opens,
-- 03:45 auto-tags.
select cron.schedule(
  'purge-expired-site-events',
  '50 3 * * *',
  $$select public._log_cron_run('purge-expired-site-events',
      to_jsonb(public.purge_expired_site_events()));$$
);

commit;
