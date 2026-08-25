-- A notice that holds the top for a week
--
-- Pinning has existed since 0029 as a boolean, and it has one failure
-- mode: nobody ever turns it off. The bank-holiday notice that mattered
-- on Friday is still leading the Inbox in October, and the owner has no
-- way to change it — 0195 revoked UPDATE on this table from the client
-- after the author-update policy turned out to leave gym_id mutable, so
-- since then an announcement has been insert-and-delete only and
-- `pinned` has been frozen at insert time.
--
-- So the pin gets a window and a way to change it. pinned_from lets the
-- owner write Monday's notice on Friday; pinned_until is the part that
-- matters, because it means the notice stops shouting without anyone
-- remembering to make it stop. Both null keeps exactly today's
-- behaviour — pinned until unpinned — so every existing row is already
-- correct and nothing is backfilled.
--
-- set_announcement_pin is the only writer. It carries the same gate as
-- posting (can_post_announcements, the capability that already decides
-- who speaks to the room) and it touches three columns, so 0195's hole
-- stays shut: gym_id is not among them.

begin;

alter table public.gym_announcements
  add column pinned_from  timestamptz,
  add column pinned_until timestamptz;

alter table public.gym_announcements
  add constraint gym_announcements_pin_window_ck
  check (
    pinned_until is null
    or pinned_from is null
    or pinned_until > pinned_from
  );

comment on column public.gym_announcements.pinned_from is
  'Pin takes effect at this time; null means immediately. Written only by set_announcement_pin or the author at insert.';
comment on column public.gym_announcements.pinned_until is
  'Pin lapses at this time; null means until unpinned. Written only by set_announcement_pin or the author at insert.';

-- The banner asks one question — "what is pinned right now for this
-- gym" — and this index answers it without touching an unpinned row.
create index gym_announcements_live_pin_idx
  on public.gym_announcements (gym_id, pinned_until, created_at desc)
  where pinned;

create function public.set_announcement_pin(
  p_announcement_id uuid,
  p_pinned          boolean,
  p_pinned_from     timestamptz default null,
  p_pinned_until    timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  select gym_id into v_gym
    from public.gym_announcements
   where id = p_announcement_id;

  if v_gym is null then
    raise exception 'Announcement not found';
  end if;

  if not public.effective_can(v_gym, 'can_post_announcements') then
    raise exception 'Not allowed';
  end if;

  -- A pin measured in years is a pin nobody will ever turn off, which
  -- is the thing this migration exists to stop.
  if p_pinned and p_pinned_until is not null
     and p_pinned_until > now() + interval '365 days' then
    raise exception 'Pin window out of range';
  end if;

  if p_pinned and p_pinned_from is not null
     and p_pinned_until is not null
     and p_pinned_until <= p_pinned_from then
    raise exception 'Pin window out of range';
  end if;

  update public.gym_announcements
     set pinned       = p_pinned,
         pinned_from  = case when p_pinned then p_pinned_from  else null end,
         pinned_until = case when p_pinned then p_pinned_until else null end
   where id = p_announcement_id;
end;
$$;

revoke all on function public.set_announcement_pin(uuid, boolean, timestamptz, timestamptz) from public, anon;
grant execute on function public.set_announcement_pin(uuid, boolean, timestamptz, timestamptz) to authenticated;

commit;
