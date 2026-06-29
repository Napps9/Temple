import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { DurationField } from '@/components/DurationField';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import type { Discipline } from '@/lib/movements';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useGymDiscipline } from '@/lib/useGymDiscipline';
import { useSavedFlag } from '@/lib/useSavedFlag';

type Defaults = {
  week_starts_on: 'mon' | 'sun';
  timezone: string;
  default_class_capacity: number;
  default_class_minutes: number;
  expiring_within_days: number;
  parq_expiry_days: number;
  health_retention_months: number;
  lead_conversion_window_days: number;
  materialisation_horizon_weeks: number;
  subscription_resolution: 'credits_first' | 'newest_first' | 'highest_priority';
  booking_window_hours_ahead: number | null;
  booking_cutoff_minutes_before: number;
  cancel_cutoff_minutes_before: number;
  cancel_cutoff_mode: 'relative' | 'day_before';
  cancel_cutoff_time: string | null;
  cancel_cutoff_days_before: number;
};

// Top-level page Settings card links to. Owners only — the underlying
// RPC checks `user_is_owner_of`, but we mirror the gate client-side so
// admins don't see a useless form.
export function OperatingDefaultsPanel() {
  const { data: membership } = useGymMembership();
  const canManageStaff = useCan('can_manage_staff');
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saved, markSaved] = useSavedFlag();

  const currentDiscipline = useGymDiscipline();
  const [discipline, setDiscipline] = useState<Discipline | null>(null);
  useEffect(() => {
    setDiscipline(currentDiscipline);
  }, [currentDiscipline]);

  const cfg = useQuery({
    queryKey: ['gym-operating-defaults', membership?.gymId],
    enabled: !!membership?.gymId && canManageStaff !== false,
    queryFn: async (): Promise<Defaults> => {
      const { data, error: e } = await supabase
        .from('gyms')
        .select(
          'week_starts_on, timezone, default_class_capacity, default_class_minutes, expiring_within_days, parq_expiry_days, health_retention_months, lead_conversion_window_days, materialisation_horizon_weeks, subscription_resolution, booking_window_hours_ahead, booking_cutoff_minutes_before, cancel_cutoff_minutes_before, cancel_cutoff_mode, cancel_cutoff_time, cancel_cutoff_days_before',
        )
        .eq('id', membership!.gymId)
        .single();
      if (e) throw e;
      return data as Defaults;
    },
  });

  const [draft, setDraft] = useState<Defaults | null>(null);
  useEffect(() => {
    if (cfg.data)
      setDraft({
        ...cfg.data,
        // Postgres returns 'HH:MM:SS'; the editor works in HH:MM.
        cancel_cutoff_time: cfg.data.cancel_cutoff_time
          ? cfg.data.cancel_cutoff_time.slice(0, 5)
          : null,
      });
  }, [cfg.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!membership || !draft) throw new Error('Missing context');
      const { error: e } = await supabase.rpc('set_gym_operating_defaults', {
        p_gym_id: membership.gymId,
        p_week_starts_on: draft.week_starts_on,
        p_timezone: draft.timezone.trim() || 'UTC',
        p_default_class_capacity: draft.default_class_capacity,
        p_default_class_minutes: draft.default_class_minutes,
        p_expiring_within_days: draft.expiring_within_days,
        p_parq_expiry_days: draft.parq_expiry_days,
        p_health_retention_months: draft.health_retention_months,
        p_lead_conversion_window_days: draft.lead_conversion_window_days,
        p_materialisation_horizon_weeks: draft.materialisation_horizon_weeks,
        p_subscription_resolution: draft.subscription_resolution,
        p_booking_window_hours_ahead: draft.booking_window_hours_ahead,
        p_booking_cutoff_minutes_before: draft.booking_cutoff_minutes_before,
        p_cancel_cutoff_minutes_before: draft.cancel_cutoff_minutes_before,
        // gym-level day_before mode is no longer exposed in the UI —
        // the trigger ignores it, the class-type override owns the
        // absolute cutoff now. Always send 'relative' to keep the
        // gyms row honest with the rendered state.
        p_cancel_cutoff_mode: 'relative',
        p_cancel_cutoff_time: null,
        p_cancel_cutoff_days_before: draft.cancel_cutoff_days_before,
      });
      if (e) throw e;
      if (discipline && discipline !== currentDiscipline) {
        const { error: de } = await supabase.rpc('set_gym_discipline', {
          p_gym_id: membership.gymId,
          p_discipline: discipline,
        });
        if (de) throw de;
      }
    },
    onSuccess: () => {
      setError(null);
      markSaved();
      queryClient.invalidateQueries({ queryKey: ['gym-operating-defaults'] });
      queryClient.invalidateQueries({ queryKey: ['gym-discipline'] });
      // Saving stamps operating_defaults_reviewed_at, which flips the
      // 'settings' onboarding step done — refresh the checklist so it
      // ticks without a reload.
      queryClient.invalidateQueries({ queryKey: ['gym-setup-progress'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not save')),
  });

  if (canManageStaff === false) {
    return (
      <Text className="text-gray-500 dark:text-gray-400">
        Only owners can change operating defaults.
      </Text>
    );
  }
  if (!draft) {
    return (
      <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
    );
  }

  function num(field: keyof Defaults) {
    return (value: string) => {
      const n = parseInt(value, 10);
      if (!Number.isFinite(n)) return;
      setDraft((d) => (d ? { ...d, [field]: n } : d));
    };
  }

  return (
    <View className="gap-4">
      <Text className="text-gray-500 dark:text-gray-400 text-sm">
        These are the per-gym defaults the calendar, the screening
        gates, the cohort logic and the booking resolver read. Each
        replaces a value that used to be the same for every gym; tune
        them to match how you run this gym.
      </Text>

      <Section title="Training discipline">
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          Sets the flavour of the member Track section. CrossFit shows
          the movement-group catalog (squats, olympic lifts, gymnastics…);
          Hyrox shows the eight race stations, the 1 km run split and
          full/half race simulations. Existing logs are kept either way.
        </Text>
        <Choice
          label="Discipline"
          options={[
            { key: 'crossfit', label: 'CrossFit / functional' },
            { key: 'hyrox', label: 'Hyrox' },
          ]}
          value={discipline ?? 'crossfit'}
          onChange={(v) => setDiscipline(v as Discipline)}
        />
      </Section>

      <Section title="Week & locale">
        <Choice
          label="Week starts on"
          options={[
            { key: 'mon', label: 'Monday' },
            { key: 'sun', label: 'Sunday' },
          ]}
          value={draft.week_starts_on}
          onChange={(v) =>
            setDraft((d) =>
              d ? { ...d, week_starts_on: v as 'mon' | 'sun' } : d,
            )
          }
        />
        <Field
          label="Timezone"
          blurb="IANA timezone string (e.g. Europe/London, America/New_York). Future scheduling work reads this."
          value={draft.timezone}
          onChangeText={(v) =>
            setDraft((d) => (d ? { ...d, timezone: v } : d))
          }
          placeholder="Europe/London"
        />
      </Section>

      <Section title="Class defaults">
        <NumField
          label="Default class capacity"
          blurb="The number new class types start with. Each class type can override this."
          value={draft.default_class_capacity}
          onChange={num('default_class_capacity')}
        />
        <NumField
          label="Default class duration (minutes)"
          value={draft.default_class_minutes}
          onChange={num('default_class_minutes')}
        />
        <NumField
          label="Class materialisation horizon (weeks)"
          blurb="How far ahead recurring schedules turn into bookable sessions."
          value={draft.materialisation_horizon_weeks}
          onChange={num('materialisation_horizon_weeks')}
        />
      </Section>

      <Section title="Memberships">
        <DurationField
          label="“Expiring soon” window"
          blurb="Used by the cohort logic + Members tab badge."
          value={String(draft.expiring_within_days)}
          onChange={(v) =>
            setDraft((d) =>
              d
                ? {
                    ...d,
                    expiring_within_days:
                      v.trim() === '' ? 0 : parseInt(v, 10),
                  }
                : d,
            )
          }
          base="days"
          units={['days', 'weeks', 'months']}
        />
      </Section>

      <Section title="Booking windows">
        <DurationField
          label="Booking opens ahead"
          blurb="The earliest a member can book a class. 0 keeps it open until the class fills; 1 week gives the classic 'books open one week ahead'."
          value={String(draft.booking_window_hours_ahead ?? 0)}
          onChange={(v) => {
            const n = v.trim() === '' ? 0 : parseInt(v, 10);
            setDraft((d) =>
              d
                ? { ...d, booking_window_hours_ahead: n > 0 ? n : null }
                : d,
            );
          }}
          base="hours"
          units={['hours', 'days', 'weeks']}
        />
        <DurationField
          label="Booking closes before start"
          blurb="The latest a member can book before class start. 0 means right up to the start time."
          value={String(draft.booking_cutoff_minutes_before)}
          onChange={(v) =>
            setDraft((d) =>
              d
                ? {
                    ...d,
                    booking_cutoff_minutes_before:
                      v.trim() === '' ? 0 : parseInt(v, 10),
                  }
                : d,
            )
          }
          base="minutes"
          units={['minutes', 'hours', 'days', 'weeks']}
        />
        <DurationField
          label="Free cancellation cutoff"
          blurb="Members can always cancel, but past this cutoff the credit is forfeited. 0 means no late-cancel forfeit. (Per-class-type overrides — including the 'cancel by 9pm the night before' style — live on each class type.)"
          value={String(draft.cancel_cutoff_minutes_before)}
          onChange={(v) =>
            setDraft((d) =>
              d
                ? {
                    ...d,
                    cancel_cutoff_minutes_before:
                      v.trim() === '' ? 0 : parseInt(v, 10),
                  }
                : d,
            )
          }
          base="minutes"
          units={['minutes', 'hours', 'days', 'weeks']}
        />
      </Section>

      <Section title="Health screening & retention">
        <DurationField
          label="PAR-Q expiry"
          blurb="How long a PAR-Q response is valid for. Used for both the entry gate and the booking gate."
          value={String(draft.parq_expiry_days)}
          onChange={(v) =>
            setDraft((d) =>
              d
                ? {
                    ...d,
                    parq_expiry_days: v.trim() === '' ? 0 : parseInt(v, 10),
                  }
                : d,
            )
          }
          base="days"
          units={['days', 'weeks', 'months', 'years']}
        />
        <DurationField
          label="Health-data retention after a member leaves"
          blurb="The retention sweep purges PAR-Q + injury data this long after a member leaves."
          value={String(draft.health_retention_months)}
          onChange={(v) =>
            setDraft((d) =>
              d
                ? {
                    ...d,
                    health_retention_months:
                      v.trim() === '' ? 0 : parseInt(v, 10),
                  }
                : d,
            )
          }
          base="months"
          units={['months', 'years']}
        />
      </Section>

      <Section title="Insights">
        <DurationField
          label="Lead conversion window"
          blurb="The window the leads dashboard reports conversion against."
          value={String(draft.lead_conversion_window_days)}
          onChange={(v) =>
            setDraft((d) =>
              d
                ? {
                    ...d,
                    lead_conversion_window_days:
                      v.trim() === '' ? 0 : parseInt(v, 10),
                  }
                : d,
            )
          }
          base="days"
          units={['days', 'weeks', 'months']}
        />
      </Section>

      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
      ) : null}
      <Button
        onPress={() => save.mutate()}
        loading={save.isPending}
        success={saved}>
        Save changes
      </Button>
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
      <Text className="text-gray-900 dark:text-gray-50 font-semibold">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  blurb,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  blurb?: string;
  placeholder?: string;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
        {label}
      </Text>
      {blurb ? (
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {blurb}
        </Text>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        autoCapitalize="none"
        autoCorrect={false}
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-50 text-base"
      />
    </View>
  );
}

function NumField({
  label,
  value,
  onChange,
  blurb,
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
  blurb?: string;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
        {label}
      </Text>
      {blurb ? (
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {blurb}
        </Text>
      ) : null}
      <TextInput
        value={String(value)}
        onChangeText={onChange}
        keyboardType="number-pad"
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-50 text-base"
      />
    </View>
  );
}

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
        {label}
      </Text>
      {options.map((o) => {
        const selected = value === o.key;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            className={`flex-row items-center gap-2 rounded-lg px-3 py-2 border ${
              selected
                ? 'border-primary bg-primary/10'
                : 'border-gray-200 dark:border-gray-700'
            }`}>
            <Ionicons
              name={selected ? 'radio-button-on' : 'radio-button-off'}
              size={18}
              color={selected ? '#2563EB' : '#9CA3AF'}
            />
            <Text
              className={`text-sm ${
                selected
                  ? 'text-gray-900 dark:text-gray-50 font-medium'
                  : 'text-gray-700 dark:text-gray-200'
              }`}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function OperatingDefaultsPage() {
  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Manage" fallbackHref="/management" />
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Gym settings
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Per-gym dials — training discipline, week start, class
            defaults, booking and cancellation windows, PAR-Q expiry,
            plan resolution, retention.
          </Text>
        </View>
        <OperatingDefaultsPanel />
      </ScrollView>
    </Screen>
  );
}
