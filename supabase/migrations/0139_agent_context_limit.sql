-- Raise the AI agent's brief length cap from 4000 to 8000 characters.
--
-- The AI-generated brief (generate-agent-prompt) writes a full operating
-- brief — greeting, plans, class levels, onboarding, guardrails — which
-- routinely runs past 4000 chars, so set_gym_agent_context (0136) rejected
-- saving it. 8000 chars (~2k tokens) comfortably fits a rich brief while
-- staying cheap to inject into the agent's prompt on every call.
-- CREATE OR REPLACE (same signature) — body-only change.

begin;

create or replace function public.set_gym_agent_context(
  p_gym_id uuid, p_context text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change the AI front desk';
  end if;
  if length(coalesce(p_context, '')) > 8000 then
    raise exception 'Keep the agent notes under 8000 characters';
  end if;
  insert into public.gym_agent_settings (gym_id, context, updated_at)
  values (p_gym_id, nullif(btrim(coalesce(p_context, '')), ''), now())
  on conflict (gym_id) do update
    set context = excluded.context, updated_at = now();
end;
$$;
grant execute on function public.set_gym_agent_context(uuid, text) to authenticated;

commit;
