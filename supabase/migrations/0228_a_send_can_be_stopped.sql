-- A send that is already going out can be stopped
--
-- comms_unschedule_campaign (0193) pulls a scheduled send back to a
-- draft, and stops working the moment the dispatcher flips the row to
-- 'sending'. After that there has been nothing: no abort, no recall, and
-- no path to the 'cancelled' status the CHECK has allowed since 0044.
-- comms.cancel_send reports losing that race honestly, which was the
-- honest half of the fix and not the whole one.
--
-- The half that was missing is real, because a send is not instant. The
-- worker runs eight at a time through a queue that can be a thousand
-- long, so an owner who spots a wrong price thirty seconds in has a
-- genuine window — and had no way to use it.
--
-- What stopping can and cannot do, stated here because the card has to
-- say it and the card should not be inventing it:
--
--   * **Mail already accepted by Resend is gone.** There is no recall in
--     SMTP and none in Resend's API. Whoever has it, has it.
--   * **Everything still queued is skipped**, marked here rather than
--     left for the worker, because the worker may already be dead — a
--     timed-out invocation would otherwise leave those rows queued for
--     ever, indistinguishable from a send in progress.
--   * **The campaign ends 'cancelled'**, not 'sent' and not 'failed'. It
--     did send, partly, on purpose, and both of the other words are
--     wrong about that.
--
-- The worker's own half of this lives in send-campaign: it re-reads the
-- campaign's status as it goes and stops pulling from the queue when it
-- sees 'cancelled'. Marking the rows here and stopping the worker there
-- are both needed — this alone would let an in-flight worker keep
-- sending, and that alone would strand the rows if it died.

create or replace function public.comms_stop_campaign(p_campaign_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym     uuid;
  v_status  text;
  v_skipped integer;
begin
  select gym_id, status into v_gym, v_status
    from public.email_campaigns
    where id = p_campaign_id
    for update;
  if v_gym is null then
    raise exception 'Campaign not found';
  end if;
  if not public.effective_can(v_gym, 'can_manage_comms') then
    raise exception 'Not authorised';
  end if;
  -- 'scheduled' has its own verb and a better outcome — it goes back to
  -- a draft with nothing sent, rather than ending half-delivered.
  if v_status <> 'sending' then
    raise exception 'That campaign is not going out right now';
  end if;

  with stopped as (
    update public.email_campaign_recipients
      set status = 'skipped',
          error  = 'The send was stopped before this one went out'
      where campaign_id = p_campaign_id
        and status = 'queued'
      returning id
  )
  select count(*)::int into v_skipped from stopped;

  update public.email_campaigns
    set status = 'cancelled', updated_at = now()
    where id = p_campaign_id;

  return coalesce(v_skipped, 0);
end;
$$;

grant execute on function public.comms_stop_campaign(uuid) to authenticated;
