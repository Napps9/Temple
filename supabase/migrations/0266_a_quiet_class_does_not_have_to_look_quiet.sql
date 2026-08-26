-- A quiet class does not have to look quiet
--
-- An owner opening a new slot has the same problem every time: the first
-- few weeks are thin, and "3 spots left" on a class of twelve tells
-- everybody reading the timetable that nobody is coming. The number is
-- honest and it is also the reason the class stays empty. So the gym gets
-- to choose whether it publishes how full a class is.
--
-- THE SWITCH IS ONE COLUMN, NOT TWO. "Who is booked" needed no setting:
-- members are never shown the roster before a class — the names render
-- under mode === 'manage' and nowhere else. What existed was a data-layer
-- leak, not a feature. class_bookings_tenant_select (0006) has been a bare
-- user_belongs_to since it was written and was never narrowed, so with
-- profiles_gym_member_select beside it any member could read every booking
-- in the gym, names included, straight off the table. This closes that by
-- mirroring class_waitlist_self_or_staff_select (0016) exactly: your own
-- row, or the staff area. The two tables describe the same session and
-- should have agreed from the start — plus a guardian clause, because a
-- family account is a person reading somebody else’s row on purpose.
--
-- AND IT FIXES A NUMBER THAT WAS ALREADY WRONG. ClassesCalendar renders
-- "Full — N waiting" from a plain select on class_waitlist. Under that
-- table's own policy a member reads only their own row, so a class with
-- nine people queued says "Full", and says "Full — 1 waiting" only when
-- the member is themselves the one waiting. Staff saw it correctly, which
-- is why it passed review. A definer count is the only way a member can
-- be told a true number about other people, so the count moves here.
--
-- FULL IS NOT A CAPACITY NUMBER. Hiding how many spots are left must not
-- hide whether the class can be booked — a member who taps Book and is
-- refused learns the count anyway, and learns it as a fault. So is_full is
-- returned truthfully whatever the switch says; only the counts go null.
--
-- The count folds in class_session_hold_counts (0262) rather than sitting
-- beside it. A held trial seat is occupied — _book_class_for counts it —
-- and two functions that must agree about what a spoken-for seat is will
-- eventually disagree.

begin;

-- ============================================================================
-- 1. The switch
-- ============================================================================

alter table public.gyms
  add column if not exists show_class_capacity boolean not null default true;

comment on column public.gyms.show_class_capacity is
  'When false, members are not told how many spots are left or how many '
  'are waiting. Whether a class is full is still shown — hiding that '
  'would offer a booking the server refuses. Staff always see counts.';

create or replace function public.set_class_capacity_visibility(
  p_gym_id uuid,
  p_value  boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change what members see';
  end if;
  update public.gyms set show_class_capacity = p_value where id = p_gym_id;
end;
$$;

revoke all on function public.set_class_capacity_visibility(uuid, boolean)
  from public, anon;
grant execute on function public.set_class_capacity_visibility(uuid, boolean)
  to authenticated;

-- ============================================================================
-- 2. Close the roster read
-- ============================================================================

drop policy if exists class_bookings_tenant_select on public.class_bookings;

-- The guardian clause is not decoration: parent_book_dependent (0113)
-- books a child, and a parent who cannot then see the booking they just
-- made has lost the family account. dependents.sql caught this.
create policy class_bookings_self_or_staff_select on public.class_bookings
  for select using (
    profile_id = auth.uid()
    or public.is_guardian_of(profile_id)
    or public.user_can_access_staff_area(gym_id)
  );

-- ============================================================================
-- 3. One count, told the truth once
-- ============================================================================

drop function if exists public.class_session_hold_counts(uuid[]);

create function public.class_session_spot_counts(p_session_ids uuid[])
returns table (
  class_session_id uuid,
  taken            integer,
  waiting          integer,
  is_full          boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with sess as (
    select s.id, s.gym_id, s.capacity, g.show_class_capacity
    from public.class_sessions s
    join public.gyms g on g.id = s.gym_id
    where s.id = any(p_session_ids)
      and public.user_belongs_to(s.gym_id)
  ),
  tally as (
    select
      sess.id,
      sess.capacity,
      sess.show_class_capacity,
      public.user_can_access_staff_area(sess.gym_id) as is_staff,
      (
        select count(*) from public.class_bookings b
        where b.class_session_id = sess.id
      )
      + (
        -- A seat claimed from a trial link and not yet taken is spoken
        -- for: _book_class_for counts it (0262), so this must too, or the
        -- last spot is offered to somebody who is then refused.
        select count(*) from public.trial_pass_redemptions r
        where r.session_id = sess.id
          and r.booking_id is null
          and r.held_until > now()
          and not exists (
            select 1 from public.class_bookings b2
            where b2.class_session_id = r.session_id
              and b2.profile_id = r.profile_id
          )
      ) as taken,
      (
        select count(*) from public.class_waitlist w
        where w.class_session_id = sess.id
      ) as waiting
    from sess
  )
  select
    tally.id,
    case when tally.show_class_capacity or tally.is_staff
      then tally.taken::integer end,
    case when tally.show_class_capacity or tally.is_staff
      then tally.waiting::integer end,
    tally.taken >= tally.capacity
  from tally;
$$;

revoke all on function public.class_session_spot_counts(uuid[]) from public, anon;
grant execute on function public.class_session_spot_counts(uuid[]) to authenticated;

commit;
