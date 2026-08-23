// Lives here rather than under app/ because it has no route of its own.
// /management/operating was a Screen, a BackLink and a heading wrapped
// around this panel, and the Manage screen's Settings tab already rendered
// the same component behind the same capability. The closures card that
// shared that route is now its own section — see ClosuresCard.tsx.

import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Text, TextInput } from './Text';

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { DurationField } from '@/components/DurationField';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import type { Discipline } from '@/lib/movements';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import { useCan } from '@/lib/useCan';
import { useGymAllowMinors } from '@/lib/useGymAllowMinors';
import { useGymCurrency } from '@/lib/useGymCurrency';
import { useGymWeightUnit } from '@/lib/useGymWeightUnit';
import { WEIGHT_UNIT_OPTIONS, type WeightUnit } from '@/lib/weight';
import { useGymDiscipline } from '@/lib/useGymDiscipline';
import { useSavedFlag } from '@/lib/useSavedFlag';

// A short, common-case currency list for the manual override. Stripe can
// set any ISO code on connect (the RPC accepts any three-letter code);
// this list just covers the gyms picking by hand.
const CURRENCY_OPTIONS: { key: string; label: string }[] = [
  { key: 'GBP', label: 'British Pound (£)' },
  { key: 'USD', label: 'US Dollar ($)' },
  { key: 'EUR', label: 'Euro (€)' },
  { key: 'AUD', label: 'Australian Dollar (A$)' },
  { key: 'CAD', label: 'Canadian Dollar (C$)' },
  { key: 'NZD', label: 'New Zealand Dollar (NZ$)' },
];

type Defaults = {
  week_starts_on: 'mon' | 'sun';
  timezone: string;
  default_class_capacity: number;
  default_class_minutes: number;
  expiring_within_days: number;
  parq_expiry_days: number;
  health_retention_months: number;
  lead_conversion_window_days: number;
  subscription_resolution: 'credits_first' | 'newest_first' | 'highest_priority';
  booking_window_hours_ahead: number | null;
  booking_cutoff_minutes_before: number;
  cancel_cutoff_minutes_before: number;
  cancel_cutoff_mode: 'relative' | 'day_before';
  cancel_cutoff_time: string | null;
  cancel_cutoff_days_before: number;
  cover_warning_hours: number;
};

// Each card saves independently. The gyms columns share one RPC, so a
// section save sends the server's values for every other section — a
// card's Save can never commit a neighbouring card's unsaved edits.
type SectionKey =
  | 'discipline'
  | 'minors'
  | 'currency'
  | 'weightUnit'
  | 'week'
  | 'class'
  | 'memberships'
  | 'booking'
  | 'cover'
  | 'health'
  | 'leads';

const SECTION_FIELDS: Partial<Record<SectionKey, (keyof Defaults)[]>> = {
  week: ['week_starts_on', 'timezone'],
  class: ['default_class_capacity', 'default_class_minutes'],
  memberships: ['expiring_within_days'],
  booking: [
    'booking_window_hours_ahead',
    'booking_cutoff_minutes_before',
    'cancel_cutoff_minutes_before',
  ],
  cover: ['cover_warning_hours'],
  health: ['parq_expiry_days', 'health_retention_months'],
  leads: ['lead_conversion_window_days'],
};

