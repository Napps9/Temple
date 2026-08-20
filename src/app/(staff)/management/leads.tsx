import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, Link, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { BrandGradientHero } from '@/components/BrandGradientHero';
import { Button } from '@/components/Button';
import { Sheet, SheetAction } from '@/components/Sheet';
import { ChipButton } from '@/components/ChipButton';
import {
  DATE_RE,
  DateRangeCta,
  type Preset,
  isoDate,
  presetRange,
} from '@/components/DateRangeCta';
import { Input } from '@/components/Input';
import { LeadsShell, type LeadsTab } from '@/components/LeadsNav';
import { PageHead } from '@/components/PageHead';
import { FieldLabel } from '@/components/SectionLabel';
import { StatTile } from '@/components/StatTile';
import { TalkToAssistant } from '@/components/TalkToAssistant';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useThemeColors } from '@/lib/theme';
import { useGymBrand } from '@/lib/useGymBrand';
import type { LeadStatus } from '@/types/database';

type LeadRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: LeadStatus;
  source_id: string | null;
  notes: string | null;
  objection: string | null;
  follow_up_at: string | null;
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

// A lead needs following up when a chase date has come due (set by the agent
// on a deferral/decline, or by the nightly stale sweep), or — before either
// fires — when it's still cold and has sat untouched for over a day.
function needsFollowUp(l: LeadRow): boolean {
  if (l.follow_up_at) return new Date(l.follow_up_at).getTime() <= Date.now();
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
  const brand = useGymBrand();
  const { data: membership } = useGymMembership();
  const canWorkLeads = useCan('can_work_leads');
  const isOwner = membership?.role === 'owner';
  // compute_insight_summary raises for anyone but owner/admin (it gates on
  // user_can_admin, 0102). can_work_leads — which admits this whole screen
  // — defaults on for coach and staff, so without this the two lifecycle
  // tiles fire a query that always 403s and render its absence as a
  // confident 0. Gate them on the same role the RPC requires.
  const canSeeLifecycle =
    membership?.role === 'owner' || membership?.role === 'admin';
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [search, setSearch] = useState('');
  const [openLead, setOpenLead] = useState<LeadRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [milestoneDismissed, setMilestoneDismissed] = useState(false);

  const tabs: LeadsTab[] = isOwner
    ? ['leads', 'conversations', 'settings']
    : ['leads', 'conversations'];

  const agentSettings = useQuery({
    queryKey: ['agent-settings-brief', membership?.gymId],
    enabled: !!membership?.gymId && isOwner,
    queryFn: async (): Promise<{ vapi_assistant_id: string | null }> => {
      const { data, error } = await supabase
        .from('gym_agent_settings')
        .select('vapi_assistant_id')
        .eq('gym_id', membership!.gymId)
        .maybeSingle();
      if (error) throw error;
      return { vapi_assistant_id: data?.vapi_assistant_id ?? null };
    },
  });

  // "First real lead" needs no stored flag — a real conversation is any
  // agent_conversations row that isn't the synthetic browser-test thread
  // (phone='web-test'), so this is exactly 1 the moment it happens.
  const firstRealLead = useQuery({
    queryKey: ['agent-first-real-lead', membership?.gymId],
    enabled: !!membership?.gymId && canWorkLeads === true,
    queryFn: async (): Promise<boolean> => {
      const { count, error } = await supabase
        .from('agent_conversations')
        .select('id', { count: 'exact', head: true })
        .eq('gym_id', membership!.gymId)
        .neq('phone', 'web-test');
      if (error) throw error;
      return count === 1;
    },
  });

  const leads = useQuery({
    queryKey: ['leads', membership?.gymId, scope],
    enabled: !!membership?.gymId && canWorkLeads === true,
    queryFn: async (): Promise<LeadRow[]> => {
      let q = supabase
        .from('leads')
        .select(
          'id, full_name, email, phone, status, source_id, notes, objection, follow_up_at, captured_at, assigned_coach_id, assigned_at, marketing_consent, converted_profile_id, source:lead_sources!source_id(label, color), assignee:profiles!assigned_coach_id(full_name)',
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
    enabled: !!membership?.gymId && canWorkLeads === true,
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
    enabled: !!membership?.gymId && canWorkLeads === true,
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

  const [preset, setPreset] = useState<Preset>('month');
  const [customStart, setCustomStart] = useState(() => isoDate(new Date()));
  const [customEnd, setCustomEnd] = useState(() => isoDate(new Date()));
  const range = useMemo(
    () =>
      preset === 'custom'
        ? { start: customStart, end: customEnd }
        : presetRange(preset, new Date()),
    [preset, customStart, customEnd],
  );
  const { start, end } = range;
  const rangeValid = DATE_RE.test(start) && DATE_RE.test(end) && start <= end;
  const gymId = membership?.gymId;

  // New leads captured in the period — a plain count against the leads
  // table itself, unlike intro sessions / conversions below which come
  // from the same lifecycle RPC the old Insights tab used.
  const newLeadsCount = useQuery({
    queryKey: ['leads-new-count', gymId, start, end],
    enabled: !!gymId && canWorkLeads === true && rangeValid,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('gym_id', gymId!)
        .gte('captured_at', start)
        .lte('captured_at', `${end}T23:59:59`);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const leadLifecycleStats = useQuery({
    queryKey: ['leads-lifecycle-summary', gymId, start, end],
    enabled: !!gymId && canSeeLifecycle && rangeValid,
    queryFn: async (): Promise<{ intros_new: number; lead_conversions: number }> => {
      const { data, error } = await supabase.rpc('compute_insight_summary', {
        p_gym_id: gymId!,
        p_period_start: start,
        p_period_end: end,
      });
      if (error) throw error;
      const rows = data as unknown as
        | { intros_new: number; lead_conversions: number }[]
        | null;
      return rows?.[0] ?? { intros_new: 0, lead_conversions: 0 };
    },
  });

  if (canWorkLeads === false) return <Redirect href="/management" />;
  if (!membership) return null;

  return (
    <LeadsShell active="leads" tabs={tabs}>
        <PageHead
          title="Leads"
          subtitle="Track prospects from first contact through conversion."
          action={<Button onPress={() => setAddOpen(true)}>Add lead</Button>}
        />

        <View className="gap-3">
          <DateRangeCta
            preset={preset}
            range={range}
            customStart={customStart}
            customEnd={customEnd}
            onChange={(next) => {
              setPreset(next.preset);
              if (next.preset === 'custom') {
                setCustomStart(next.start);
                setCustomEnd(next.end);
              }
            }}
          />
          <View className="flex-row gap-3 flex-wrap">
            <StatTile
              title="New leads"
              value={newLeadsCount.isLoading ? '—' : newLeadsCount.data ?? 0}
              subtitle="captured this period"
            />
            {canSeeLifecycle ? (
              <>
                <StatTile
                  title="Intro sessions"
                  value={
                    leadLifecycleStats.isLoading
                      ? '—'
                      : leadLifecycleStats.data?.intros_new ?? 0
                  }
                  subtitle="started this period"
                />
                <StatTile
                  title="Conversion to member"
                  value={
                    leadLifecycleStats.isLoading
                      ? '—'
                      : leadLifecycleStats.data?.lead_conversions ?? 0
                  }
                  subtitle="in this period"
                />
              </>
            ) : null}
          </View>
        </View>

        {isOwner && agentSettings.data?.vapi_assistant_id && Platform.OS === 'web' ? (
          <BrandGradientHero color={colors.primary}>
            <Pressable
              onPress={() => setCallOpen(true)}
              className="flex-row items-center gap-5 px-7 py-6 active:opacity-90">
              <View className="w-[46px] h-[46px] rounded-2xl items-center justify-center bg-white/20">
                <Ionicons name="mic" size={22} color="#FFFFFF" />
              </View>
              <View className="flex-1">
                <Text className="text-white font-bold text-[19px] leading-6">
                  Hear how it sounds right now
                </Text>
                <Text className="text-white/85 text-[13px] mt-1">
                  No phone needed — talk to your AI right here in the browser.
                </Text>
              </View>
              <View className="bg-white rounded-lg px-4 py-2.5">
                <Text className="font-semibold text-xs" style={{ color: colors.primary }}>
                  Start talking
                </Text>
              </View>
            </Pressable>
          </BrandGradientHero>
        ) : isOwner && agentSettings.data?.vapi_assistant_id ? (
          // Browser voice calls need @vapi-ai/web, which only exists on web
          // (the native TalkToAssistant is a hard no-op) — a "Start talking"
          // button here would just do nothing when tapped on the phone app.
          <BrandGradientHero color={colors.primary}>
            <View className="flex-row items-center gap-5 px-7 py-6">
              <View className="w-[46px] h-[46px] rounded-2xl items-center justify-center bg-white/20">
                <Ionicons name="mic" size={22} color="#FFFFFF" />
              </View>
              <View className="flex-1">
                <Text className="text-white font-bold text-[19px] leading-6">Talk to your AI</Text>
                <Text className="text-white/85 text-[13px] mt-1">
                  Best on desktop for now — open Temple in a browser to talk to it live.
                </Text>
              </View>
            </View>
          </BrandGradientHero>
        ) : isOwner ? (
          <Link href="/management/leads/agent-setup" asChild>
            <Pressable className="flex-row items-center gap-3 bg-primary/10 border border-primary/30 rounded-xl p-4 active:opacity-80">
              <Ionicons name="sparkles" size={22} color={colors.primary} />
              <View className="flex-1">
                <Text className="text-primary font-semibold">AI Sales Agent</Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  Set up an assistant that answers and sells memberships to new leads.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.primary} />
            </Pressable>
          </Link>
        ) : null}

        {firstRealLead.data && !milestoneDismissed ? (
          <View className="flex-row items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-300/50 dark:border-amber-700/40 rounded-xl px-4 py-3">
            <View className="w-8 h-8 rounded-full items-center justify-center bg-amber-400">
              <Ionicons name="sparkles" size={15} color="#3A2C05" />
            </View>
            <Text className="flex-1 text-ink-2 dark:text-ink-2-dk text-xs leading-5">
              <Text className="font-semibold">Your AI just had its first real conversation</Text>{' '}
              with a prospect.
            </Text>
            <Link href="/management/leads/conversations" asChild>
              <Pressable hitSlop={6}>
                <Text className="text-primary text-xs font-semibold">Review →</Text>
              </Pressable>
            </Link>
            <Pressable onPress={() => setMilestoneDismissed(true)} hitSlop={6}>
              <Ionicons name="close" size={14} color={colors.ink3} />
            </Pressable>
          </View>
        ) : null}

        <View className="flex-row items-center gap-2">
          {(['active', 'all'] as const).map((s) => {
            const sel = scope === s;
            return (
              <Pressable
                key={s}
                onPress={() => setScope(s)}
                className={`px-3 py-1.5 rounded-full border ${
                  sel ? 'bg-primary border-primary' : 'border-line dark:border-line-dk'
                }`}>
                <Text
                  className={`text-xs font-medium ${
                    sel ? 'text-white' : 'text-ink-2 dark:text-ink-2-dk'
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
          <Text className="text-ink-2 dark:text-ink-2-dk">Loading…</Text>
        ) : (leads.data?.length ?? 0) === 0 ? (
          <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-6 items-center gap-2">
            <Ionicons name="people-outline" size={32} color={colors.ink3} />
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm text-center">
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
                    <Text className="text-ink dark:text-ink-dk text-sm font-semibold">
                      {STATUS_LABELS[status]}
                    </Text>
                    <Text className="text-ink-3 dark:text-ink-3-dk text-xs num">
                      {items.length}
                    </Text>
                  </View>
                  {items.length === 0 ? (
                    <View className="rounded-xl border border-dashed border-line dark:border-line-dk p-4">
                      <Text className="text-ink-3 dark:text-ink-3-dk text-xs text-center">
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
                          className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-3 gap-2 active:opacity-70">
                          <Text className="text-ink dark:text-ink-dk font-medium">
                            {l.full_name}
                          </Text>
                          {l.email || l.phone ? (
                            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                              {[l.email, l.phone].filter(Boolean).join(' · ')}
                            </Text>
                          ) : null}
                          {l.objection ? (
                            <View className="flex-row items-center gap-1">
                              <Ionicons
                                name="chatbubble-ellipses-outline"
                                size={12}
                                color="#D97706"
                              />
                              <Text
                                className="text-amber-700 dark:text-amber-300 text-xs flex-1"
                                numberOfLines={1}>
                                {l.objection}
                              </Text>
                            </View>
                          ) : null}
                          <View className="flex-row items-center flex-wrap gap-2">
                            <View className="flex-row items-center gap-1">
                              <Ionicons
                                name="person-circle-outline"
                                size={14}
                                color={colors.ink3}
                              />
                              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
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
      {callOpen ? (
        <TalkToAssistant
          assistantId={agentSettings.data?.vapi_assistant_id ?? null}
          gymName={brand.gymName}
          presentation="docked"
          onRequestClose={() => setCallOpen(false)}
        />
      ) : null}
    </LeadsShell>
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
    <Sheet
      visible={visible}
      title="Add a lead"
      onClose={onClose}
      actions={
        <>
          <SheetAction>
            <Button variant="secondary" onPress={onClose}>
              Cancel
            </Button>
          </SheetAction>
          <SheetAction grow>
            <Button
              onPress={() => save.mutate()}
              loading={save.isPending}
              disabled={name.trim() === ''}>
              Save
            </Button>
          </SheetAction>
        </>
      }>
            <View className="gap-4 pb-1">
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
                  <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
                    Source
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    <Pressable
                      onPress={() => setSourceId(null)}
                      className={`px-3 py-1.5 rounded-full border ${
                        sourceId === null
                          ? 'border-primary bg-primary/10'
                          : 'border-line dark:border-line-dk'
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
                            sel ? 'border-primary' : 'border-line dark:border-line-dk'
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

            </View>
    </Sheet>
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

  const clearFollowUp = useMutation({
    mutationFn: async () => {
      if (!lead) throw new Error('No lead selected');
      const { error: e } = await supabase.rpc('clear_lead_follow_up', {
        p_lead_id: lead.id,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (e) => setError(errorMessage(e, 'Could not clear the follow-up')),
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
    <Sheet
      visible={visible}
      title={lead.full_name}
      subtitle={
        lead.email || lead.phone
          ? [lead.email, lead.phone].filter(Boolean).join(' · ')
          : undefined
      }
      onClose={onClose}
      dialogWidth={520}
      actions={
        <SheetAction grow>
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
        </SheetAction>
      }>
            <View className="gap-4 pb-1">

              {lead.notes ? (
                <View className="bg-raised dark:bg-raised-dk rounded-lg p-3">
                  <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                    {lead.notes}
                  </Text>
                </View>
              ) : null}

              {lead.objection || lead.follow_up_at ? (
                <View className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-lg p-3 gap-2">
                  {lead.objection ? (
                    <Text className="text-amber-800 dark:text-amber-200 text-sm">
                      Concern raised:{' '}
                      <Text className="font-semibold">{lead.objection}</Text>
                    </Text>
                  ) : null}
                  {lead.follow_up_at ? (
                    <Text className="text-amber-700 dark:text-amber-300 text-xs">
                      {new Date(lead.follow_up_at).getTime() <= Date.now()
                        ? 'Due to follow up now.'
                        : `Follow up from ${new Date(lead.follow_up_at).toLocaleDateString(
                            'en-GB',
                            { day: 'numeric', month: 'short' },
                          )}.`}
                    </Text>
                  ) : null}
                  {lead.follow_up_at ? (
                    <ChipButton
                      label="Mark followed up"
                      icon="checkmark-done-outline"
                      tone="amber"
                      onPress={() => clearFollowUp.mutate()}
                    />
                  ) : null}
                </View>
              ) : null}

              {convertPicker ? (
                <View className="gap-2">
                  <FieldLabel>
                    Link to a member
                  </FieldLabel>
                  <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
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
                      <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                        Loading…
                      </Text>
                    ) : (members.data?.length ?? 0) === 0 ? (
                      <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                        No matching members in this gym.
                      </Text>
                    ) : (
                      <View className="gap-1.5">
                        {(members.data ?? []).map((m) => (
                          <Pressable
                            key={m.profile_id}
                            onPress={() => convert.mutate(m.profile_id)}
                            disabled={convert.isPending}
                            className="flex-row items-center gap-3 rounded-lg px-2 py-2 active:bg-raised dark:active:bg-raised-dk">
                            <Text className="text-ink dark:text-ink-dk flex-1">
                              {m.full_name ?? 'Member'}
                            </Text>
                            <Ionicons name="chevron-forward" size={16} color={colors.ink3} />
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
                  <FieldLabel>
                    Assign to
                  </FieldLabel>
                  <ScrollView className="max-h-56">
                    <View className="gap-1.5">
                      {coaches.map((c) => {
                        const sel = c.profile_id === lead.assigned_coach_id;
                        return (
                          <Pressable
                            key={c.profile_id}
                            onPress={() => reassign.mutate(c.profile_id)}
                            disabled={reassign.isPending}
                            className="flex-row items-center gap-3 rounded-lg px-2 py-2 active:bg-raised dark:active:bg-raised-dk">
                            <Ionicons
                              name={sel ? 'checkmark-circle' : 'ellipse-outline'}
                              size={18}
                              color={sel ? '#10B981' : '#9CA3AF'}
                            />
                            <Text className="text-ink dark:text-ink-dk flex-1">
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
                    <FieldLabel>
                      Assigned to
                    </FieldLabel>
                    <View className="flex-row items-center justify-between gap-3">
                      <View className="flex-row items-center gap-2">
                        <Ionicons
                          name="person-circle-outline"
                          size={18}
                          color={colors.ink3}
                        />
                        <Text className="text-ink dark:text-ink-dk">
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
                              : 'text-ink-2 dark:text-ink-2-dk'
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
                    <FieldLabel>
                      Status
                    </FieldLabel>
                    <View className="flex-row flex-wrap gap-2">
                      {STATUS_ORDER.map((s) => {
                        const sel = lead.status === s;
                        return (
                          <Pressable
                            key={s}
                            onPress={() => setStatus.mutate(s)}
                            disabled={setStatus.isPending}
                            className={`px-3 py-1.5 rounded-full border ${
                              sel ? 'border-primary' : 'border-line dark:border-line-dk'
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
                <Text
                  accessibilityLiveRegion="polite"
                  className="text-red-500 dark:text-red-400 text-[13px]">
                  {error}
                </Text>
              ) : null}
            </View>
    </Sheet>
  );
}
