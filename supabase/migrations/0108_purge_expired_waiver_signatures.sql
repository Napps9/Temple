-- 0108_purge_expired_waiver_signatures.sql
--
-- Waiver signatures are retained as liability records (establishment/defence
-- of legal claims) and are deliberately excluded from the health-data
-- erasure/purge in 0037 — see the retention note in 0041_waivers.sql. Until
-- now that retention was unbounded ("kept forever"), which our own DPA
-- (docs/legal/dpa.md §10) does not promise. UK best practice is to bound it
-- to the limitation period: this deletes a signature 6 years after the
-- relevant membership ended (gym_memberships.left_at), per the Limitation
-- Act 1980. Active members (left_at is null) are never touched.
--
-- Mirrors purge_expired_health_data() (0037); scheduled via pg_cron in the
-- next migration (same pattern as 0095). Set-based DELETE rather than the
-- per-member loop the health version uses, because there's no shared
-- per-member helper to call here.

create or replace function public.purge_expired_waiver_signatures()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with deleted as (
    delete from public.waiver_signatures ws
    using public.gym_memberships gm
    where gm.gym_id = ws.gym_id
      and gm.profile_id = ws.profile_id
      and gm.left_at is not null
      and gm.left_at < now() - interval '6 years'
    returning ws.id
  )
  select count(*) into v_count from deleted;
  return v_count;
end;
$$;

grant execute on function public.purge_expired_waiver_signatures() to authenticated;
