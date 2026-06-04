import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { MemberTagChip } from '@/components/MemberTagChip';
import { RemoveMemberDialog } from '@/components/RemoveMemberDialog';
import { Screen } from '@/components/Screen';
import { useGymMembership, useRole } from '@/lib/auth';
import { can } from '@/lib/can';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

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
  const role = useRole();
  const { data: membership } = useGymMembership();
  const router = useRouter();
  const params = useLocalSearchParams<{ profile: string }>();
  const profileId = params.profile;
  const queryClient = useQueryClient();
  const [showRemove, setShowRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRemove = can(role, 'can_archive_members');

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

  if (role && !can(role, 'can_manage_tags')) {
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
              <Pressable
                onPress={() => restore.mutate()}
                disabled={restore.isPending}
                className="self-start px-3 py-1.5 rounded-md border border-amber-300 dark:border-amber-700 active:bg-amber-100 dark:active:bg-amber-900/40">
                <Text className="text-amber-700 dark:text-amber-300 text-xs uppercase tracking-widest">
                  Restore member
                </Text>
              </Pressable>
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
          <Link
            href={{ pathname: '/management/tags', params: { profile: profileId } }}
            asChild>
            <Pressable className="px-2 py-0.5 rounded-full border border-dashed border-gray-300 dark:border-gray-600">
              <Text className="text-gray-500 dark:text-gray-400 text-[10px] uppercase tracking-widest">
                Manage tags
              </Text>
            </Pressable>
          </Link>
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

        <Section title="Onboarding">
          {gymMembership.data?.par_q_id ? (
            <View className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                PAR-Q completed at onboarding — health screening available in a
                later release.
              </Text>
            </View>
          ) : null}
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
          <Pressable
            onPress={() => setShowRemove(true)}
            className="self-start px-3 py-1.5 rounded-md border border-red-300 dark:border-red-700 active:bg-red-50 dark:active:bg-red-900/20">
            <Text className="text-red-600 dark:text-red-400 text-xs uppercase tracking-widest">
              Remove member
            </Text>
          </Pressable>
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
