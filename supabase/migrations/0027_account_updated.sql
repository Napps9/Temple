-- Phase 1 / Track A: Connect account.updated handler.
--
-- Fires whenever a connected account's onboarding state changes
-- (capabilities granted, details submitted, payouts enabled, etc.).
-- Mirrors the Stripe Account flags into stripe_connect_accounts so
-- the owner UI can render the right state without hitting Stripe.
--
-- Idempotent via webhook_events. Inserts the local row on first
-- sight; updates the flags every time.

create or replace function public.record_connect_account_updated(
  p_event_id          text,
  p_account_id        text,
  p_charges_enabled   boolean,
  p_payouts_enabled   boolean,
  p_details_submitted boolean,
  p_country           text,
  p_default_currency  text,
  p_occurred_at       timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id            uuid;
  v_old_status        public.connect_onboarding_status;
  v_new_status        public.connect_onboarding_status;
begin
  begin
    insert into public.webhook_events (
      provider, provider_event_id, kind, occurred_at
    ) values (
      'stripe', p_event_id, 'account.updated', p_occurred_at
    );
  exception when unique_violation then
    return;
  end;

  -- Find the gym this connected account belongs to. If unknown,
  -- the row was never created locally (create_stripe_connect_link
  -- writes it before redirecting), so silently ignore.
  select gym_id, onboarding_status
    into v_gym_id, v_old_status
  from public.stripe_connect_accounts
  where provider_account_id = p_account_id;

  if v_gym_id is null then
    return;
  end if;

  -- Status derives from the Stripe flags. Once all three are true
  -- the account is fully onboarded; otherwise it's in_progress
  -- (details_submitted but capability not yet granted) or
  -- not_started (nothing submitted yet).
  v_new_status := case
    when p_charges_enabled and p_payouts_enabled and p_details_submitted
                                                       then 'completed'
    when p_details_submitted                           then 'in_progress'
    else 'not_started'
  end;

  update public.stripe_connect_accounts
  set charges_enabled   = p_charges_enabled,
      payouts_enabled   = p_payouts_enabled,
      details_submitted = p_details_submitted,
      country           = coalesce(p_country, country),
      default_currency  = coalesce(p_default_currency, default_currency),
      onboarding_status = v_new_status,
      last_synced_at    = now()
  where gym_id = v_gym_id;

  if v_old_status is distinct from v_new_status then
    insert into public.audit_events (
      gym_id, subject_kind, subject_id, kind, payload
    ) values (
      v_gym_id, 'gym', v_gym_id, 'connect_onboarding_status_changed',
      jsonb_build_object(
        'previous_status', v_old_status::text,
        'new_status',      v_new_status::text,
        'stripe_event_id', p_event_id
      )
    );
  end if;
end;
$$;
