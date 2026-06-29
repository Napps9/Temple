-- 0088_gym_discipline.sql
--
-- Per-gym "discipline" flag so a gym can run Temple in its training
-- flavour. Today this only re-skins the member Track section: a
-- 'crossfit' gym sees the movement-group catalog (squats / pulls /
-- olympic lifts / …), a 'hyrox' gym sees the eight Hyrox stations,
-- the 1 km run split, and a full/half race simulation instead.
--
-- The column is intentionally narrow (a CHECK, not a lookup table) —
-- the set of disciplines is a code-level concept (each one ships its
-- own Track catalog in the app), not gym-authored data.

alter table public.gyms
  add column discipline text not null default 'crossfit'
    check (discipline in ('crossfit', 'hyrox'));

-- Owner-gated setter. Mirrors the other single-toggle gym settings
-- (set_require_membership_to_book, set_store_settings): one column,
-- owner only, security definer so the client never writes gyms direct.
create or replace function public.set_gym_discipline(
  p_gym_id     uuid,
  p_discipline text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change the gym discipline';
  end if;
  if p_discipline not in ('crossfit', 'hyrox') then
    raise exception 'Unknown discipline: %', p_discipline;
  end if;
  update public.gyms
    set discipline = p_discipline
    where id = p_gym_id;
end;
$$;

grant execute on function public.set_gym_discipline(uuid, text) to authenticated;
