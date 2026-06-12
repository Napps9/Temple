-- Waivers — uploaded-PDF health/liability screening with a drawn
-- signature, sitting alongside the question-by-question PAR-Q.
--
-- Why: most gyms already have a liability waiver as a PDF. Forcing
-- them to rebuild it as a PAR-Q questionnaire is friction; letting
-- them upload the PDF and collect a drawn signature is the path of
-- least resistance to "a gym is screened and can go live". The PAR-Q
-- builder (0032) stays as an optional extra for gyms that want
-- structured, flaggable health questions.
--
-- Shape mirrors PAR-Q deliberately so the gates compose:
--   waiver_documents  - one row per (gym, version). Publishing a new
--     version flips the prior active off; existing signatures stay
--     tied to the exact PDF the member signed. is_active marks the
--     version new signers must sign.
--   waiver_signatures - one row per (member, waiver). The drawn
--     signature is stored as vector stroke data (an array of SVG path
--     `d` strings + the capture box) in `signature`, so it renders
--     back identically on web + native with react-native-svg and
--     needs no second image upload. No annual expiry (unlike PAR-Q) —
--     a signature is valid until the gym publishes a new version.
--
-- Gating (see _book_class_for change below): a gym with an active
-- waiver requires a current signature before booking, AND a gym with
-- an active PAR-Q requires a current response — both, when both are
-- published. A gym needs only one of the two to satisfy the setup
-- checklist (get_gym_setup_progress, broadened below).
--
-- Retention note: a signed waiver is a contract / liability record,
-- not special-category health data. It is deliberately NOT swept by
-- _erase_member_health_data / purge_expired_health_data — the lawful
-- basis for keeping it is the establishment/defence of legal claims,
-- which survives a member leaving. The composite FK is ON DELETE
-- CASCADE only against the membership row, which is soft-deleted
-- (left_at), so signatures persist after a member leaves.

begin;

-- ============================================================================
-- 1. waiver_documents
-- ============================================================================

create table if not exists public.waiver_documents (
  id           uuid primary key default gen_random_uuid(),
  gym_id       uuid not null references public.gyms(id) on delete cascade,
  version      integer not null,
  is_active    boolean not null default true,
  title        text not null default 'Liability waiver',
  -- Storage path inside the gym-waivers bucket (<gym_id>/<ts>.pdf) and
  -- the public URL the signing screen renders. Both stored so a later
  -- migration to private/signed URLs only has to touch the read path.
  file_path    text not null,
  file_url     text not null,
  published_by uuid references public.profiles(id),
  published_at timestamptz not null default now(),
  unique (gym_id, version)
);

-- One active waiver per gym at a time (mirrors the PAR-Q partial index).
create unique index waiver_documents_one_active_per_gym
  on public.waiver_documents (gym_id)
  where is_active;

-- ============================================================================
-- 2. waiver_signatures
-- ============================================================================

create table if not exists public.waiver_signatures (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  waiver_id   uuid not null references public.waiver_documents(id) on delete cascade,
  -- Drawn signature as vector data: { paths: text[], width, height }.
  signature   jsonb not null,
  signed_at   timestamptz not null default now(),
  -- A signature can't dangle past the membership it was granted under
  -- (the membership row is soft-deleted, so this only fires on a true
  -- hard-delete of the membership).
  foreign key (gym_id, profile_id)
    references public.gym_memberships(gym_id, profile_id) on delete cascade,
  unique (profile_id, waiver_id)
);

create index waiver_signatures_member_idx
  on public.waiver_signatures (gym_id, profile_id);

-- ============================================================================
-- 3. RLS
-- ============================================================================

alter table public.waiver_documents enable row level security;
alter table public.waiver_signatures enable row level security;

