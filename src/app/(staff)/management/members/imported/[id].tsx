import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, Switch, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { DatePicker } from '@/components/DatePicker';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { errorMessage, functionErrorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format-date';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

type PendingDetail = {
  id: string;
  gym_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  date_of_birth: string | null;
  plan_name: string | null;
  plan_start: string | null;
  plan_end: string | null;
  next_bill_date: string | null;
  credits_remaining: number | null;
  emergency_contact: string | null;
  tags: string[];
  notes: string | null;
  unsubscribed: boolean;
  status: 'pending' | 'invited' | 'linked' | 'skipped';
  imported_status: string | null;
  created_at: string;
};

type FormState = {
  full_name: string;
  email: string;
  phone: string;
  date_of_birth: string;
  plan_name: string;
  plan_start: string;
  plan_end: string;
  next_bill_date: string;
  credits_remaining: string;
  emergency_contact: string;
  tags: string;
  notes: string;
  unsubscribed: boolean;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const nt = (s: string): string | null => (s.trim().length > 0 ? s.trim() : null);

function rowToForm(r: PendingDetail): FormState {
  return {
    full_name: r.full_name ?? '',
    email: r.email,
    phone: r.phone ?? '',
    date_of_birth: r.date_of_birth ?? '',
    plan_name: r.plan_name ?? '',
    plan_start: r.plan_start ?? '',
    plan_end: r.plan_end ?? '',
    next_bill_date: r.next_bill_date ?? '',
    credits_remaining: r.credits_remaining != null ? String(r.credits_remaining) : '',
    emergency_contact: r.emergency_contact ?? '',
    tags: (r.tags ?? []).join(', '),
    notes: r.notes ?? '',
    unsubscribed: r.unsubscribed,
  };
}

type PendingUpdate = {
  full_name: string | null;
  email: string;
  phone: string | null;
  date_of_birth: string | null;
  plan_name: string | null;
  plan_start: string | null;
  plan_end: string | null;
  next_bill_date: string | null;
  credits_remaining: number | null;
  emergency_contact: string | null;
  tags: string[];
  notes: string | null;
  unsubscribed: boolean;
};

type PatchResult = {
  patch: PendingUpdate | null;
  errors: Partial<Record<keyof FormState, string>>;
};

function buildPatch(form: FormState): PatchResult {
  const errors: Partial<Record<keyof FormState, string>> = {};
  const email = form.email.trim();
  if (!email) errors.email = 'Email is required.';

  const dateFields: [keyof FormState, string][] = [
    ['date_of_birth', 'Date of birth'],
    ['plan_start', 'Plan start'],
    ['plan_end', 'Plan end'],
    ['next_bill_date', 'Next bill date'],
  ];
  for (const [key, label] of dateFields) {
    const v = (form[key] as string).trim();
    if (v && !DATE_RE.test(v)) errors[key] = `${label} must be YYYY-MM-DD.`;
  }

  let credits: number | null = null;
  const creditsStr = form.credits_remaining.trim();
  if (creditsStr) {
    const n = Number(creditsStr);
    if (!Number.isInteger(n) || n < 0) {
      errors.credits_remaining = 'Credits must be a whole number of 0 or more.';
    } else {
      credits = n;
    }
  }

  if (Object.keys(errors).length > 0) return { patch: null, errors };

  return {
    errors,
    patch: {
      full_name: nt(form.full_name),
      email,
      phone: nt(form.phone),
      date_of_birth: nt(form.date_of_birth),
      plan_name: nt(form.plan_name),
      plan_start: nt(form.plan_start),
      plan_end: nt(form.plan_end),
      next_bill_date: nt(form.next_bill_date),
      credits_remaining: credits,
      emergency_contact: nt(form.emergency_contact),
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
      notes: nt(form.notes),
      unsubscribed: form.unsubscribed,
    },
  };
}

export default function ImportedMemberDetailScreen() {
  const { data: membership } = useGymMembership();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const canManageStaff = useCan('can_manage_staff');

  const [form, setForm] = useState<FormState | null>(null);
  const [initial, setInitial] = useState<FormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const query = useQuery({
    queryKey: ['pending-member', id],
    enabled: !!id && canManageStaff === true,
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('pending_members')
        .select(
          'id, gym_id, email, full_name, phone, date_of_birth, plan_name, plan_start, plan_end, next_bill_date, credits_remaining, emergency_contact, tags, notes, unsubscribed, status, imported_status, created_at',
        )
        .eq('id', id)
        .single();
      if (e) throw e;
      return data as PendingDetail;
    },
  });

  const row = query.data;
  useEffect(() => {
    if (row) {
      const f = rowToForm(row);
      setForm(f);
      setInitial(f);
    }
  }, [row]);

  const dirty = useMemo(
    () => !!form && !!initial && JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial],
  );

  async function persist(): Promise<void> {
    if (!form) throw new Error('Not loaded');
    const { patch, errors } = buildPatch(form);
    setFieldErrors(errors);
    if (!patch) throw new Error('Fix the highlighted fields before saving.');
    const { error: e } = await supabase.from('pending_members').update(patch).eq('id', id);
    if (e) throw e;
    setInitial(form);
  }

  const save = useMutation({
    mutationFn: persist,
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['pending-member', id] });
      queryClient.invalidateQueries({ queryKey: ['members-pending', membership?.gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not save changes')),
  });

  const send = useMutation({
    mutationFn: async () => {
      if (!row) throw new Error('Not loaded');
      if (dirty) await persist();
      const { data, error: e } = await supabase.functions.invoke('send-member-join-invites', {
        body: {
          gym_id: row.gym_id,
          pending_member_ids: [id],
          origin: Platform.OS === 'web' ? window.location.origin : undefined,
        },
      });
      if (e) throw new Error(await functionErrorMessage(e));
      return data as { sent: number; failed: number };
    },
    onSuccess: (d) => {
      if (d.sent === 0) {
        setError('Could not send — the email address may be undeliverable.');
        return;
      }
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['pending-member', id] });
      queryClient.invalidateQueries({ queryKey: ['members-pending', membership?.gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not send invite')),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.from('pending_members').delete().eq('id', id);
      if (e) throw e;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members-pending', membership?.gymId] });
      router.replace('/management/members');
    },
    onError: (e) => setError(errorMessage(e, 'Could not delete this import')),
  });

  if (canManageStaff === false) {
    return <Redirect href="/management/members" />;
  }

  const invited = row?.status === 'invited';
  const busy = save.isPending || send.isPending || remove.isPending;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/management/members" />

        {canManageStaff !== true || query.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
        ) : query.error || !row ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">
            {errorMessage(query.error, 'This imported member could not be found.')}
          </Text>
        ) : !form ? null : (
          <>
            <View className="flex-row items-center gap-3">
              <Avatar name={form.full_name || row.email} size={44} />
              <View className="flex-1">
                <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
                  {form.full_name || row.email}
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  Imported {formatDate(row.created_at)} · not signed up
                  {row.imported_status ? ` · was "${row.imported_status}"` : ''}
                </Text>
              </View>
              <View
                style={{ backgroundColor: '#F59E0B' }}
                className="rounded-full px-2 py-0.5">
                <Text className="text-white text-[10px] font-semibold">
                  {invited ? 'Invited' : 'Imported'}
                </Text>
              </View>
            </View>

            {row.status === 'linked' ? (
              <View className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3">
                <Text className="text-emerald-700 dark:text-emerald-300 text-sm">
                  This person has already signed up — their live profile now
                  owns their details.
                </Text>
              </View>
            ) : null}

            <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                Account details
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                These carry onto the member's account automatically when they
                sign up with this email. Fix anything before you invite them.
              </Text>

              <Input
                label="Full name"
                value={form.full_name}
                onChangeText={(v) => setForm({ ...form, full_name: v })}
                placeholder="Jane Doe"
                autoCapitalize="words"
              />
              <Input
                label="Email"
                value={form.email}
                onChangeText={(v) => setForm({ ...form, email: v })}
                error={fieldErrors.email}
                placeholder="member@example.com"
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <Input
                label="Mobile number"
                value={form.phone}
                onChangeText={(v) => setForm({ ...form, phone: v })}
                placeholder="07123 456789"
                keyboardType="phone-pad"
              />
              <DatePicker
                label="Date of birth"
                value={form.date_of_birth}
                onChange={(v) => setForm({ ...form, date_of_birth: v })}
                error={fieldErrors.date_of_birth}
              />
              <Input
                label="Emergency contact"
                value={form.emergency_contact}
                onChangeText={(v) => setForm({ ...form, emergency_contact: v })}
                placeholder="Name and number"
              />
            </View>

            <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                Membership
              </Text>
              <Input
                label="Plan name"
                value={form.plan_name}
                onChangeText={(v) => setForm({ ...form, plan_name: v })}
                placeholder="Monthly Unlimited"
              />
              <Input
                label="Credits remaining"
                value={form.credits_remaining}
                onChangeText={(v) => setForm({ ...form, credits_remaining: v })}
                error={fieldErrors.credits_remaining}
                placeholder="Leave blank for unlimited plans"
                keyboardType="number-pad"
              />
              <DatePicker
                label="Plan start"
                value={form.plan_start}
                onChange={(v) => setForm({ ...form, plan_start: v })}
                error={fieldErrors.plan_start}
              />
              <DatePicker
                label="Plan end (leave blank for ongoing plans)"
                value={form.plan_end}
                onChange={(v) => setForm({ ...form, plan_end: v })}
                error={fieldErrors.plan_end}
              />
              <DatePicker
                label="Next bill date"
                value={form.next_bill_date}
                onChange={(v) => setForm({ ...form, next_bill_date: v })}
                error={fieldErrors.next_bill_date}
              />
            </View>

            <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                Tags & notes
              </Text>
              <Input
                label="Tags (comma-separated)"
                value={form.tags}
                onChangeText={(v) => setForm({ ...form, tags: v })}
                placeholder="founding-member, competitor"
                autoCapitalize="none"
              />
              <Input
                label="Notes"
                value={form.notes}
                onChangeText={(v) => setForm({ ...form, notes: v })}
                placeholder="Anything worth remembering"
                multiline
              />
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-3">
                  <Text className="text-gray-900 dark:text-gray-50 text-sm font-medium">
                    Do not email
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    Carries into your marketing suppression list on signup.
                  </Text>
                </View>
                <Switch
                  value={form.unsubscribed}
                  onValueChange={(v) => setForm({ ...form, unsubscribed: v })}
                />
              </View>
            </View>

            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
            ) : null}

            <View className="gap-2">
              <Button
                variant="primary"
                loading={save.isPending}
                disabled={busy || !dirty}
                onPress={() => save.mutate()}>
                {dirty ? 'Save changes' : 'Saved'}
              </Button>

              {invited ? (
                <Text className="text-gray-500 dark:text-gray-400 text-xs text-center">
                  Invite already sent — waiting for them to sign up.
                </Text>
              ) : row.status === 'pending' ? (
                <Button
                  variant="secondary"
                  loading={send.isPending}
                  disabled={busy}
                  onPress={() => send.mutate()}>
                  {dirty ? 'Save & send invite' : 'Send invite'}
                </Button>
              ) : null}

              {send.data && send.data.sent > 0 ? (
                <Text className="text-emerald-600 dark:text-emerald-400 text-xs text-center">
                  Invite sent.
                </Text>
              ) : null}
            </View>

            <View className="border-t border-gray-200 dark:border-gray-800 pt-4 gap-2">
              {confirmDelete ? (
                <View className="gap-2">
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    Remove this staged import? This only deletes the imported
                    row — it can be re-imported from your CSV.
                  </Text>
                  <View className="flex-row gap-2">
                    <ChipButton
                      label="Cancel"
                      icon="close-outline"
                      tone="neutral"
                      onPress={() => setConfirmDelete(false)}
                    />
                    <Button
                      variant="destructive"
                      loading={remove.isPending}
                      disabled={busy}
                      onPress={() => remove.mutate()}>
                      Delete import
                    </Button>
                  </View>
                </View>
              ) : (
                <ChipButton
                  className="self-start"
                  label="Delete import"
                  icon="trash-outline"
                  tone="red"
                  onPress={() => setConfirmDelete(true)}
                />
              )}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