// Top-level page Settings card links to. Owners only — the underlying
// RPC checks `user_is_owner_of`, but we mirror the gate client-side so
// admins don't see a useless form.
export function OperatingDefaultsPanel() {
  const { data: membership } = useGymMembership();
  const canManageStaff = useCan('can_manage_staff');
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = useState<{
    section: SectionKey;
    message: string;
  } | null>(null);
  const [saved, markSaved] = useSavedFlag();

  const currentDiscipline = useGymDiscipline();
  const [discipline, setDiscipline] = useState<Discipline | null>(null);
  useEffect(() => {
    setDiscipline(currentDiscipline);
  }, [currentDiscipline]);

  const currentCurrency = useGymCurrency();
  const [currency, setCurrency] = useState<string | null>(null);
  useEffect(() => {
    setCurrency(currentCurrency);
  }, [currentCurrency]);

  const currentWeightUnit = useGymWeightUnit();
  const [weightUnit, setWeightUnit] = useState<WeightUnit | null>(null);
  useEffect(() => {
    setWeightUnit(currentWeightUnit);
  }, [currentWeightUnit]);

  const currentAllowMinors = useGymAllowMinors();
  const [allowMinors, setAllowMinors] = useState<boolean | null>(null);
  useEffect(() => {
    setAllowMinors(currentAllowMinors);
  }, [currentAllowMinors]);

  const cfg = useQuery({
    queryKey: ['gym-operating-defaults', membership?.gymId],
    enabled: !!membership?.gymId && canManageStaff !== false,
    queryFn: async (): Promise<Defaults> => {
      const { data, error: e } = await supabase
        .from('gyms')
        .select(
          'week_starts_on, timezone, default_class_capacity, default_class_minutes, expiring_within_days, parq_expiry_days, health_retention_months, lead_conversion_window_days, subscription_resolution, booking_window_hours_ahead, booking_cutoff_minutes_before, cancel_cutoff_minutes_before, cancel_cutoff_mode, cancel_cutoff_time, cancel_cutoff_days_before, cover_warning_hours',
        )
        .eq('id', membership!.gymId)
        .single();
      if (e) throw e;
      return data as Defaults;
    },
  });

  const [draft, setDraft] = useState<Defaults | null>(null);
  useEffect(() => {
    if (!cfg.data) return;
    // Seed once. The post-save refetch must not reseed: sections save
    // independently, so a refetch after saving one card would wipe the
    // unsaved edits sitting in every other card.
    setDraft(
      (d) =>
        d ?? {
          ...cfg.data,
          // Postgres returns 'HH:MM:SS'; the editor works in HH:MM.
          cancel_cutoff_time: cfg.data.cancel_cutoff_time
            ? cfg.data.cancel_cutoff_time.slice(0, 5)
            : null,
        },
    );
  }, [cfg.data]);

  const save = useMutation({
    mutationFn: async (section: SectionKey) => {
      if (!membership) throw new Error('Missing context');

      if (section === 'discipline') {
        if (!discipline || discipline === currentDiscipline) return;
        const { error: de } = await supabase.rpc('set_gym_discipline', {
          p_gym_id: membership.gymId,
          p_discipline: discipline,
        });
        if (de) throw de;
        return;
      }
      if (section === 'currency') {
        if (!currency || currency === currentCurrency) return;
        const { error: ce } = await supabase.rpc('set_gym_currency', {
          p_gym_id: membership.gymId,
          p_currency: currency,
        });
        if (ce) throw ce;
        return;
      }
      if (section === 'weightUnit') {
        if (!weightUnit || weightUnit === currentWeightUnit) return;
        const { error: we } = await supabase.rpc('set_gym_weight_unit', {
          p_gym_id: membership.gymId,
          p_unit: weightUnit,
        });
        if (we) throw we;
        return;
      }
      if (section === 'minors') {
        if (allowMinors === null || allowMinors === currentAllowMinors) return;
        const { error: me } = await supabase.rpc('set_allow_minors', {
          p_gym_id: membership.gymId,
          p_enabled: allowMinors,
        });
        if (me) throw me;
        return;
      }

      if (!draft || !cfg.data) throw new Error('Missing context');
      const merged: Defaults = {
        ...cfg.data,
        cancel_cutoff_time: cfg.data.cancel_cutoff_time
          ? cfg.data.cancel_cutoff_time.slice(0, 5)
          : null,
      };
      for (const field of SECTION_FIELDS[section] ?? []) {
        (merged as Record<string, unknown>)[field] = draft[field];
      }
      const { error: e } = await supabase.rpc('set_gym_operating_defaults', {
        p_gym_id: membership.gymId,
        p_week_starts_on: merged.week_starts_on,
        p_timezone: merged.timezone.trim() || 'UTC',
        p_default_class_capacity: merged.default_class_capacity,
        p_default_class_minutes: merged.default_class_minutes,
        p_expiring_within_days: merged.expiring_within_days,
        p_parq_expiry_days: merged.parq_expiry_days,
        p_health_retention_months: merged.health_retention_months,
        p_lead_conversion_window_days: merged.lead_conversion_window_days,
        p_subscription_resolution: merged.subscription_resolution,
        p_booking_window_hours_ahead: merged.booking_window_hours_ahead,
        p_booking_cutoff_minutes_before: merged.booking_cutoff_minutes_before,
        p_cancel_cutoff_minutes_before: merged.cancel_cutoff_minutes_before,
        // gym-level day_before mode is no longer exposed in the UI —
        // the trigger ignores it, the class-type override owns the
        // absolute cutoff now. Always send 'relative' to keep the
        // gyms row honest with the rendered state.
        p_cancel_cutoff_mode: 'relative',
        p_cancel_cutoff_time: null,
        p_cancel_cutoff_days_before: merged.cancel_cutoff_days_before,
        p_cover_warning_hours: merged.cover_warning_hours,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setSaveError(null);
      markSaved();
      queryClient.invalidateQueries({ queryKey: ['gym-operating-defaults'] });
      queryClient.invalidateQueries({ queryKey: ['gym-discipline'] });
      queryClient.invalidateQueries({ queryKey: ['gym-currency'] });
      queryClient.invalidateQueries({ queryKey: ['gym-weight-unit'] });
      queryClient.invalidateQueries({ queryKey: ['gym-allow-minors'] });
      // Saving stamps operating_defaults_reviewed_at, which flips the
      // 'settings' onboarding step done — refresh the checklist so it
      // ticks without a reload.
      queryClient.invalidateQueries({ queryKey: ['gym-setup-progress'] });
    },
    onError: (e, section) =>
      setSaveError({ section, message: errorMessage(e, 'Could not save') }),
  });

  if (canManageStaff === false) {
    return (
      <Text className="text-ink-2 dark:text-ink-2-dk">
        Only owners can change operating defaults.
      </Text>
    );
  }
  if (!draft) {
    return (
      <Text className="text-ink-2 dark:text-ink-2-dk">Loading…</Text>
    );
  }

  function num(field: keyof Defaults) {
    return (value: string) => {
      const n = parseInt(value, 10);
      if (!Number.isFinite(n)) return;
      setDraft((d) => (d ? { ...d, [field]: n } : d));
    };
  }

  function sectionProps(section: SectionKey) {
    return {
      onSave: () => save.mutate(section),
      saving: save.isPending && save.variables === section,
      saved: saved && save.variables === section,
      error: saveError?.section === section ? saveError.message : null,
    };
  }

  return (
    <View className="gap-4">
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
        These are the per-gym defaults the calendar, the screening
        gates, the cohort logic and the booking resolver read. Each
        replaces a value that used to be the same for every gym; tune
        them to match how you run this gym.
      </Text>

      <Section title="Training discipline" {...sectionProps('discipline')}>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
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

      <Section title="Members under 18" {...sectionProps('minors')}>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          Off by default. When on, a member whose date of birth makes them
          under 18 can join, but must provide a parent or guardian's consent
          before they finish signing up — and you remain responsible for
          confirming that consent is valid. Leave off to refuse under-18
          members entirely.
        </Text>
        <Choice
          label="Allow members under 18"
          options={[
            { key: 'no', label: 'No — adults only (18+)' },
            { key: 'yes', label: 'Yes — with guardian consent' },
          ]}
          value={allowMinors ? 'yes' : 'no'}
          onChange={(v) => setAllowMinors(v === 'yes')}
        />
      </Section>

      <Section title="Billing currency" {...sectionProps('currency')}>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          The currency every price, revenue figure and payout is shown
          in. Connecting Stripe sets this automatically from your Stripe
          account; set it here if you don't use Stripe or want to
          override.
        </Text>
        <Choice
          label="Currency"
          options={
            currency && !CURRENCY_OPTIONS.some((o) => o.key === currency)
              ? [{ key: currency, label: currency }, ...CURRENCY_OPTIONS]
              : CURRENCY_OPTIONS
          }
          value={currency ?? 'GBP'}
          onChange={(v) => setCurrency(v)}
        />
      </Section>

      <Section title="Weight unit" {...sectionProps('weightUnit')}>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          How weights are shown across Track, leaderboards and percentage
          prescriptions. Everything is stored in kilograms and converted for
          display, so switching this re-labels existing results rather than
          changing them — and a member's history stays comparable either
          way.
        </Text>
        <Choice
          label="Show weights in"
          options={WEIGHT_UNIT_OPTIONS.map((o) => ({
            key: o.value,
            label: o.label,
          }))}
          value={weightUnit ?? 'kg'}
          onChange={(v) => setWeightUnit(v as WeightUnit)}
        />
      </Section>

      <Section title="Week & locale" {...sectionProps('week')}>
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

      <Section title="Class defaults" {...sectionProps('class')}>
        <NumField
          label="Default class capacity"
          blurb="The number new class types start with. Each class type can override this."
          value={draft.default_class_capacity}
          onChange={num('default_class_capacity')}
        />
        <DurationField
          label="Default class duration"
          value={String(draft.default_class_minutes)}
          onChange={(v) =>
            setDraft((d) =>
              d
                ? {
                    ...d,
                    default_class_minutes: v.trim() === '' ? 0 : parseInt(v, 10),
                  }
                : d,
            )
          }
          base="minutes"
          units={['minutes', 'hours']}
        />
      </Section>

      <Section title="Memberships" {...sectionProps('memberships')}>
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

      <Section title="Booking windows" {...sectionProps('booking')}>
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

      <Section title="Cover" {...sectionProps('cover')}>
        <DurationField
          label="Warn about uncovered classes"
          blurb="How far ahead to chase the coach who asked and the gym's owners when a class still has nobody covering it. 0 turns the warning off."
          value={String(draft.cover_warning_hours)}
          onChange={(v) =>
            setDraft((d) =>
              d
                ? {
                    ...d,
                    cover_warning_hours:
                      v.trim() === '' ? 0 : parseInt(v, 10),
                  }
                : d,
            )
          }
          base="hours"
          units={['hours', 'days']}
        />
      </Section>

      <Section title="Health screening & retention" {...sectionProps('health')}>
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

      <Section title="Leads" {...sectionProps('leads')}>
        <DurationField
          label="Lead conversion window"
          blurb="When a new member's email matches an open lead captured within this window, the lead is automatically marked converted. Older leads can still be linked manually."
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
    </View>
  );
}

function Section({
  title,
  children,
  onSave,
  saving,
  saved,
  error,
}: {
  title: string;
  children: React.ReactNode;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  error: string | null;
}) {
  return (
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
      <Text className="text-ink dark:text-ink-dk font-semibold">
        {title}
      </Text>
      {children}
      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
      ) : null}
      <Button onPress={onSave} loading={saving} success={saved}>
        Save
      </Button>
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
  const colors = useThemeColors();
  return (
    <View className="gap-1.5">
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
        {label}
      </Text>
      {blurb ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          {blurb}
        </Text>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.ink3}
        autoCapitalize="none"
        autoCorrect={false}
        className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-ctl px-3 py-2.5 text-ink dark:text-ink-dk text-base"
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
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
        {label}
      </Text>
      {blurb ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          {blurb}
        </Text>
      ) : null}
      <TextInput
        value={String(value)}
        onChangeText={onChange}
        keyboardType="number-pad"
        className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-ctl px-3 py-2.5 text-ink dark:text-ink-dk text-base"
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
  const colors = useThemeColors();
  return (
    <View className="gap-1.5">
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
        {label}
      </Text>
      {options.map((o) => {
        const selected = value === o.key;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            className={`flex-row items-center gap-2 rounded-ctl px-3 py-2 border ${
              selected
                ? 'border-transparent bg-raised dark:bg-raised-dk'
                : 'border-line dark:border-line-dk'
            }`}>
            <Ionicons
              name={selected ? 'radio-button-on' : 'radio-button-off'}
              size={18}
              color={selected ? colors.primary : colors.ink3}
            />
            <Text
              className={`text-sm ${
                selected
                  ? 'text-ink dark:text-ink-dk font-medium'
                  : 'text-ink-2 dark:text-ink-2-dk'
              }`}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