-- Documents: any active gym member can read the doc (they need to read
-- it to sign it); can_manage_parq writes (same capability that governs
-- the PAR-Q builder — it's the "manage health screening" permission).
create policy waiver_documents_member_select on public.waiver_documents
  for select using (
    exists (
      select 1 from public.gym_memberships gm
      where gm.gym_id = waiver_documents.gym_id
        and gm.profile_id = auth.uid()
        and gm.left_at is null
    )
  );

create policy waiver_documents_manage_write on public.waiver_documents
  for all using (public.effective_can(gym_id, 'can_manage_parq'))
  with check (public.effective_can(gym_id, 'can_manage_parq'));

-- Signatures: self read/write, plus can_see_health_flag staff read so
-- staff can confirm a member signed. No staff writes — signing is the
-- member's act, via the sign_waiver RPC.
create policy waiver_signatures_self_or_staff_select on public.waiver_signatures
  for select using (
    profile_id = auth.uid()
    or public.effective_can(gym_id, 'can_see_health_flag')
  );

create policy waiver_signatures_self_insert on public.waiver_signatures
  for insert with check (profile_id = auth.uid());

-- ============================================================================
-- 4. Storage bucket for waiver PDFs
-- ============================================================================
--
-- Files live under <gym_id>/<filename> so the path's first segment
-- identifies the gym. Public read (the signing screen renders the PDF;
-- it's a generic legal document, not member data). Write/update/delete
-- gated on can_manage_parq for that gym, so an admin — not just the
-- owner — can manage waivers.

insert into storage.buckets (id, name, public)
  values ('gym-waivers', 'gym-waivers', true)
  on conflict (id) do nothing;

drop policy if exists gym_waivers_public_read   on storage.objects;
drop policy if exists gym_waivers_manage_insert on storage.objects;
drop policy if exists gym_waivers_manage_update on storage.objects;
drop policy if exists gym_waivers_manage_delete on storage.objects;

create policy gym_waivers_public_read on storage.objects
  for select using (bucket_id = 'gym-waivers');

create policy gym_waivers_manage_insert on storage.objects
  for insert with check (
    bucket_id = 'gym-waivers'
    and public.effective_can(
      ((storage.foldername(name))[1])::uuid, 'can_manage_parq')
  );

create policy gym_waivers_manage_update on storage.objects
  for update using (
    bucket_id = 'gym-waivers'
    and public.effective_can(
      ((storage.foldername(name))[1])::uuid, 'can_manage_parq')
  );

create policy gym_waivers_manage_delete on storage.objects
  for delete using (
    bucket_id = 'gym-waivers'
    and public.effective_can(
      ((storage.foldername(name))[1])::uuid, 'can_manage_parq')
  );

-- ============================================================================
-- 5. RPCs
-- ============================================================================

-- publish_waiver — flips the prior active version off and inserts the
-- new one active, atomically. Single write path for waiver publishing.
create or replace function public.publish_waiver(
  p_gym_id    uuid,
  p_title     text,
  p_file_path text,
  p_file_url  text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next   integer;
  v_id     uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.effective_can(p_gym_id, 'can_manage_parq') then
    raise exception 'Not authorised';
  end if;
  if coalesce(trim(p_file_path), '') = '' or coalesce(trim(p_file_url), '') = '' then
    raise exception 'A waiver file is required';
  end if;

  select coalesce(max(version), 0) + 1 into v_next
    from public.waiver_documents where gym_id = p_gym_id;

  update public.waiver_documents
    set is_active = false
    where gym_id = p_gym_id and is_active;

  insert into public.waiver_documents
    (gym_id, version, is_active, title, file_path, file_url, published_by)
    values (p_gym_id, v_next, true,
            coalesce(nullif(trim(p_title), ''), 'Liability waiver'),
            p_file_path, p_file_url, auth.uid())
    returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.publish_waiver(uuid, text, text, text)
  to authenticated;

-- sign_waiver — the member records their drawn signature against the
-- active waiver. Idempotent on (profile, waiver): re-signing overwrites.
create or replace function public.sign_waiver(
  p_gym_id    uuid,
  p_waiver_id uuid,
  p_signature jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_sig_id uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from public.gym_memberships gm
    where gm.gym_id = p_gym_id
      and gm.profile_id = v_caller
      and gm.left_at is null
  ) then
    raise exception 'Not a member of this gym';
  end if;
  -- The waiver must belong to this gym and be the active version, so a
  -- stale client can't satisfy the gate by signing an old version.
  if not exists (
    select 1 from public.waiver_documents w
    where w.id = p_waiver_id and w.gym_id = p_gym_id and w.is_active
  ) then
    raise exception 'Waiver is not the active version';
  end if;
  if p_signature is null or jsonb_typeof(p_signature) <> 'object'
     or coalesce(jsonb_array_length(p_signature->'paths'), 0) = 0 then
    raise exception 'Signature is required';
  end if;

  insert into public.waiver_signatures
    (gym_id, profile_id, waiver_id, signature)
    values (p_gym_id, v_caller, p_waiver_id, p_signature)
  on conflict (profile_id, waiver_id) do update
    set signature = excluded.signature,
        signed_at = now()
  returning id into v_sig_id;

  return v_sig_id;
end;
$$;

grant execute on function public.sign_waiver(uuid, uuid, jsonb)
  to authenticated;

-- current_waiver_state — the gate the client uses to decide whether to
-- bounce a member into the waiver-signing screen. Mirrors
-- current_parq_state's auth and shape. needs_waiver is true when the
-- gym has an active waiver the member hasn't signed.
create or replace function public.current_waiver_state(
  p_gym_id     uuid,
  p_profile_id uuid
) returns table (
  active_waiver_id uuid,
  last_signature_id uuid,
  last_signed_at    timestamptz,
  needs_waiver      boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active uuid;
  v_sig    public.waiver_signatures%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if auth.uid() <> p_profile_id
     and not public.effective_can(p_gym_id, 'can_see_health_flag') then
    raise exception 'Not authorised';
  end if;

  select id into v_active
    from public.waiver_documents
    where gym_id = p_gym_id and is_active
    limit 1;

  select * into v_sig
    from public.waiver_signatures
    where gym_id = p_gym_id and profile_id = p_profile_id
      and waiver_id = v_active
    limit 1;

  active_waiver_id  := v_active;
  last_signature_id := v_sig.id;
  last_signed_at    := v_sig.signed_at;
  needs_waiver      := v_active is not null and v_sig.id is null;

  return next;
end;
$$;

grant execute on function public.current_waiver_state(uuid, uuid)
  to authenticated;

-- ============================================================================
-- 6. Booking gate — waiver required alongside PAR-Q
-- ============================================================================
--
-- Adds an inline waiver check to _book_class_for, mirroring the PAR-Q
-- check from 0038. Both are required when both are published ("both
-- required"). Each is independently bootstrap-safe: no active waiver =
-- no waiver gate, no active questionnaire = no PAR-Q gate, so an owner
-- with neither can still book to get the gym rolling.
--
-- Waiver error message starts with 'Waiver required' so the client can
-- match on it and redirect to /waiver (distinct from 'PAR-Q required').

create or replace function public._book_class_for(
  p_session_id uuid,
  p_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sess           public.class_sessions;
  current_count  int;
  v_booking_id   uuid;
  v_archived_at  timestamptz;
  v_active_q     uuid;
  v_last_resp    public.parq_responses%rowtype;
  v_active_w     uuid;
  v_has_sig      boolean;
begin
  if p_profile_id is null then
    raise exception 'No profile to book for';
  end if;

  select * into sess
    from public.class_sessions
    where id = p_session_id
    for update;
  if sess is null then
    raise exception 'Class not found';
  end if;

  if not exists (
    select 1 from public.gym_memberships
    where gym_id = sess.gym_id
      and profile_id = p_profile_id
      and left_at is null
  ) then
    raise exception 'Not authorised';
  end if;

  if sess.starts_at < now() then
    raise exception 'Class has already started';
  end if;

  select archived_at into v_archived_at
    from public.class_types
    where id = sess.class_type_id;
  if v_archived_at is not null then
    raise exception 'This class type is no longer running';
  end if;

  -- PAR-Q booking gate (0038). No active questionnaire = no gate.
  select id into v_active_q
    from public.parq_questionnaires
    where gym_id = sess.gym_id and is_active
    limit 1;
  if v_active_q is not null then
    select * into v_last_resp
      from public.parq_responses
      where gym_id = sess.gym_id and profile_id = p_profile_id
      order by completed_at desc
      limit 1;
    if v_last_resp.id is null
       or v_last_resp.questionnaire_id <> v_active_q
       or v_last_resp.completed_at < (now() - interval '365 days')
    then
      raise exception
        'PAR-Q required: complete the health screening before booking';
    end if;
  end if;

  -- Waiver booking gate. No active waiver = no gate. With one, the
  -- booker must have signed the current version (no annual expiry).
  select id into v_active_w
    from public.waiver_documents
    where gym_id = sess.gym_id and is_active
    limit 1;
  if v_active_w is not null then
    select exists (
      select 1 from public.waiver_signatures
      where gym_id = sess.gym_id
        and profile_id = p_profile_id
        and waiver_id = v_active_w
    ) into v_has_sig;
    if not v_has_sig then
      raise exception
        'Waiver required: sign the waiver before booking';
    end if;
  end if;

  select count(*) into current_count
    from public.class_bookings
    where class_session_id = p_session_id;

  if current_count >= sess.capacity then
    raise exception 'Class is full';
  end if;

  insert into public.class_bookings (gym_id, class_session_id, profile_id)
  values (sess.gym_id, p_session_id, p_profile_id)
  on conflict (class_session_id, profile_id) do nothing
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke execute on function public._book_class_for(uuid, uuid)
  from public, anon, authenticated;

-- ============================================================================
-- 7. Setup checklist — the screening step accepts a waiver OR a PAR-Q
-- ============================================================================
--
-- Re-creates get_gym_setup_progress (last set in 0040) with the 'parq'
-- step broadened: it's done when the gym has an active PAR-Q
-- questionnaire OR an active waiver. A gym only needs one screening to
-- go live. All other steps are unchanged from 0040.

create or replace function public.get_gym_setup_progress(p_gym_id uuid)
returns table (step_key text, done boolean)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.user_belongs_to(p_gym_id) then
    raise exception 'Not authorised';
  end if;

  return query
    select 'logo'::text,
      exists (
        select 1 from public.gyms
        where id = p_gym_id and coalesce(logo_url, '') <> ''
      )
    union all
    select 'class_type'::text,
      exists (
        select 1 from public.class_types
        where gym_id = p_gym_id and archived_at is null
      )
    union all
    select 'schedule'::text,
      exists (
        select 1
        from public.class_recurrences cr
        join public.class_types ct on ct.id = cr.class_type_id
        where cr.gym_id = p_gym_id and ct.archived_at is null
      )
    union all
    select 'parq'::text,
      exists (
        select 1 from public.parq_questionnaires
        where gym_id = p_gym_id and is_active
      )
      or exists (
        select 1 from public.waiver_documents
        where gym_id = p_gym_id and is_active
      )
    union all
    select 'plan'::text,
      exists (
        select 1 from public.membership_plans
        where gym_id = p_gym_id and archived_at is null
      )
    union all
    select 'team'::text,
      exists (
        select 1 from public.invite_codes
        where gym_id = p_gym_id
      )
      or exists (
        select 1 from public.gym_memberships
        where gym_id = p_gym_id
          and role in ('admin', 'coach', 'staff')
          and left_at is null
      );
end;
$$;

grant execute on function public.get_gym_setup_progress(uuid) to authenticated;

commit;
