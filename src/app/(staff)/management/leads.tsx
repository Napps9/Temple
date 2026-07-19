import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, Link, router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useThemeColors } from '@/lib/theme';
import type { LeadStatus } from '@/types/database';

type LeadRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: LeadStatus;
  source_id: string | null;
  notes: string | null;
  captured_at: string;
  assigned_coach_id: string | null;
  assigned_at: string | null;
  marketing_consent: boolean;
  converted_profile_id: string | null;
  source: { label: string; color: string } | null;
  assignee: { full_name: string | null } | null;
};

type SourceRow = {
  id: string;
  label: string;
  color: string;
};

type CoachRow = {
  profile_id: string;
  full_name: string | null;
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  cold: 'Cold',
  contacted: 'Contacted',
  intro_booked: 'Intro booked',
  trial_attended: 'Trial attended',
  committed: 'Committed',
  converted: 'Converted',
  lost: 'Lost',
};

const STATUS_COLORS: Record<LeadStatus, string> = {
  cold: '#9CA3AF',
  contacted: '#3B82F6',
  intro_booked: '#8B5CF6',
  trial_attended: '#10B981',
  committed: '#F59E0B',
  converted: '#059669',
  lost: '#6B7280',
};

const STATUS_ORDER: LeadStatus[] = [
  'cold',
  'contacted',
  'intro_booked',
  'trial_attended',
  'committed',
  'converted',
  'lost',
];

// The live pipeline — 'converted' and 'lost' are terminal, shown only in
// the "All stages" board. 'committed' is the AI close: onboarding staged,
// signup/payment still pending.
const ACTIVE_STATUSES: LeadStatus[] = [
  'cold',
  'contacted',
  'intro_booked',
  'trial_attended',
  'committed',
];

const STALE_MS = 24 * 60 * 60 * 1000;

// A lead needs following up when it's still cold and has sat untouched for
// more than a day (or was never assigned to anyone).
function needsFollowUp(l: LeadRow): boolean {
  if (l.status !== 'cold') return false;
  const since = l.assigned_at ?? l.captured_at;
  return Date.now() - new Date(since).getTime() > STALE_MS;
}

// Best-effort nudge to the edge worker to drain any queued lead emails.
// Never throws — a failed drain leaves the rows queued and retryable.
async function drainLeadEmails(gymId: string) {
  try {
    await supabase.functions.invoke('send-lead-notifications', {
      body: { gym_id: gymId },
    });
  } catch {
    // Non-fatal: the in-app notification already landed and the email
    // stays queued for the owner to retry.
  }
}

