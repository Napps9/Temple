-- 0089_set_gym_currency.sql
--
-- Owner-gated setter for the gym's billing currency (gyms.currency,
-- added in 0027, default 'GBP'). Currency normally follows the
-- connected Stripe account — the connect callback adopts the account's
-- default_currency — but a gym that hasn't connected Stripe (or wants
-- to override) needs a way to set it. This is that seam, mirroring the
-- other single-field owner settings (set_require_membership_to_book,
-- set_gym_discipline).
--
-- The value is a free ISO 4217 code (Stripe can return any), validated
-- only as three letters and stored upper-cased so Intl.NumberFormat
-- renders the right symbol.

create or replace function public.set_gym_currency(
  p_gym_id   uuid,
  p_currency text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(p_currency, '')));
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change the gym currency';
  end if;
  if v_code !~ '^[A-Z]{3}$' then
    raise exception 'Invalid currency code: %', p_currency;
  end if;
  update public.gyms
    set currency = v_code
    where id = p_gym_id;
end;
$$;

grant execute on function public.set_gym_currency(uuid, text) to authenticated;
