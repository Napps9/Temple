-- Owners can delete invite_codes for their gym.
--
-- The original 0001 / 0002 set only granted SELECT (any gym member)
-- and INSERT (owner). Without DELETE, owners had no way to revoke an
-- unused code or clean up the list — the Team screen now exposes a
-- per-row delete affordance.
--
-- Deleting a used code is allowed: the redemption is already recorded
-- on gym_memberships, so removing the code row only loses the "who
-- created this invite" trail. Owners can choose to keep them for
-- history or prune them — the UI defaults to showing both states.

create policy invite_codes_owner_delete on public.invite_codes
  for delete using (public.user_is_owner_of(gym_id));
