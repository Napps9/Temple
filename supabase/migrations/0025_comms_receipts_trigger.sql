-- Phase 1 / Track C: receipt-only outbox trigger.
--
-- When a billing_events row lands with kind in ('invoice.paid',
-- 'charge.refunded'), materialise a queued messages row so the
-- dispatcher fires the member's receipt email.
--
-- Dunning emails (invoice.payment_failed) deliberately are NOT
-- handled here — failed charges per §3.1 never write a billing_events
-- row. The webhook's payment_failed branch enqueues the messages
-- row directly in the same transaction that flips state /
-- awaiting_payment_authentication. Putting both legs in this trigger
-- would silently never fire the dunning leg.

create or replace function public.fn_enqueue_receipt_from_billing_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_system_kind text;
begin
  v_system_kind := case new.kind
    when 'invoice.paid'    then 'invoice_paid_receipt'
    when 'charge.refunded' then 'refund_processed'
    else null
  end;

  if v_system_kind is null then
    return new;
  end if;

  insert into public.messages (
    gym_id, channel, system_kind, recipient_profile_id, context
  ) values (
    new.gym_id,
    'email',
    v_system_kind,
    new.member_id,
    jsonb_build_object(
      'billing_event_id', new.provider_event_id,
      'amount_cents',     new.amount_cents,
      'currency',         new.currency,
      'occurred_at',      new.occurred_at
    )
  );

  return new;
end;
$$;

create trigger billing_events_enqueue_receipt_trg
  after insert on public.billing_events
  for each row execute function public.fn_enqueue_receipt_from_billing_event();
