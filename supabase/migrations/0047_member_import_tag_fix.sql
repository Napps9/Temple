-- Fix apply_pending_member_data (migration 0046). Its member_tags insert
-- was broken two ways and took the whole pgTAP suite — and therefore
-- every hosted deploy — red the moment an imported member carrying tags
-- signed up:
--
--   1. ON CONFLICT (gym_id, profile_id, lower(label)) matched no unique
--      index (member_tags is uniquely keyed on (gym_id, profile_id,
--      label), case-sensitive) -> "no unique or exclusion constraint
--      matching the ON CONFLICT specification".
--   2. The insert omitted member_tags' NOT NULL columns color / source /
--      created_by, so even with a valid arbiter it would have failed.
--
-- Forward-fix the function only (the trigger already points at it).
-- Imported tags are written as manual tags, in the gym-neutral grey the
-- rest of the app uses for an unstyled chip, attributed to the new
-- member's own profile, and de-duplicated case-insensitively with a
-- NOT EXISTS guard so no new index is needed.

begin;

create or replace function public.apply_pending_member_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text;
  v_pending public.pending_members%rowtype;
  v_tag     text;
begin
  -- Pre-existing rejoin doesn't carry pending data: we only fire on
  -- the first INSERT, not on the update that clears left_at.
  if tg_op <> 'INSERT' then
    return new;
  end if;

  select u.email into v_email from auth.users u where u.id = new.profile_id;
  if v_email is null then
    return new;
  end if;

  select * into v_pending
    from public.pending_members
    where gym_id = new.gym_id and lower(email) = lower(v_email)
    limit 1;
  if v_pending.id is null then
    return new;
  end if;

  -- Apply the imported plan metadata onto the new membership row.
  update public.gym_memberships
    set imported_plan_name         = v_pending.plan_name,
        imported_plan_start        = v_pending.plan_start,
        imported_plan_end          = v_pending.plan_end,
        imported_credits_remaining = v_pending.credits_remaining,
        imported_at                = now()
    where id = new.id;

  -- Tags. member_tags requires color / source / created_by and is keyed
  -- (gym_id, profile_id, label); write them as manual tags attributed to
  -- the new member, skipping any label the member already carries
  -- (case-insensitive) so a re-run / overlap can't trip the unique key.
  foreach v_tag in array coalesce(v_pending.tags, '{}'::text[]) loop
    if length(trim(v_tag)) > 0 then
      insert into public.member_tags (gym_id, profile_id, label, color, source, created_by)
        select new.gym_id, new.profile_id, trim(v_tag), '#6B7280', 'manual', new.profile_id
        where not exists (
          select 1 from public.member_tags mt
          where mt.gym_id = new.gym_id
            and mt.profile_id = new.profile_id
            and lower(mt.label) = lower(trim(v_tag))
        );
    end if;
  end loop;

  -- Suppression: a member flagged "do not email" on the source system
  -- carries straight into our Comms Suite suppression list.
  if v_pending.unsubscribed then
    insert into public.email_unsubscribes
      (gym_id, email, profile_id, reason)
      values (v_pending.gym_id, v_pending.email, new.profile_id, 'imported')
      on conflict (gym_id, lower(email)) do nothing;
  end if;

  update public.pending_members
    set status = 'linked',
        linked_at = now(),
        linked_profile_id = new.profile_id
    where id = v_pending.id;

  return new;
end;
$$;

commit;
