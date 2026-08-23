-- The notice knows what it cancelled
--
-- Closing the gym does two disconnected things today: every affected
-- member gets a class_change_notifications row ("Your Tuesday 06:00
-- Metcon was cancelled"), and — separately, if staff remember — an
-- announcement gets posted saying the gym is shut. The two never meet:
-- a member reading the notice can't see what it means for THEM without
-- hunting their inbox.
--
-- One nullable column joins them: an announcement may point at the
-- closure it is about. The member-facing detail page can then show the
-- reader their own cancelled bookings for that closure (their
-- class_change_notifications rows already carry closure_id since 0169),
-- and the close-gym flow can post the notice with the link in place.
--
-- The FK is composite on (closure_id, gym_id) so an announcement can
-- only ever reference its own gym's closure — the tenant guard lives in
-- the constraint, not in trust. NULL closure_id skips the check (MATCH
-- SIMPLE). Deletion needs no action: closures are lifted, never deleted
-- (0169), and a whole-gym delete cascades both tables in one statement.

begin;

alter table public.gym_closures
  add constraint gym_closures_id_gym_uniq unique (id, gym_id);

alter table public.gym_announcements
  add column closure_id uuid,
  add constraint gym_announcements_closure_fk
    foreign key (closure_id, gym_id)
    references public.gym_closures (id, gym_id);

commit;
