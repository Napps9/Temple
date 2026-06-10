import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ActionButton } from '@/components/ActionButton';
import { Avatar } from '@/components/Avatar';
import { ChipButton } from '@/components/ChipButton';
import { MemberTagChip } from '@/components/MemberTagChip';
import { RemoveMemberDialog } from '@/components/RemoveMemberDialog';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

type ProfileRow = {
  full_name: string | null;
  avatar_url: string | null;
};

type MembershipRow = {
  id: string;
  role: string;
  created_at: string;
  left_at: string | null;
  health_flag: boolean;
  par_q_id: string | null;
  emergency_contact: string | null;
};

type CohortRow = {
  is_intro: boolean;
  is_paying: boolean;
  is_active: boolean;
  is_expiring_soon: boolean;
  is_expired: boolean;
  days_until_expiry: number | null;
};

type SubRow = {
  id: string;
  status: string;
  credit_balance: number | null;
  price_cents: number | null;
  paid_period_end: string | null;
  created_at: string;
  membership_plans: { name: string; kind: string } | null;
};

type CompRow = {
  grant_id: string;
  starts_at: string;
  ends_at: string;
  credits_total: number | null;
  credits_remaining: number | null;
  reason: string | null;
  revoked_at: string | null;
};

type TagRow = {
  id: string;
  label: string;
  color: string;
  source: 'manual' | 'auto';
};

type OnboardingRow = {
  id: string;
  question_key: string;
  question_text: string;
  answer: string;
  display_order: number;
  answered_at: string;
};

