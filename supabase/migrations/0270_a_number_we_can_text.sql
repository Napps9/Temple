-- A number we can text, and permission to use it
--
-- Nothing in this product has ever sent a member a text. Before anything
-- can, three things have to be true that are not true today.
--
-- THE GYM'S NUMBER HAS TO BE ABLE TO CARRY SMS. It cannot. Provisioning
-- buys a UK *local* number — the deliberate "option A, voice-first"
-- decision in docs/ai-front-desk-provisioning.md — and a UK local number
-- is voice-only. So provisioning starts asking Twilio for a mobile number
-- that does both, and records what it actually bought rather than
-- assuming: sms_capable comes off the purchased number's capabilities,
-- not off our intent. Every gym provisioned before today backfills false,
-- which is the truth about their number, and member SMS simply stays dark
-- for them until they take one that can text.
--
-- WE HAVE TO HOLD A NUMBER WE CAN DIAL. member_contact_details.phone is
-- free text: no validation, no normalisation, no country code. src/lib/
-- phone.ts has had toE164UK since the Vapi interview flow and has never
-- once been called. So phone_e164 sits beside phone rather than replacing
-- it — the member typed "07717 503791" and staff should keep seeing that,
-- while the sender gets "+447717503791" or nothing at all. Normalising in
-- place would throw away what somebody actually wrote the first time it
-- failed to parse.
--
-- AND THE MEMBER HAS TO HAVE ASKED. sms_opt_in defaults false and is the
-- member's own, exactly like appear_in_leaderboards (0028), which is the
-- same shape of decision: a per-member, per-gym answer to "may the gym do
-- this with you". Opt-in rather than opt-out because a text is more
-- intrusive than an email, PECR wants an answer either way, and paying
-- for messages nobody asked for is the expensive way to find that out.

begin;

-- ============================================================================
-- 1. A number that can carry a text
-- ============================================================================

alter table public.gym_agent_settings
  add column if not exists sms_capable boolean not null default false;

comment on column public.gym_agent_settings.sms_capable is
  'Whether the provisioned number can actually send SMS, read from '
  'Twilio''s capabilities at purchase. UK local numbers (every gym '
  'provisioned before 0270) cannot; UK mobile numbers can.';

-- ============================================================================
-- 2. A number we can dial
-- ============================================================================

-- The SQL half of toE164UK (src/lib/phone.ts). Returns null rather than a
-- guess: a number we cannot parse is one we must not text, and null says
-- so where a passthrough would look like success.
create or replace function public._normalise_uk_phone(p_input text)
returns text
language plpgsql
immutable
as $$
declare
  v text := regexp_replace(coalesce(p_input, ''), '[\s()\-\.]', '', 'g');
begin
  if v = '' then
    return null;
  end if;
  if left(v, 1) = '0' then
    v := '+44' || substr(v, 2);
  elsif left(v, 2) = '44' then
    v := '+' || v;
  end if;
  if v ~ '^\+[1-9][0-9]{6,14}$' then
    return v;
  end if;
  return null;
end;
$$;

alter table public.member_contact_details
  add column if not exists phone_e164 text
    check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$');

comment on column public.member_contact_details.phone_e164 is
  'The dialable form of phone, or null when what the member typed cannot '
  'be parsed. phone keeps what they actually wrote — staff should see '
  'that, and a sender should never guess.';

update public.member_contact_details
   set phone_e164 = public._normalise_uk_phone(phone)
 where phone is not null and phone_e164 is null;

-- The write goes through a function now, so the two columns cannot drift
-- and an unusable number is refused where the member can still see the
-- field rather than silently dropped at send time months later.
create or replace function public.set_my_contact_phone(p_phone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_trim text := nullif(trim(coalesce(p_phone, '')), '');
  v_e164 text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  if v_trim is not null then
    v_e164 := public._normalise_uk_phone(v_trim);
    if v_e164 is null then
      raise exception 'That does not look like a phone number';
    end if;
  end if;

  insert into public.member_contact_details (profile_id, phone, phone_e164, updated_at)
  values (v_uid, v_trim, v_e164, now())
  on conflict (profile_id) do update
    set phone      = excluded.phone,
        phone_e164 = excluded.phone_e164,
        updated_at = now();
end;
$$;

revoke all on function public.set_my_contact_phone(text) from public, anon;
grant execute on function public.set_my_contact_phone(text) to authenticated;

-- ============================================================================
-- 3. Permission
-- ============================================================================

alter table public.gym_memberships
  add column if not exists sms_opt_in boolean not null default false;

comment on column public.gym_memberships.sms_opt_in is
  'The member asked to be texted by this gym. Defaults false and is set '
  'only by the member — a text is more intrusive than an email and PECR '
  'wants an answer either way.';

create or replace function public.set_my_sms_opt_in(
  p_gym_id uuid,
  p_value  boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  update public.gym_memberships
    set sms_opt_in = p_value
    where gym_id = p_gym_id
      and profile_id = v_uid;
end;
$$;

revoke all on function public.set_my_sms_opt_in(uuid, boolean) from public, anon;
grant execute on function public.set_my_sms_opt_in(uuid, boolean) to authenticated;

-- A member cannot read gym_agent_settings (its select policy is
-- user_can_assign_plan), so the switch has to be told why it is off by
-- something that can. Three facts, no settings.
create or replace function public.my_sms_readiness(p_gym_id uuid)
returns table (
  opted_in     boolean,
  has_phone    boolean,
  gym_can_text boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(gm.sms_opt_in, false),
    exists (
      select 1 from public.member_contact_details c
      where c.profile_id = auth.uid() and c.phone_e164 is not null
    ),
    coalesce(s.sms_capable, false) and coalesce(s.enabled, false)
  from public.gym_memberships gm
  left join public.gym_agent_settings s on s.gym_id = gm.gym_id
  where gm.gym_id = p_gym_id
    and gm.profile_id = auth.uid()
    and gm.left_at is null;
$$;

revoke all on function public.my_sms_readiness(uuid) from public, anon;
grant execute on function public.my_sms_readiness(uuid) to authenticated;

commit;