export default function LeadsScreen() {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const canAssignPlan = useCan('can_assign_plan');
  const isOwner = membership?.role === 'owner';
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [search, setSearch] = useState('');
  const [openLead, setOpenLead] = useState<LeadRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const leads = useQuery({
    queryKey: ['leads', membership?.gymId, scope],
    enabled: !!membership?.gymId && canAssignPlan === true,
    queryFn: async (): Promise<LeadRow[]> => {
      let q = supabase
        .from('leads')
        .select(
          'id, full_name, email, phone, status, source_id, notes, captured_at, assigned_coach_id, assigned_at, marketing_consent, converted_profile_id, source:lead_sources!source_id(label, color), assignee:profiles!assigned_coach_id(full_name)',
        )
        .eq('gym_id', membership!.gymId)
        .is('archived_at', null)
        .order('captured_at', { ascending: false });
      if (scope === 'active') {
        q = q.in('status', ACTIVE_STATUSES as LeadStatus[]);
      }
      // Newest 500 keeps the board responsive as the agent multiplies
      // volume; anything older is reachable through search-by-detail on
      // the retained rows or the members list once converted.
      const { data, error } = await q.limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as LeadRow[];
    },
  });

  const sources = useQuery({
    queryKey: ['lead-sources', membership?.gymId],
    enabled: !!membership?.gymId && canAssignPlan === true,
    queryFn: async (): Promise<SourceRow[]> => {
      const { data, error } = await supabase
        .from('lead_sources')
        .select('id, label, color')
        .eq('gym_id', membership!.gymId)
        .is('archived_at', null)
        .order('label');
      if (error) throw error;
      return (data ?? []) as SourceRow[];
    },
  });

  const coaches = useQuery({
    queryKey: ['lead-coaches', membership?.gymId],
    enabled: !!membership?.gymId && canAssignPlan === true,
    queryFn: async (): Promise<CoachRow[]> => {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('profile_id, profiles!profile_id(full_name)')
        .eq('gym_id', membership!.gymId)
        .is('left_at', null)
        .in('role', ['owner', 'admin', 'coach', 'staff']);
      if (error) throw error;
      return (data ?? [])
        .map((r) => {
          const row = r as unknown as {
            profile_id: string;
            profiles: { full_name: string | null } | null;
          };
          return {
            profile_id: row.profile_id,
            full_name: row.profiles?.full_name ?? null,
          };
        })
        .sort((a, b) =>
          (a.full_name ?? '').localeCompare(b.full_name ?? ''),
        );
    },
  });

  const followUpCount = (leads.data ?? []).filter(needsFollowUp).length;

  if (canAssignPlan === false) return <Redirect href="/management" />;
  if (!membership) return null;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-5xl md:mx-auto md:w-full">
        <BackLink label="Manage" fallbackHref="/management" />
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              CRM
            </Text>
            <Text className="text-gray-500 dark:text-gray-400">
              Track prospects from first contact through conversion.
            </Text>
          </View>
          <View className="gap-2 items-end">
            <Button onPress={() => setAddOpen(true)}>Add lead</Button>
            <View className="flex-row gap-3">
              <Link href="/management/leads/conversations" asChild>
                <Pressable hitSlop={6} className="active:opacity-70">
                  <Text className="text-primary text-xs font-medium">
                    Conversations
                  </Text>
                </Pressable>
              </Link>
              <Pressable
                onPress={() => setSourcesOpen(true)}
                hitSlop={6}
                className="active:opacity-70">
                <Text className="text-primary text-xs font-medium">
                  Manage sources
                </Text>
              </Pressable>
              {isOwner ? (
                <Link href="/management/leads/settings" asChild>
                  <Pressable hitSlop={6} className="active:opacity-70">
                    <Text className="text-primary text-xs font-medium">
                      Automation
                    </Text>
                  </Pressable>
                </Link>
              ) : null}
            </View>
          </View>
        </View>

        {isOwner ? (
          <Link href="/management/leads/agent-setup" asChild>
            <Pressable className="flex-row items-center gap-3 bg-primary/10 border border-primary/30 rounded-xl p-4 active:opacity-80">
              <Ionicons name="sparkles" size={22} color={colors.primary} />
              <View className="flex-1">
                <Text className="text-primary font-semibold">AI Sales Agent</Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  Set up an assistant that answers and sells memberships to new leads.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.primary} />
            </Pressable>
          </Link>
        ) : null}

        <View className="flex-row items-center gap-2">
          {(['active', 'all'] as const).map((s) => {
            const sel = scope === s;
            return (
              <Pressable
                key={s}
                onPress={() => setScope(s)}
                className={`px-3 py-1.5 rounded-full border ${
                  sel ? 'bg-primary border-primary' : 'border-gray-200 dark:border-gray-700'
                }`}>
                <Text
                  className={`text-xs font-medium ${
                    sel ? 'text-white' : 'text-gray-700 dark:text-gray-200'
                  }`}>
                  {s === 'active'
                    ? `Active pipeline${followUpCount > 0 ? ` · ${followUpCount} to chase` : ''}`
                    : 'All stages'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Input
          label="Search"
          placeholder="Name, phone or email"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />

        {leads.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
        ) : (leads.data?.length ?? 0) === 0 ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-6 items-center gap-2 shadow-card">
            <Ionicons name="people-outline" size={32} color={colors.iconTertiary} />
            <Text className="text-gray-500 dark:text-gray-400 text-sm text-center">
              No leads yet. Tap “Add lead” to capture your first prospect.
            </Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-3 pb-2">
            {(scope === 'active' ? ACTIVE_STATUSES : STATUS_ORDER).map((status) => {
              const needle = search.trim().toLowerCase();
              const items = (leads.data ?? []).filter(
                (l) =>
                  l.status === status &&
                  (!needle ||
                    [l.full_name, l.email, l.phone].some((f) =>
                      (f ?? '').toLowerCase().includes(needle),
                    )),
              );
              return (
                <View key={status} className="w-72 gap-2">
                  <View className="flex-row items-center gap-2 px-1">
                    <View
                      style={{ backgroundColor: STATUS_COLORS[status] }}
                      className="w-2.5 h-2.5 rounded-full"
                    />
                    <Text className="text-gray-900 dark:text-gray-50 text-sm font-semibold">
                      {STATUS_LABELS[status]}
                    </Text>
                    <Text className="text-gray-400 dark:text-gray-500 text-xs num">
                      {items.length}
                    </Text>
                  </View>
                  {items.length === 0 ? (
                    <View className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 p-4">
                      <Text className="text-gray-400 dark:text-gray-500 text-xs text-center">
                        Nothing here yet
                      </Text>
                    </View>
                  ) : (
                    items.map((l) => {
                      const stale = needsFollowUp(l);
                      return (
                        <Pressable
                          key={l.id}
                          onPress={() => setOpenLead(l)}
                          className="bg-white dark:bg-gray-900 rounded-xl p-3 gap-2 active:opacity-70 shadow-card">
                          <Text className="text-gray-900 dark:text-gray-50 font-medium">
                            {l.full_name}
                          </Text>
                          {l.email || l.phone ? (
                            <Text className="text-gray-500 dark:text-gray-400 text-xs">
                              {[l.email, l.phone].filter(Boolean).join(' · ')}
                            </Text>
                          ) : null}
                          <View className="flex-row items-center flex-wrap gap-2">
                            <View className="flex-row items-center gap-1">
                              <Ionicons
                                name="person-circle-outline"
                                size={14}
                                color={colors.iconTertiary}
                              />
                              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                                {l.assignee?.full_name ??
                                  (l.assigned_coach_id ? 'Coach' : 'Unassigned')}
                              </Text>
                            </View>
                            {stale ? (
                              <View className="bg-amber-100 dark:bg-amber-900/40 rounded px-2 py-0.5">
                                <Text className="text-amber-700 dark:text-amber-300 text-[10px] font-semibold uppercase tracking-widest">
                                  Follow up
                                </Text>
                              </View>
                            ) : null}
                            {l.source ? (
                              <View
                                style={{ backgroundColor: l.source.color + '22' }}
                                className="rounded px-2 py-0.5">
                                <Text
                                  style={{ color: l.source.color }}
                                  className="text-[10px] font-semibold uppercase tracking-widest">
                                  {l.source.label}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                        </Pressable>
                      );
                    })
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}
      </ScrollView>

      <AddLeadModal
        visible={addOpen}
        gymId={membership.gymId}
        sources={sources.data ?? []}
        onClose={() => setAddOpen(false)}
        onCreated={() => {
          setAddOpen(false);
          queryClient.invalidateQueries({ queryKey: ['leads'] });
        }}
      />
      <SourcesEditorModal
        visible={sourcesOpen}
        gymId={membership.gymId}
        onClose={() => setSourcesOpen(false)}
      />
      <LeadDetailModal
        visible={openLead !== null}
        lead={openLead}
        gymId={membership.gymId}
        coaches={coaches.data ?? []}
        onClose={() => setOpenLead(null)}
        onChanged={() => {
          setOpenLead(null);
          queryClient.invalidateQueries({ queryKey: ['leads'] });
        }}
      />
    </Screen>
  );
}

function AddLeadModal({
  visible,
  gymId,
  sources,
  onClose,
  onCreated,
}: {
  visible: boolean;
  gymId: string;
  sources: SourceRow[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const colors = useThemeColors();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc('record_lead', {
        p_gym_id: gymId,
        p_full_name: name,
        p_email: email.trim() || null,
        p_phone: phone.trim() || null,
        p_source_id: sourceId,
        p_notes: notes.trim() || null,
      });
      if (e) throw e;
      // Kick the worker so the assigned coach's email goes out promptly.
      await drainLeadEmails(gymId);
    },
    onSuccess: () => {
      setName('');
      setEmail('');
      setPhone('');
      setNotes('');
      setSourceId(null);
      setError(null);
      onCreated();
    },
    onError: (e) => setError(errorMessage(e, 'Could not save lead')),
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md gap-4 max-h-[90%]">
          <ScrollView>
            <View className="gap-4">
              <View className="flex-row items-center justify-between">
                <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
                  Add a lead
                </Text>
                <Pressable
                  onPress={onClose}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  className="w-8 h-8 items-center justify-center rounded-full active:bg-gray-100 dark:active:bg-gray-800">
                  <Ionicons name="close" size={18} color={colors.iconSecondary} />
                </Pressable>
              </View>

              <Input
                label="Name"
                value={name}
                onChangeText={setName}
                placeholder="Alex Test"
                autoCapitalize="words"
              />
              <Input
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="alex@example.com"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
              />
              <Input
                label="Phone"
                value={phone}
                onChangeText={setPhone}
                placeholder="+44…"
                autoCapitalize="none"
                keyboardType="phone-pad"
              />

              {sources.length > 0 ? (
                <View className="gap-1.5">
                  <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
                    Source
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    <Pressable
                      onPress={() => setSourceId(null)}
                      className={`px-3 py-1.5 rounded-full border ${
                        sourceId === null
                          ? 'border-primary bg-primary/10'
                          : 'border-gray-200 dark:border-gray-700'
                      }`}>
                      <Text className="text-xs">None</Text>
                    </Pressable>
                    {sources.map((s) => {
                      const sel = sourceId === s.id;
                      return (
                        <Pressable
                          key={s.id}
                          onPress={() => setSourceId(s.id)}
                          className={`px-3 py-1.5 rounded-full border ${
                            sel ? 'border-primary' : 'border-gray-200 dark:border-gray-700'
                          }`}
                          style={
                            sel ? { backgroundColor: s.color + '22' } : undefined
                          }>
                          <Text
                            className="text-xs"
                            style={sel ? { color: s.color } : undefined}>
                            {s.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              <Input
                label="Notes"
                value={notes}
                onChangeText={setNotes}
                multiline
                placeholder="What did they ask about?"
              />

              {error ? (
                <Text className="text-red-500 dark:text-red-400 text-sm">
                  {error}
                </Text>
              ) : null}

              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Button variant="secondary" onPress={onClose}>
                    Cancel
                  </Button>
                </View>
                <View className="flex-1">
                  <Button
                    onPress={() => save.mutate()}
                    loading={save.isPending}
                    disabled={name.trim() === ''}>
                    Save
                  </Button>
                </View>
              </View>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type NotificationRow = {
  id: string;
  channel: string;
  status: string;
  error: string | null;
  sent_at: string | null;
};

function LeadDetailModal({
  visible,
  lead,
  gymId,
  coaches,
  onClose,
  onChanged,
}: {
  visible: boolean;
  lead: LeadRow | null;
  gymId: string;
  coaches: CoachRow[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [convertPicker, setConvertPicker] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');

  const notifications = useQuery({
    queryKey: ['lead-notifications', lead?.id],
    enabled: visible && !!lead,
    queryFn: async (): Promise<NotificationRow[]> => {
      const { data, error: e } = await supabase
        .from('lead_notifications')
        .select('id, channel, status, error, sent_at')
        .eq('lead_id', lead!.id)
        .order('created_at', { ascending: false });
      if (e) throw e;
      return (data ?? []) as NotificationRow[];
    },
  });

  const latestEmail = (notifications.data ?? []).find(
    (n) => n.channel === 'email',
  );

  const agentConversation = useQuery({
    queryKey: ['lead-conversation', lead?.id],
    enabled: visible && !!lead,
    queryFn: async (): Promise<{ id: string } | null> => {
      const { data, error: e } = await supabase
        .from('agent_conversations')
        .select('id')
        .eq('lead_id', lead!.id)
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (e) throw e;
      return data ?? null;
    },
  });

  const setStatus = useMutation({
    mutationFn: async (next: LeadStatus) => {
      if (!lead) throw new Error('No lead selected');
      if (next === 'converted') {
        setConvertPicker(true);
        return;
      }
      const { error: e } = await supabase.rpc('set_lead_status', {
        p_lead_id: lead.id,
        p_status: next,
        p_converted_profile_id: null,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      if (!convertPicker) onChanged();
    },
    onError: (e) => setError(errorMessage(e, 'Could not change status')),
  });

  const reassign = useMutation({
    mutationFn: async (coachId: string) => {
      if (!lead) throw new Error('No lead selected');
      const { error: e } = await supabase.rpc('set_lead_assignee', {
        p_lead_id: lead.id,
        p_coach_id: coachId,
      });
      if (e) throw e;
      await drainLeadEmails(gymId);
    },
    onSuccess: () => {
      setError(null);
      setReassignOpen(false);
      onChanged();
    },
    onError: (e) => setError(errorMessage(e, 'Could not reassign lead')),
  });

  const nudge = useMutation({
    mutationFn: async () => {
      if (!lead) throw new Error('No lead selected');
      const { error: e } = await supabase.rpc('nudge_lead', {
        p_lead_id: lead.id,
      });
      if (e) throw e;
      await drainLeadEmails(gymId);
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['lead-notifications', lead?.id] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not nudge the coach')),
  });

  const retry = useMutation({
    mutationFn: async (id: string) => {
      const { error: e } = await supabase.rpc('requeue_lead_notification', {
        p_id: id,
      });
      if (e) throw e;
      await drainLeadEmails(gymId);
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['lead-notifications', lead?.id] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not retry the send')),
  });

  const members = useQuery({
    queryKey: ['leads-member-picker', gymId, memberQuery],
    enabled: convertPicker,
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('gym_memberships')
        .select('profile_id, profiles!profile_id(full_name)')
        .eq('gym_id', gymId)
        .is('left_at', null)
        .eq('role', 'member');
      if (e) throw e;
      const rows = (data ?? []).map((r) => {
        const row = r as unknown as {
          profile_id: string;
          profiles: { full_name: string | null } | null;
        };
        return {
          profile_id: row.profile_id,
          full_name: row.profiles?.full_name ?? null,
        };
      });
      const q = memberQuery.trim().toLowerCase();
      const filtered = q
        ? rows.filter((r) => (r.full_name ?? '').toLowerCase().includes(q))
        : rows;
      return filtered.sort((a, b) =>
        (a.full_name ?? '').localeCompare(b.full_name ?? ''),
      );
    },
  });

  const convert = useMutation({
    mutationFn: async (profileId: string) => {
      if (!lead) throw new Error('No lead selected');
      const { error: e } = await supabase.rpc('set_lead_status', {
        p_lead_id: lead.id,
        p_status: 'converted' as LeadStatus,
        p_converted_profile_id: profileId,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      setConvertPicker(false);
      onChanged();
    },
    onError: (e) => setError(errorMessage(e, 'Could not mark converted')),
  });

  if (!lead) return null;

  const sendStatusLabel = (n: NotificationRow) =>
    n.status === 'sent'
      ? 'Email sent'
      : n.status === 'queued'
      ? 'Email queued'
      : n.status === 'failed'
      ? 'Email failed'
      : n.status === 'skipped'
      ? 'Email skipped'
      : n.status;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md gap-4 max-h-[90%]">
          <ScrollView>
            <View className="gap-4">
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1 gap-1">
                  <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
                    {lead.full_name}
                  </Text>
                  {lead.email || lead.phone ? (
                    <Text className="text-gray-500 dark:text-gray-400 text-sm">
                      {[lead.email, lead.phone].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={onClose}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  className="w-8 h-8 items-center justify-center rounded-full active:bg-gray-100 dark:active:bg-gray-800">
                  <Ionicons name="close" size={18} color={colors.iconSecondary} />
                </Pressable>
              </View>

              {lead.notes ? (
                <View className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <Text className="text-gray-700 dark:text-gray-200 text-sm">
                    {lead.notes}
                  </Text>
                </View>
              ) : null}

              {convertPicker ? (
                <View className="gap-2">
                  <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                    Link to a member
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    Pick the member this lead became. (Future signups with a
                    matching email auto-link inside the gym's conversion
                    window.)
                  </Text>
                  <Input
                    label=""
                    value={memberQuery}
                    onChangeText={setMemberQuery}
                    placeholder="Search members"
                  />
                  <ScrollView className="max-h-56">
                    {members.isLoading ? (
                      <Text className="text-gray-500 dark:text-gray-400 text-sm">
                        Loading…
                      </Text>
                    ) : (members.data?.length ?? 0) === 0 ? (
                      <Text className="text-gray-500 dark:text-gray-400 text-sm">
                        No matching members in this gym.
                      </Text>
                    ) : (
                      <View className="gap-1.5">
                        {(members.data ?? []).map((m) => (
                          <Pressable
                            key={m.profile_id}
                            onPress={() => convert.mutate(m.profile_id)}
                            disabled={convert.isPending}
                            className="flex-row items-center gap-3 rounded-lg px-2 py-2 active:bg-gray-100 dark:active:bg-gray-800">
                            <Text className="text-gray-900 dark:text-gray-50 flex-1">
                              {m.full_name ?? 'Member'}
                            </Text>
                            <Ionicons name="chevron-forward" size={16} color={colors.iconTertiary} />
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </ScrollView>
                  <View className="flex-row gap-3">
                    <View className="flex-1">
                      <Button
                        variant="secondary"
                        onPress={() => {
                          setConvertPicker(false);
                          setMemberQuery('');
                        }}>
                        Back
                      </Button>
                    </View>
                  </View>
                </View>
              ) : reassignOpen ? (
                <View className="gap-2">
                  <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                    Assign to
                  </Text>
                  <ScrollView className="max-h-56">
                    <View className="gap-1.5">
                      {coaches.map((c) => {
                        const sel = c.profile_id === lead.assigned_coach_id;
                        return (
                          <Pressable
                            key={c.profile_id}
                            onPress={() => reassign.mutate(c.profile_id)}
                            disabled={reassign.isPending}
                            className="flex-row items-center gap-3 rounded-lg px-2 py-2 active:bg-gray-100 dark:active:bg-gray-800">
                            <Ionicons
                              name={sel ? 'checkmark-circle' : 'ellipse-outline'}
                              size={18}
                              color={sel ? '#10B981' : '#9CA3AF'}
                            />
                            <Text className="text-gray-900 dark:text-gray-50 flex-1">
                              {c.full_name ?? 'Coach'}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </ScrollView>
                  <Button
                    variant="secondary"
                    onPress={() => setReassignOpen(false)}>
                    Back
                  </Button>
                </View>
              ) : (
                <>
                  <View className="gap-2">
                    <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                      Assigned to
                    </Text>
                    <View className="flex-row items-center justify-between gap-3">
                      <View className="flex-row items-center gap-2">
                        <Ionicons
                          name="person-circle-outline"
                          size={18}
                          color={colors.iconTertiary}
                        />
                        <Text className="text-gray-900 dark:text-gray-50">
                          {lead.assignee?.full_name ??
                            (lead.assigned_coach_id ? 'Coach' : 'Unassigned')}
                        </Text>
                      </View>
                      <View className="flex-row gap-2">
                        <ChipButton
                          label="Reassign"
                          icon="swap-horizontal-outline"
                          tone="neutral"
                          onPress={() => setReassignOpen(true)}
                        />
                        {lead.assigned_coach_id ? (
                          <ChipButton
                            label="Nudge"
                            icon="notifications-outline"
                            tone="amber"
                            onPress={() => nudge.mutate()}
                          />
                        ) : null}
                      </View>
                    </View>
                    {latestEmail ? (
                      <View className="flex-row items-center justify-between gap-3">
                        <Text
                          className={`text-xs ${
                            latestEmail.status === 'failed'
                              ? 'text-red-500 dark:text-red-400'
                              : 'text-gray-500 dark:text-gray-400'
                          }`}>
                          {sendStatusLabel(latestEmail)}
                        </Text>
                        {latestEmail.status === 'failed' ? (
                          <ChipButton
                            label="Retry"
                            icon="refresh"
                            tone="red"
                            onPress={() => retry.mutate(latestEmail.id)}
                          />
                        ) : null}
                      </View>
                    ) : null}
                  </View>

                  <View className="gap-2">
                    <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                      Status
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      {STATUS_ORDER.map((s) => {
                        const sel = lead.status === s;
                        return (
                          <Pressable
                            key={s}
                            onPress={() => setStatus.mutate(s)}
                            disabled={setStatus.isPending}
                            className={`px-3 py-1.5 rounded-full border ${
                              sel ? 'border-primary' : 'border-gray-200 dark:border-gray-700'
                            }`}
                            style={
                              sel
                                ? { backgroundColor: STATUS_COLORS[s] + '22' }
                                : undefined
                            }>
                            <Text
                              className="text-xs font-medium"
                              style={sel ? { color: STATUS_COLORS[s] } : undefined}>
                              {STATUS_LABELS[s]}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  {agentConversation.data ? (
                    <View className="flex-row">
                      <ChipButton
                        label="View AI conversation"
                        icon="chatbubbles-outline"
                        tone="neutral"
                        onPress={() => {
                          onClose();
                          router.push(
                            `/management/leads/conversation/${agentConversation.data!.id}`,
                          );
                        }}
                      />
                    </View>
                  ) : null}
                </>
              )}

              {error ? (
                <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
              ) : null}

              <Button variant="secondary" onPress={onClose}>
                Close
              </Button>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const SOURCE_COLOURS = [
  '#EF4444', '#F97316', '#F59E0B', '#10B981',
  '#3B82F6', '#8B5CF6', '#EC4899', '#6B7280',
];

function SourcesEditorModal({
  visible,
  gymId,
  onClose,
}: {
  visible: boolean;
  gymId: string;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [color, setColor] = useState(SOURCE_COLOURS[0]);
  const [error, setError] = useState<string | null>(null);

  const sources = useQuery({
    queryKey: ['lead-sources', gymId],
    enabled: visible,
    queryFn: async (): Promise<SourceRow[]> => {
      const { data, error: e } = await supabase
        .from('lead_sources')
        .select('id, label, color')
        .eq('gym_id', gymId)
        .is('archived_at', null)
        .order('label');
      if (e) throw e;
      return (data ?? []) as SourceRow[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (label.trim() === '') throw new Error('Label is required');
      const { error: e } = await supabase
        .from('lead_sources')
        .insert({ gym_id: gymId, label: label.trim(), color });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      setLabel('');
      setColor(SOURCE_COLOURS[0]);
      queryClient.invalidateQueries({ queryKey: ['lead-sources', gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not add source')),
  });

  const archive = useMutation({
    mutationFn: async (id: string) => {
      const { error: e } = await supabase
        .from('lead_sources')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', id);
      if (e) throw e;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-sources', gymId] });
    },
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md gap-4 max-h-[90%]">
          <ScrollView>
            <View className="gap-4">
              <View className="flex-row items-center justify-between">
                <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
                  Lead sources
                </Text>
                <Pressable
                  onPress={onClose}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  className="w-8 h-8 items-center justify-center rounded-full active:bg-gray-100 dark:active:bg-gray-800">
                  <Ionicons name="close" size={18} color={colors.iconSecondary} />
                </Pressable>
              </View>

              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Where your prospects come from — Instagram, walk-in,
                referral, open day. The chip colour shows up on every
                lead card.
              </Text>

              <View className="gap-2">
                {(sources.data ?? []).length === 0 ? (
                  <Text className="text-gray-400 dark:text-gray-500 text-sm">
                    No sources yet.
                  </Text>
                ) : (
                  (sources.data ?? []).map((s) => (
                    <View
                      key={s.id}
                      className="flex-row items-center gap-3 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                      <View
                        style={{ backgroundColor: s.color }}
                        className="w-4 h-4 rounded-full"
                      />
                      <Text className="text-gray-900 dark:text-gray-50 flex-1">
                        {s.label}
                      </Text>
                      <Pressable
                        onPress={() => archive.mutate(s.id)}
                        hitSlop={8}
                        accessibilityLabel="Archive source">
                        <Ionicons
                          name="trash-outline"
                          size={16}
                          color={colors.iconTertiary}
                        />
                      </Pressable>
                    </View>
                  ))
                )}
              </View>

              <View className="gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
                  Add a source
                </Text>
                <Input
                  label=""
                  value={label}
                  onChangeText={setLabel}
                  placeholder="Instagram"
                />
                <View className="flex-row flex-wrap gap-2">
                  {SOURCE_COLOURS.map((c) => {
                    const sel = c === color;
                    return (
                      <Pressable
                        key={c}
                        onPress={() => setColor(c)}
                        style={{ backgroundColor: c }}
                        className={`w-8 h-8 rounded-full ${
                          sel ? 'border-2 border-gray-900 dark:border-gray-50' : ''
                        }`}
                      />
                    );
                  })}
                </View>
                {error ? (
                  <Text className="text-red-500 dark:text-red-400 text-sm">
                    {error}
                  </Text>
                ) : null}
                <Button
                  onPress={() => create.mutate()}
                  loading={create.isPending}
                  disabled={label.trim() === ''}>
                  Add source
                </Button>
              </View>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
