-- Recurrence-edit materialisation hole.
--
-- extend_recurrence walks from materialized_until+1 onward. If an
-- owner adds new times to (or new days-of-week to) an existing
-- recurrence, only dates AFTER the existing cursor pick up the new
-- combinations — already-materialised days retain their old set
-- silently. Reported on Mon 15 June: CrossFit recurrence was edited
-- to include 12:00 / 17:30 / 18:30 alongside the original 05:00 /
-- 06:00 / 09:30, but the day view still only showed the morning
-- block because materialized_until had already advanced past today.
--
-- Fix: a BEFORE UPDATE trigger resets materialized_until to null
-- whenever the pattern columns change. The next extend_recurrence
-- call (auto-fires on calendar mount) walks from starts_on, hits
-- ON CONFLICT DO NOTHING for existing rows, and inserts the new
-- combinations into already-materialised days.
--
-- One-time backfill: null out materialized_until on every existing
-- recurrence so the same fix lands for gyms that already edited
-- patterns under the old behaviour. The next mount of the calendar
-- re-walks and refills.

begin;

create or replace function public._reset_recurrence_materialised_on_pattern_change()
returns trigger
language plpgsql
as $$
begin
  if NEW.times is distinct from OLD.times
     or NEW.days_of_week is distinct from OLD.days_of_week then
    NEW.materialized_until := null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists class_recurrences_reset_materialised
  on public.class_recurrences;

create trigger class_recurrences_reset_materialised
  before update on public.class_recurrences
  for each row
  execute function public._reset_recurrence_materialised_on_pattern_change();

-- One-time backfill so existing gyms with stale materialisations
-- get their missing combinations on next calendar mount.
update public.class_recurrences
  set materialized_until = null;

commit;
