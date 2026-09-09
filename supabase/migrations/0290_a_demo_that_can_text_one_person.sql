-- A demo that can text one person
--
-- 0278 drew the line at "anything a third party observes", and its reason
-- was specific: jointemple.io publishes demo-launchpad's owner password to
-- anyone who loads the page, so a visitor holds all forty-three
-- capabilities and must not be able to put a message on a stranger's
-- handset.
--
-- That reason is about the destination. The flag it produced is about the
-- tenant. Two of the three demo tenants (demo-good-life,
-- demo-redline-hyrox) are opened by a person on a sales call, and the one
-- thing the AI front desk exists to do — text the prospect a link while
-- they are still on the phone — is exactly what cannot be shown on them.
-- A text that appears only in the Conversations thread is not the demo.
-- The handset buzzing is the demo.
--
-- So the destination becomes the unit. A demo gym may text a number
-- somebody has written down here, and no other. A visitor holding the
-- published password still cannot reach a stranger, because a stranger's
-- number is not on the list — which is the property 0278 was defending,
-- kept intact rather than traded away.
--
-- Three limits, all deliberate:
--
--   * SMS only. Email, Stripe and every other door 0278 closed stay shut.
--     _shared/demo.ts is still the inventory of what a demo gym may do;
--     this is one named exception inside it, not a general switch.
--
--   * Explicit numbers. No wildcards, and specifically not "any number
--     captured on this call" — that is the hole this is shaped to avoid.
--     Somebody has to name the handset before it can ring.
--
--   * They expire. A list of numbers a publicly-passworded tenant may
--     text is precisely the thing that gets added for one call and then
--     outlives everyone who remembers why, so thirty days is the default
--     and re-adding is one line.

begin;

create table public.demo_sms_allowlist (
  id         uuid primary key default gen_random_uuid(),
  gym_id     uuid not null references public.gyms(id) on delete cascade,
  phone      text not null check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  label      text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  unique (gym_id, phone)
);
alter table public.demo_sms_allowlist enable row level security;

comment on table public.demo_sms_allowlist is
  'Handsets a demo gym is allowed to really text, so the AI front desk can '
  'be demonstrated doing the thing it is for. Everything else a demo gym '
  'sends stays simulated — see supabase/functions/_shared/demo.ts.';

-- The predicate the sender asks. Anything unparseable, expired or absent
-- is false, so the demo gym falls back to simulating exactly as before.
create function public.demo_sms_allowed(p_gym_id uuid, p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.demo_sms_allowlist
    where gym_id = p_gym_id
      and phone = public._normalise_uk_phone(p_phone)
      and expires_at > now()
  );
$$;
revoke execute on function public.demo_sms_allowed(uuid, text)
  from public, anon, authenticated;
grant execute on function public.demo_sms_allowed(uuid, text) to service_role;

-- Adding one. Owner of that gym, normalised on the way in so a number
-- that cannot be dialled is refused where somebody is looking at it
-- rather than silently never matching at send time.
create function public.allow_demo_sms_number(
  p_gym_id uuid,
  p_phone  text,
  p_label  text default null,
  p_days   integer default 30
) returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e164    text := public._normalise_uk_phone(p_phone);
  v_expires timestamptz;
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can allow a number for demo texts';
  end if;
  if v_e164 is null then
    raise exception 'That does not look like a phone number';
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'Allow a number for between 1 and 90 days';
  end if;

  v_expires := now() + make_interval(days => p_days);
  insert into public.demo_sms_allowlist (gym_id, phone, label, created_by, expires_at)
  values (p_gym_id, v_e164, nullif(btrim(coalesce(p_label, '')), ''), auth.uid(), v_expires)
  on conflict (gym_id, phone) do update
    set label      = coalesce(excluded.label, public.demo_sms_allowlist.label),
        expires_at = excluded.expires_at;
  return v_expires;
end;
$$;
grant execute on function public.allow_demo_sms_number(uuid, text, text, integer)
  to authenticated;

commit;