export default function MemberDetailScreen() {
  const { data: membership } = useGymMembership();
  const router = useRouter();
  const params = useLocalSearchParams<{ profile: string }>();
  const profileId = params.profile;
  const queryClient = useQueryClient();
  const [showRemove, setShowRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManageTags = useCan('can_manage_tags');
  const canRemove = useCan('can_archive_members') ?? false;

  const profile = useQuery({
    queryKey: ['member-detail-profile', profileId],
    enabled: !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, avatar_url')
        .eq('id', profileId!)
        .single();
      if (error) throw error;
      return data as ProfileRow;
    },
  });

  const gymMembership = useQuery({
    queryKey: ['member-detail-membership', membership?.gymId, profileId],
    enabled: !!membership?.gymId && !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('id, role, created_at, left_at, health_flag, par_q_id, emergency_contact')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', profileId!)
        .maybeSingle();
      if (error) throw error;
      return data as MembershipRow | null;
    },
  });

  const cohort = useQuery({
    queryKey: ['member-detail-cohort', membership?.gymId, profileId],
    enabled: !!membership?.gymId && !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_member_cohort')
        .select('is_intro, is_paying, is_active, is_expiring_soon, is_expired, days_until_expiry')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', profileId!)
        .maybeSingle();
      if (error) throw error;
      return data as CohortRow | null;
    },
  });

  const subs = useQuery({
    queryKey: ['member-detail-subs', membership?.gymId, profileId],
    enabled: !!membership?.gymId && !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plan_subscriptions')
        .select('id, status, credit_balance, price_cents, paid_period_end, created_at, membership_plans(name, kind)')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', profileId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SubRow[];
    },
  });

  const comps = useQuery({
    queryKey: ['member-detail-comps', membership?.gymId, profileId],
    enabled: !!membership?.gymId && !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('comp_grants')
        .select('grant_id, starts_at, ends_at, credits_total, credits_remaining, reason, revoked_at')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', profileId!)
        .order('starts_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as CompRow[];
    },
  });

  const tags = useQuery({
    queryKey: ['member-detail-tags', membership?.gymId, profileId],
    enabled: !!membership?.gymId && !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_tags')
        .select('id, label, color, source')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', profileId!);
      if (error) throw error;
      return (data ?? []) as TagRow[];
    },
  });

  const onboarding = useQuery({
    queryKey: ['member-detail-onboarding', membership?.gymId, profileId],
    enabled: !!membership?.gymId && !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('onboarding_responses')
        .select('id, question_key, question_text, answer, display_order, answered_at')
        .eq('gym_id', membership!.gymId)
        .eq('profile_id', profileId!)
        .order('display_order');
      if (error) throw error;
      return (data ?? []) as OnboardingRow[];
    },
  });

  const restore = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym');
      const { error } = await supabase.rpc('rejoin_gym', {
        p_gym_id: membership.gymId,
        p_profile_id: profileId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['members-cohort'] });
      queryClient.invalidateQueries({ queryKey: ['member-detail-membership'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not restore member')),
  });

  if (canManageTags === false) {
    return <Redirect href="/management" />;
  }

  const isRemoved = gymMembership.data?.left_at !== null && gymMembership.data?.left_at !== undefined;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <Pressable
          onPress={() => router.back()}
          className="flex-row items-center gap-1 self-start py-1">
          <Ionicons name="chevron-back" size={18} color="#6B7280" />
          <Text className="text-gray-500 dark:text-gray-400">Members</Text>
        </Pressable>

        <View className="flex-row items-center gap-3">
          <Avatar
            name={profile.data?.full_name}
            avatarUrl={profile.data?.avatar_url}
            size={56}
          />
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              {profile.data?.full_name ?? 'Member'}
            </Text>
            {gymMembership.data ? (
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Joined {gymMembership.data.created_at.slice(0, 10)}
                {isRemoved
                  ? ` · Removed ${gymMembership.data.left_at?.slice(0, 10)}`
                  : ''}
              </Text>
            ) : null}
          </View>
        </View>

        {isRemoved ? (
          <View className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg p-3 gap-2">
            <Text className="text-amber-700 dark:text-amber-300 text-sm font-medium">
              This member has been removed from the gym.
            </Text>
            <Text className="text-amber-700 dark:text-amber-300 text-sm">
              Restoring brings them back to active status, but does NOT
              re-activate any previously-cancelled subscriptions or comp
              grants — re-subscribe them separately.
            </Text>
            {canRemove ? (
              <View className="self-start">
                <ActionButton
                  kind="restore"
                  label={restore.isPending ? 'Restoring…' : 'Restore member'}
                  onPress={() => restore.mutate()}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {cohort.data ? (
          <View className="flex-row flex-wrap gap-1">
            {cohort.data.is_intro ? <Badge label="Intro" color="#10B981" /> : null}
            {cohort.data.is_paying ? <Badge label="Paying" color="#2563EB" /> : null}
            {cohort.data.is_active ? <Badge label="Active" color="#059669" /> : null}
            {cohort.data.is_expiring_soon && cohort.data.days_until_expiry !== null ? (
              <Badge label={`Expires in ${cohort.data.days_until_expiry}d`} color="#F97316" />
            ) : null}
            {cohort.data.is_expired ? <Badge label="Expired" color="#9CA3AF" /> : null}
          </View>
        ) : null}

        <View className="flex-row items-center gap-2 flex-wrap">
          {tags.data && tags.data.length > 0 ? (
            tags.data.map((t) => (
              <MemberTagChip key={t.id} label={t.label} color={t.color} source={t.source} />
            ))
          ) : (
            <Text className="text-gray-400 dark:text-gray-500 text-xs">No tags yet.</Text>
          )}
          <ChipButton
            tone="neutral"
            label="Manage tags"
            icon="pricetags-outline"
            onPress={() =>
              router.push({
                pathname: '/management/tags',
                params: { profile: profileId },
              })
            }
          />
        </View>

        <Section title="Plans">
          {subs.data && subs.data.length > 0 ? (
            subs.data.map((s) => (
              <View
                key={s.id}
                className="bg-white dark:bg-gray-900 rounded-lg p-3 gap-1">
                <Text className="text-gray-900 dark:text-gray-50 font-medium">
                  {s.membership_plans?.name ?? 'Plan'}
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  {s.status}
                  {s.price_cents !== null ? ` · £${(s.price_cents / 100).toFixed(2)}/mo` : ''}
                  {s.credit_balance !== null ? ` · ${s.credit_balance} credits` : ''}
                  {s.paid_period_end
                    ? ` · paid through ${s.paid_period_end.slice(0, 10)}`
                    : ''}
                </Text>
              </View>
            ))
          ) : (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">No plans.</Text>
          )}
        </Section>

        <Section title="Comp grants">
          {comps.data && comps.data.length > 0 ? (
            comps.data.map((c) => (
              <View
                key={c.grant_id}
                className="bg-white dark:bg-gray-900 rounded-lg p-3 gap-1">
                <Text className="text-gray-900 dark:text-gray-50 font-medium">
                  {c.reason ?? 'Comp grant'}
                  {c.revoked_at ? ' (revoked)' : ''}
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  {c.starts_at.slice(0, 10)} → {c.ends_at.slice(0, 10)}
                  {c.credits_remaining !== null
                    ? ` · ${c.credits_remaining}/${c.credits_total} credits`
                    : ''}
                </Text>
              </View>
            ))
          ) : (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">No grants.</Text>
          )}
        </Section>

        <ParqHistorySection
          profileId={profileId!}
          gymId={membership!.gymId}
        />

        <Section title="Onboarding">
          {onboarding.data && onboarding.data.length > 0 ? (
            onboarding.data.map((r) => (
              <View
                key={r.id}
                className="bg-white dark:bg-gray-900 rounded-lg p-3 gap-1">
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  {r.question_text}
                </Text>
                <Text className="text-gray-900 dark:text-gray-50">{r.answer}</Text>
              </View>
            ))
          ) : (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              {gymMembership.data?.par_q_id
                ? 'No non-health responses recorded.'
                : 'Onboarding not yet completed.'}
            </Text>
          )}
        </Section>

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}

        {!isRemoved && canRemove ? (
          <View className="self-start">
            <ActionButton
              kind="remove"
              label="Remove member"
              onPress={() => setShowRemove(true)}
            />
          </View>
        ) : null}
      </ScrollView>

      {membership && profileId ? (
        <RemoveMemberDialog
          visible={showRemove}
          gymId={membership.gymId}
          profileId={profileId}
          memberName={profile.data?.full_name ?? 'this member'}
          onClose={() => setShowRemove(false)}
          onRemoved={() => router.back()}
        />
      ) : null}
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ backgroundColor: color }} className="rounded-full px-2 py-0.5">
      <Text className="text-white text-[10px] font-semibold">{label}</Text>
    </View>
  );
}

