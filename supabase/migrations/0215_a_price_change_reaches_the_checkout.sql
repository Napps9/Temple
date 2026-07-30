-- Changing a plan's price means something
--
-- Two faults, both about the price on a membership plan, and both the
-- same bug seen from a different end.
--
-- 1. `stripe_price_id` caches a Stripe Price object created lazily at the
--    first checkout (0080; stripe-checkout step 2, stripe-modify-
--    subscription's ensurePrice). Nothing ever cleared it. An owner who
--    put Unlimited up from £50 to £60 kept selling it at £50 — the plans
--    screen said £60, the website said £60, the Checkout charged £50, and
--    no surface anywhere disagreed with any other. A trigger clears the
--    cache when the price moves, so the next checkout mints a Price at
--    the new amount. Members already on the plan are untouched by design:
--    their Stripe subscription references the old Price directly and
--    plan_subscriptions.price_cents snapshots what they signed up at
--    (0008's grandfathering invariant). A price rise applies to new
--    sign-ups, never retroactively.
--
-- 2. `can_manage_plans` is offered per-role on the Team screen — "Create
--    / edit / archive membership plans" — and the plans editor gates
--    itself on useCan('can_manage_plans'). The table's RLS asked
--    user_is_owner_of. An admin granted the capability was told they
--    could edit plans and then refused by the database. Same class as
--    can_assign_plan (0211) and can_issue_override (0213): a capability
--    that reads as permission and is decoration. effective_can defaults
--    can_manage_plans to owner-only, so a gym that has granted nothing
--    sees no change at all; a gym that granted it now gets what it was
--    promised. effective_can is also the stricter predicate — it requires
--    left_at is null, which user_is_owner_of does not.
--
-- Not converted to a security-definer RPC (the 0195 pattern) on purpose:
-- the plans editor writes seven columns across insert, update and archive,
-- and membership_plans has no column whose direct write escalates
-- anything. gym_id is covered because USING and WITH CHECK both apply, so
-- moving a plan between gyms needs the capability in both.

-- ---------------------------------------------------------------------------
-- 1. A price change forgets the cached Stripe Price
-- ---------------------------------------------------------------------------

create or replace function public._forget_stripe_price()
returns trigger
language plpgsql
as $$
begin
  -- Only when the caller changed the price and left the cache alone. A
  -- write that sets both is stripe-checkout filling the cache in, or an
  -- import pointing a plan at a Price that already exists — neither
  -- wants its own value thrown away.
  if new.monthly_price_cents is distinct from old.monthly_price_cents
     and new.stripe_price_id is not distinct from old.stripe_price_id
  then
    new.stripe_price_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists membership_plans_price_forgets_stripe_price
  on public.membership_plans;

create trigger membership_plans_price_forgets_stripe_price
  before update on public.membership_plans
  for each row
  execute function public._forget_stripe_price();

-- ---------------------------------------------------------------------------
-- 2. can_manage_plans governs the table it names
-- ---------------------------------------------------------------------------

drop policy if exists membership_plans_owner_insert on public.membership_plans;
drop policy if exists membership_plans_owner_update on public.membership_plans;
drop policy if exists membership_plans_owner_delete on public.membership_plans;

create policy membership_plans_manage_insert on public.membership_plans
  for insert
  with check (public.effective_can(gym_id, 'can_manage_plans'));

create policy membership_plans_manage_update on public.membership_plans
  for update
  using (public.effective_can(gym_id, 'can_manage_plans'))
  with check (public.effective_can(gym_id, 'can_manage_plans'));

create policy membership_plans_manage_delete on public.membership_plans
  for delete
  using (public.effective_can(gym_id, 'can_manage_plans'));
