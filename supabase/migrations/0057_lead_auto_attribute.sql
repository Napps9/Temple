-- Phase 3b — auto-attribute leads on member signup.
--
-- When a new gym_memberships row lands (the canonical "joined this
-- gym" event), look for any open lead in that gym whose email
-- matches the new member's auth email (case-insensitive). If we find
-- one, flip it to 'converted', stamp converted_at, and point
-- converted_profile_id at the new profile.
--
-- Match window: gyms.lead_conversion_window_days (0049). If the
-- lead was captured longer ago than that window, we don't auto-
-- attribute — the staff can still manually link from the lead
-- detail UI.
--
-- Idempotent: we only flip leads still in a non-converted status.
-- A lead already at 'converted' or 'lost' is left alone.

begin;

create or replace function public._auto_attribute_lead_on_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text;
  v_window  integer;
begin
  -- Pull the email from auth.users so the comparison works
  -- regardless of whether the public.profiles row has it cached.
  select lower(email) into v_email
    from auth.users
    where id = new.profile_id;
  if v_email is null or v_email = '' then
    return new;
  end if;

  select coalesce(lead_conversion_window_days, 90) into v_window
    from public.gyms
    where id = new.gym_id;

  update public.leads
    set status               = 'converted'::public.lead_status,
        converted_at         = now(),
        converted_profile_id = new.profile_id
    where gym_id = new.gym_id
      and lower(email) = v_email
      and status not in ('converted'::public.lead_status,
                         'lost'::public.lead_status)
      and captured_at >= now() - make_interval(days => v_window);
  return new;
end;
$$;

revoke execute on function public._auto_attribute_lead_on_join()
  from public, anon, authenticated;

drop trigger if exists auto_attribute_lead_on_join on public.gym_memberships;
create trigger auto_attribute_lead_on_join
  after insert on public.gym_memberships
  for each row execute function public._auto_attribute_lead_on_join();

commit;
