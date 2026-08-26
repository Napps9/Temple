-- Everyone on the same day
--
-- ACE bill on whatever day each member happened to join, so chasing a
-- failed payment is thirty small jobs spread across the month instead of
-- one. A common billing date makes revenue land predictably and makes
-- "who has not paid" a question with one answer a month.
--
-- IT IS OPTIONAL, AND NULL IS EXACTLY TODAY. billing_anchor_day defaults
-- null and null means "bill on the day they joined", which is what every
-- gym does now. A gym opts in by picking a day; nothing changes for one
-- that does not. This matters more than it sounds: the alternative is a
-- migration that silently re-dates every future renewal in the product.
--
-- 1 TO 28, NOT 31. A gym that picks the 31st has picked a day that does
-- not exist in February, and every scheme for handling that (clamp? skip?
-- roll forward?) is a rule somebody has to remember. 28 is the last day
-- every month has.
--
-- THE ARITHMETIC LIVES HERE, NOT IN THE EDGE FUNCTION. Working out "the
-- next 1st of the month at midnight, in Europe/London, in seconds since
-- the epoch" is exactly the kind of thing that is right in eleven months
-- of the year. Postgres does timezone maths properly and pgTAP can hold it
-- to that; Deno with an Intl formatter cannot be tested here at all.
--
-- WHAT THE MEMBER IS TOLD IS STRIPE'S NUMBER, NOT OURS. 0264's doctrine —
-- the code is ours, the arithmetic is Stripe's. Temple says the shape
-- ("you will pay for the rest of this month today, then on the 1st"), and
-- the exact figure appears on Stripe's own checkout page, itemised, on the
-- screen where the card is entered. Computing it twice is how a number in
-- an app comes to disagree with the invoice somebody reads out on the
-- phone. prorated_cents below is not shown to anybody: it exists to answer
-- one yes/no question, below.
--
-- THE SUB-MINIMUM TRAP. A proration below Stripe's minimum charge is not
-- an error. Stripe rolls it onto the customer balance instead, so a member
-- joining on the 30th appears to have paid nothing, no invoice.paid fires,
-- and the gym's Money block never sees them. Under a pound the checkout
-- uses trial_end at the anchor instead — free until the 1st, which is
-- honest, legible, and cannot silently vanish.

begin;

-- ============================================================================
-- 1. The day
-- ============================================================================

alter table public.gyms
  add column if not exists billing_anchor_day smallint
    check (billing_anchor_day is null
           or (billing_anchor_day >= 1 and billing_anchor_day <= 28));

comment on column public.gyms.billing_anchor_day is
  'Day of the month every membership renews on, 1-28. Null (the default) '
  'keeps today''s behaviour: each member renews on the day they joined.';

create or replace function public.set_gym_billing_anchor(
  p_gym_id uuid,
  p_day    smallint
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change the billing date';
  end if;
  if p_day is not null and (p_day < 1 or p_day > 28) then
    raise exception 'Pick a day between 1 and 28 — later days do not exist every month';
  end if;
  update public.gyms set billing_anchor_day = p_day where id = p_gym_id;
end;
$$;

revoke all on function public.set_gym_billing_anchor(uuid, smallint) from public, anon;
grant execute on function public.set_gym_billing_anchor(uuid, smallint) to authenticated;

-- ============================================================================
-- 2. When the next one falls, and what the part-month is worth
-- ============================================================================
--
-- Strictly after now: a member joining at 09:00 on the 1st should be
-- charged for this month and renew on the NEXT 1st, not be handed a
-- zero-length period.

create or replace function public.gym_billing_anchor(
  p_gym_id       uuid,
  p_price_cents  integer default 0
) returns table (
  anchor_at      timestamptz,
  prorated_cents integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_day   smallint;
  v_tz    text;
  v_local timestamp;
  v_next  timestamp;
  v_prev  timestamp;
begin
  select g.billing_anchor_day,
         case when exists (select 1 from pg_timezone_names t where t.name = g.timezone)
              then g.timezone else 'UTC' end
    into v_day, v_tz
    from public.gyms g where g.id = p_gym_id;

  if v_day is null then
    return;
  end if;

  v_local := (now() at time zone v_tz);
  v_next  := date_trunc('month', v_local) + make_interval(days => v_day - 1);
  if v_next <= v_local then
    v_next := date_trunc('month', v_local + interval '1 month')
              + make_interval(days => v_day - 1);
  end if;
  -- The anchor before this one, so the part-month is measured against a
  -- real billing period rather than a nominal thirty days.
  v_prev := v_next - interval '1 month';

  return query select
    (v_next at time zone v_tz),
    round(
      p_price_cents
      * extract(epoch from (v_next - v_local))
      / nullif(extract(epoch from (v_next - v_prev)), 0)
    )::integer;
end;
$$;

revoke all on function public.gym_billing_anchor(uuid, integer) from public, anon;
grant execute on function public.gym_billing_anchor(uuid, integer) to authenticated;

commit;