type ParqResponseRow = {
  id: string;
  completed_at: string;
  has_flag: boolean;
  questionnaire_id: string;
  parq_questionnaires: { version: number } | null;
};

type ParqAnswerRow = {
  question_id: string;
  answered_yes: boolean;
  explanation: string | null;
  parq_questions: { prompt: string; flag_on_yes: boolean; sort_order: number } | null;
};

function ParqHistorySection({
  profileId,
  gymId,
}: {
  profileId: string;
  gymId: string;
}) {
  const latest = useQuery({
    queryKey: ['parq-latest', gymId, profileId],
    enabled: !!gymId && !!profileId,
    queryFn: async (): Promise<ParqResponseRow | null> => {
      const { data, error } = await supabase
        .from('parq_responses')
        .select(
          'id, completed_at, has_flag, questionnaire_id, parq_questionnaires!questionnaire_id(version)',
        )
        .eq('gym_id', gymId)
        .eq('profile_id', profileId)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ParqResponseRow | null;
    },
  });

  const answers = useQuery({
    queryKey: ['parq-answers', latest.data?.id],
    enabled: !!latest.data?.id,
    queryFn: async (): Promise<ParqAnswerRow[]> => {
      const { data, error } = await supabase
        .from('parq_answers')
        .select(
          'question_id, answered_yes, explanation, parq_questions!question_id(prompt, flag_on_yes, sort_order)',
        )
        .eq('response_id', latest.data!.id);
      if (error) throw error;
      const rows = (data ?? []) as unknown as ParqAnswerRow[];
      return rows.sort(
        (a, b) =>
          (a.parq_questions?.sort_order ?? 0) -
          (b.parq_questions?.sort_order ?? 0),
      );
    },
  });

  return (
    <Section title="PAR-Q">
      {!latest.data ? (
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          Member hasn't filled in the health screening yet.
        </Text>
      ) : (
        <View className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              v{latest.data.parq_questionnaires?.version ?? '—'} ·{' '}
              {latest.data.completed_at.slice(0, 10)}
            </Text>
            {latest.data.has_flag ? (
              <View className="bg-red-600 rounded-full px-2 py-0.5">
                <Text className="text-white text-[10px] font-bold tracking-widest">
                  FLAGGED
                </Text>
              </View>
            ) : (
              <View className="bg-emerald-600 rounded-full px-2 py-0.5">
                <Text className="text-white text-[10px] font-bold tracking-widest">
                  CLEAR
                </Text>
              </View>
            )}
          </View>
          {(answers.data ?? []).map((a) => (
            <View
              key={a.question_id}
              className={`rounded-lg p-3 gap-1 ${
                a.answered_yes && a.parq_questions?.flag_on_yes
                  ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                  : 'bg-white dark:bg-gray-900'
              }`}>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                {a.parq_questions?.prompt ?? '—'}
              </Text>
              <Text className="text-gray-900 dark:text-gray-50">
                {a.answered_yes ? 'Yes' : 'No'}
              </Text>
              {a.explanation ? (
                <Text className="text-gray-500 dark:text-gray-400 text-xs italic">
                  {a.explanation}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </Section>
  );
}
