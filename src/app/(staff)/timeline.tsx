import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { MemberTagChip } from '@/components/MemberTagChip';
import { MoneyJobCard } from '@/components/MoneyJobCard';
import { RuleSheet } from '@/components/RuleSheet';
import { Screen } from '@/components/Screen';
import { REQUIRED_SETUP_KEYS } from './setup';
import { useGymMembership, useRole, useSession } from '@/lib/auth';
import {
  actionsFor,
  findAction,
  type ActionPreview,
  type AnyAction,
} from '@/lib/actions';
import type { Capability } from '@/lib/can';
import { dateRangeWindow } from '@/lib/date-range';
import { DEFAULT_AUDIENCE } from '@/lib/email/audience';
import { formatDate } from '@/lib/format-date';
import { useDecideChangeRequest } from '@/lib/membership-changes';
import {
  choicesFromGym,
  GYM_RULES_SELECT,
  type ClassTypeCancelRow,
  type GymRulesRow,
} from '@/lib/rules-read';
import {
  classEditWindow,
  DEFAULT_EDIT_WEEKS,
  describeEditTarget,
  matchMembers,
  memberStatus,
  sanitiseClassEdit,
  sanitiseMemberQuery,
  type ClassEditRequest,
  type MemberStatus,
} from '@/lib/chat-lookup';
import {
  describeBulkEdit,
  describeBulkEditResult,
  type BulkEditResult,
} from '@/lib/bulk-class-edit';
import { applyPlans, applyRules, applyTimetable } from '@/lib/setup-apply';
import {
  fieldLabel,
  formatDays,
  formatPrice,
  ruleChangeLine,
  ruleSheet,
  sanitisePlans,
  sanitiseRuleChanges,
  sanitiseTimetable,
  sheetLineText,
  type PlansProposal,
  type RuleChange,
  type RuleChoices,
  type RuleField,
  type TimetableProposal,
} from '@/lib/setup-flow';
import {
  newsletterDocument,
  sanitiseNewsletter,
  type NewsletterDraft,
} from '@/lib/newsletter-draft';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import { useCanFn } from '@/lib/useCan';
import { useGymBrand } from '@/lib/useGymBrand';
import {
  formatClock,
  formatTimelineLine,
  groupTimelineByDay,
  type TimelineEvent,
} from '@/lib/timeline';
import type { Json } from '@/types/database';

// The Timeline (docs/roadmap.md phases 1, 3 and 4): the staff home. The
// stream is the gym's existing activity, read-only; the talk bar is the
// owner's pen — rules, new classes, new plans, closures and edits to the
// classes already on the calendar, as sentences, parsed to a proposal,
// confirmed on a card, applied through the same writes the manual editors
// use. The bar also answers: asking about a member resolves the name and
// brings the member back as a card, with the profile a tap behind it.
// Reads run in the owner's own session under RLS, so the bar sees exactly
// what the screens see. Scope is narrow and honest: anything else gets a
// plain "not from here yet", never a guess.

function useTimelineFeed(gymId: string | undefined) {
  return useQuery({
    queryKey: ['timeline-feed', gymId],
    enabled: !!gymId,
    staleTime: 30_000,
    queryFn: async (): Promise<TimelineEvent[]> => {
      const { data, error } = await supabase.rpc('timeline_feed', {
        p_gym_id: gymId!,
        p_limit: 100,
      });
      if (error) throw error;
      return (data ?? []) as TimelineEvent[];
    },
  });
}

function useMoneyAuthority(gymId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['agent-authority', gymId],
    enabled: !!gymId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agent_authority')
        .select('action_kind, level')
        .eq('gym_id', gymId!);
      if (error) throw error;
      return data ?? [];
    },
  });
}

type GymRules = {
  choices: RuleChoices;
  defaults: { capacity: number; minutes: number };
};

function useGymRules(gymId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['gym-rules', gymId],
    enabled: !!gymId && enabled,
    queryFn: async (): Promise<GymRules> => {
      const [gymRes, typesRes] = await Promise.all([
        supabase.from('gyms').select(GYM_RULES_SELECT).eq('id', gymId!).single(),
        supabase
          .from('class_types')
          .select(
            'cancel_cutoff_mode, cancel_cutoff_time, cancel_cutoff_minutes_before',
          )
          .eq('gym_id', gymId!)
          .is('archived_at', null),
      ]);
      if (gymRes.error || !gymRes.data) {
        throw gymRes.error ?? new Error('Could not read settings');
      }
      const gym = gymRes.data as unknown as GymRulesRow;
      const types = (typesRes.data ?? []) as ClassTypeCancelRow[];
      return {
        choices: choicesFromGym(gym, types),
        defaults: {
          capacity: gym.default_class_capacity,
          minutes: gym.default_class_minutes,
        },
      };
    },
  });
}

type LocalMsg =
  | { kind: 'mine'; text: string }
  | { kind: 'temple'; text: string }
  | { kind: 'receipt'; text: string }
  | { kind: 'rule-changes'; changes: RuleChange[]; open: boolean }
  | { kind: 'add-classes'; proposal: TimetableProposal; open: boolean }
  | {
      kind: 'closure';
      starts_on: string;
      ends_on: string;
      reason: string | null;
      open: boolean;
    }
  | { kind: 'add-plans'; proposal: PlansProposal; open: boolean }
  | { kind: 'newsletter'; draft: NewsletterDraft; open: boolean }
  | {
      kind: 'action';
      spec: AnyAction;
      args: never;
      preview: ActionPreview;
      open: boolean;
    }
  | { kind: 'member-picks'; picks: { profileId: string; name: string }[] }
  | { kind: 'member-card'; member: MemberCard }
  | {
      kind: 'class-edit';
      req: ClassEditRequest;
      window: { start: string; end: string; bounded: boolean };
      sessionIds: string[];
      sample: string[];
      open: boolean;
    }
  | { kind: 'rules-sheet' };

type MemberCard = {
  profileId: string;
  name: string;
  joinedAt: string;
  status: MemberStatus;
  planName: string | null;
  priceCents: number | null;
  creditBalance: number | null;
  compCredits: number | null;
  pastDueSince: string | null;
  tags: { label: string; color: string; source: 'manual' | 'auto' }[];
};

const CANNOT_COPY =
  "That's not something I can change from here yet — the Manage screens still cover it.";
const NO_CHANGE_COPY =
  "I didn't catch that one. Try it like: 'show me Marcus', 'cap Saturdays " +
  "at 20', 'move the Tuesday 6am half an hour later', 'free cancel until 2 " +
  "hours before', 'add a 7am Wednesday spin class', 'close the gym 24 to 28 " +
  "December', 'send a newsletter — Christmas hours and the new barbell club', " +
  "or 'continue setup'.";

// "continue setup", "finish setting up", "back to setup", "setup"…
const SETUP_INTENT =
  /^(continue|finish|resume|carry on with|back to|go to|open|complete)?\s*(the\s+)?set\s?up$|^set\s?up\s+(please|again)$/i;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type CohortRow = {
  profile_id: string;
  joined_at: string;
  is_intro: boolean;
  is_active: boolean;
  is_expiring_soon: boolean;
  is_expired: boolean;
  days_until_expiry: number | null;
  profiles: { full_name: string | null } | null;
};

type SubLookupRow = {
  status: string;
  credit_balance: number | null;
  price_cents: number | null;
  membership_plans: { name: string } | null;
};

type SessionLookupRow = {
  id: string;
  name: string | null;
  starts_at: string;
  capacity: number;
  duration_minutes: number;
  class_types: { name: string } | null;
};

function sessionLine(s: SessionLookupRow): string {
  const at = new Date(s.starts_at);
  const day = at.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = at.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${day}, ${time} — ${s.class_types?.name ?? s.name ?? 'Class'} (cap ${s.capacity})`;
}

function closureFromProposal(
  raw: unknown,
): { starts_on: string; ends_on: string; reason: string | null } | null {
  const c = raw as
    | { starts_on?: unknown; ends_on?: unknown; reason?: unknown }
    | null
    | undefined;
  if (!c || typeof c.starts_on !== 'string' || typeof c.ends_on !== 'string') {
    return null;
  }
  if (!DATE_RE.test(c.starts_on) || !DATE_RE.test(c.ends_on)) return null;
  if (c.ends_on < c.starts_on) return null;
  const reason =
    typeof c.reason === 'string' && c.reason.trim()
      ? c.reason.trim().slice(0, 120)
      : null;
  return { starts_on: c.starts_on, ends_on: c.ends_on, reason };
}

function formatClosureDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

export default function Timeline() {
  const { data: membership } = useGymMembership();
  const gymId = membership?.gymId;
  const session = useSession();
  const role = useRole();
  const isOwner = role === 'owner';
  const can = useCanFn();
  const colors = useThemeColors();
  const brand = useGymBrand();
  const qc = useQueryClient();

  const feed = useTimelineFeed(gymId);
  const rules = useGymRules(gymId, isOwner);
  const setupProgress = useQuery({
    queryKey: ['gym-setup-progress', gymId],
    enabled: !!gymId && isOwner,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_gym_setup_progress', {
        p_gym_id: gymId!,
      });
      if (error) throw error;
      return (data ?? []) as { step_key: string; done: boolean }[];
    },
  });
  const setupDone = (setupProgress.data ?? []).filter(
    (r) =>
      (REQUIRED_SETUP_KEYS as readonly string[]).includes(r.step_key) && r.done,
  ).length;
  const setupOutstanding = isOwner && setupDone < REQUIRED_SETUP_KEYS.length;
  const authority = useMoneyAuthority(gymId, isOwner);
  const [jobDismissed, setJobDismissed] = useState(false);

  const hasFailingPayment = (feed.data ?? []).some(
    (e) => e.kind === 'payment_failing',
  );
  const showMoneyJobCard =
    isOwner &&
    !jobDismissed &&
    hasFailingPayment &&
    authority.data !== undefined &&
    authority.data.length === 0;

  const [local, setLocal] = useState<LocalMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (local.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [local.length]);

  const push = (...msgs: LocalMsg[]) => setLocal((l) => [...l, ...msgs]);
  const closeCard = (index: number) =>
    setLocal((l) =>
      l.map((m, i) => (i === index && 'open' in m ? { ...m, open: false } : m)),
    );

  // The reads. Every one runs in the owner's own session, so RLS decides
  // what the bar can see exactly as it decides what the members screen
  // can see — the bar gains no reach of its own.
  const lookupMember = async (query: string): Promise<LocalMsg[]> => {
    const { data, error } = await supabase
      .from('v_member_cohort')
      .select(
        'profile_id, joined_at, is_intro, is_active, is_expiring_soon, is_expired, days_until_expiry, profiles!profile_id(full_name)',
      )
      .eq('gym_id', gymId!);
    if (error) throw error;
    const named = ((data ?? []) as unknown as CohortRow[])
      .filter((r) => r.profiles?.full_name?.trim())
      .map((r) => ({ ...r, name: r.profiles!.full_name!.trim() }));
    const hits = matchMembers(named, query);
    if (hits.length === 0) {
      return [{ kind: 'temple', text: `No one called “${query}” on your books.` }];
    }
    if (hits.length > 1) {
      return [
        {
          kind: 'temple',
          text: `A few people could be “${query}” — which one did you mean?`,
        },
        {
          kind: 'member-picks',
          picks: hits.map((h) => ({ profileId: h.profile_id, name: h.name })),
        },
      ];
    }
    return [{ kind: 'member-card', member: await memberCard(hits[0]) }];
  };

  const memberCard = async (
    row: CohortRow & { name: string },
  ): Promise<MemberCard> => {
    // Each extra fact is best-effort: a staff member whose capabilities
    // don't stretch to plans or tags gets a card without them, not an
    // error where the answer should be.
    const [subs, comps, tags, dun] = await Promise.all([
      supabase
        .from('plan_subscriptions')
        .select('status, credit_balance, price_cents, membership_plans(name)')
        .eq('gym_id', gymId!)
        .eq('profile_id', row.profile_id)
        .order('created_at', { ascending: false })
        .limit(1),
      supabase
        .from('comp_grants')
        .select('credits_remaining')
        .eq('gym_id', gymId!)
        .eq('profile_id', row.profile_id),
      supabase
        .from('member_tags')
        .select('label, color, source')
        .eq('gym_id', gymId!)
        .eq('profile_id', row.profile_id),
      supabase
        .from('plan_subscription_dunning')
        .select('past_due_since')
        .eq('gym_id', gymId!)
        .eq('profile_id', row.profile_id)
        .maybeSingle(),
    ]);
    const sub = ((subs.data ?? []) as unknown as SubLookupRow[])[0] ?? null;
    const compCredits = ((comps.data ?? []) as { credits_remaining: number | null }[])
      .reduce((sum, c) => sum + (c.credits_remaining ?? 0), 0);
    return {
      profileId: row.profile_id,
      name: row.name,
      joinedAt: row.joined_at,
      status: memberStatus({
        isIntro: row.is_intro,
        isActive: row.is_active,
        isExpiringSoon: row.is_expiring_soon,
        isExpired: row.is_expired,
        daysUntilExpiry: row.days_until_expiry,
      }),
      planName: sub?.membership_plans?.name ?? null,
      priceCents: sub?.price_cents ?? null,
      creditBalance: sub?.credit_balance ?? null,
      compCredits: compCredits > 0 ? compCredits : null,
      pastDueSince:
        (dun.data as { past_due_since: string | null } | null)?.past_due_since ?? null,
      tags: (tags.data ?? []) as MemberCard['tags'],
    };
  };

  const resolveClassEdit = async (req: ClassEditRequest): Promise<LocalMsg> => {
    const today = new Date().toISOString().slice(0, 10);
    const w = classEditWindow(req, today);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const range = dateRangeWindow(w.start, w.end, tz);
    if (!range) {
      return { kind: 'temple', text: "I couldn't work out which dates you meant." };
    }
    const { data, error } = await supabase
      .from('class_sessions')
      .select('id, name, starts_at, capacity, duration_minutes, class_types(name)')
      .eq('gym_id', gymId!)
      .gte('starts_at', range.startIso)
      .lt('starts_at', range.endIso)
      .order('starts_at');
    if (error) throw error;
    const rows = (data ?? []) as unknown as SessionLookupRow[];
    const wanted = rows.filter((s) => {
      const at = new Date(s.starts_at);
      if (req.days && !req.days.includes(at.getDay())) return false;
      if (req.classType) {
        const name = (s.class_types?.name ?? s.name ?? '').toLowerCase();
        if (!name.includes(req.classType.toLowerCase())) return false;
      }
      return true;
    });
    if (wanted.length === 0) {
      return {
        kind: 'temple',
        text: 'Nothing on the calendar matches that — check the day and the class name.',
      };
    }
    return {
      kind: 'class-edit',
      req,
      window: w,
      sessionIds: wanted.map((s) => s.id),
      sample: wanted.slice(0, 3).map(sessionLine),
      open: true,
    };
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy || !gymId) return;
    setInput('');
    push({ kind: 'mine', text });
    // "continue setup" is unambiguous enough to answer without a model
    // round-trip — and the owner asking for it is usually mid-task.
    if (SETUP_INTENT.test(text)) {
      push({ kind: 'temple', text: 'Picking up where we left off…' });
      setTimeout(() => router.push('/setup' as never), 400);
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('parse-setup', {
        body: {
          gym_id: gymId,
          step: 'change',
          text,
          actions: actionsFor((c) => can(c as Capability)),
        },
      });
      if (error) throw error;
      const p = (data as { proposal?: Record<string, unknown> })?.proposal ?? {};
      const cards: LocalMsg[] = [];
      const current = rules.data?.choices;

      if (current && Array.isArray(p.rule_changes)) {
        const changes = sanitiseRuleChanges(
          { changes: p.rule_changes },
          current,
        );
        if (changes) cards.push({ kind: 'rule-changes', changes, open: true });
      }
      if (Array.isArray(p.add_classes)) {
        const proposal = sanitiseTimetable({ schedules: p.add_classes });
        if (proposal) cards.push({ kind: 'add-classes', proposal, open: true });
      }
      if (Array.isArray(p.add_plans)) {
        const proposal = sanitisePlans({ plans: p.add_plans });
        if (proposal) cards.push({ kind: 'add-plans', proposal, open: true });
      }
      const closure = closureFromProposal(p.closure);
      if (closure) cards.push({ kind: 'closure', ...closure, open: true });
      if (p.newsletter) {
        const draft = sanitiseNewsletter(p.newsletter);
        if (draft) cards.push({ kind: 'newsletter', draft, open: true });
      }
      if (p.edit_classes) {
        const req = sanitiseClassEdit(p.edit_classes);
        if (req) cards.push(await resolveClassEdit(req));
      }
      if (p.find_member) {
        const query = sanitiseMemberQuery(p.find_member);
        if (query) cards.push(...(await lookupMember(query)));
      }
      // Registry actions. One dispatch for every module that lands here,
      // rather than a branch per verb.
      const spec = findAction(p.action);
      if (spec && session?.user.id) {
        const parsed = spec.sanitise((p.args ?? {}) as Record<string, unknown>);
        if (parsed === null || parsed === undefined) {
          cards.push({
            kind: 'temple',
            text: 'I got the gist but not the details — say it again with the name and the number in it.',
          });
        } else {
          // Type-erased on the way in, checked on the way out: the spec's
          // own sanitiser is what guarantees this matches its preview.
          const args = parsed as never;
          const ctx = { supabase, gymId, userId: session.user.id };
          cards.push({
            kind: 'action',
            spec,
            args,
            preview: await spec.preview(args, ctx),
            open: spec.kind === 'do',
          });
        }
      }

      if (cards.length > 0) push(...cards);
      else if (typeof p.cannot === 'string' && p.cannot.trim()) {
        push({ kind: 'temple', text: CANNOT_COPY });
      } else {
        push({ kind: 'temple', text: NO_CHANGE_COPY });
      }
    } catch {
      push({
        kind: 'temple',
        text: "I couldn't work on that just now — try again in a moment.",
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmRules = async (index: number, changes: RuleChange[]) => {
    if (!gymId || !rules.data || busy) return;
    setBusy(true);
    try {
      const next = { ...rules.data.choices } as RuleChoices;
      for (const c of changes) {
        (next as Record<string, unknown>)[c.field] = c.value;
      }
      await applyRules(supabase, gymId, rules.data.defaults, next, {
        touchCancelPolicy: changes.some((c) => c.field === 'late_cancel'),
      });
      closeCard(index);
      const lines = changes.map((c) => {
        const sheetLine = ruleSheet(next)
          .flatMap((g) => g.lines)
          .find((l) => l.parts.some((pt) => 'f' in pt && pt.f === c.field));
        return sheetLine ? sheetLineText(sheetLine, next) : fieldLabel(c.field, next);
      });
      push({ kind: 'receipt', text: `Done. ${lines.join('. ')}.` });
      qc.invalidateQueries({ queryKey: ['gym-rules', gymId] });
    } catch {
      push({ kind: 'temple', text: "That didn't save — try again." });
    } finally {
      setBusy(false);
    }
  };

  const applySingleRule = async (
    field: RuleField,
    value: RuleChoices[RuleField],
  ) => {
    if (!gymId || !rules.data || busy) return;
    await confirmRules(-1, [{ field, value }]);
  };

  const confirmClasses = async (index: number, proposal: TimetableProposal) => {
    if (!gymId || busy) return;
    setBusy(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await applyTimetable(supabase, gymId, tz, proposal);
      closeCard(index);
      const lines = proposal.schedules.map(
        (s) => `${s.class_type} — ${formatDays(s.days)} at ${s.times.join(', ')}`,
      );
      push({ kind: 'receipt', text: `On the timetable. ${lines.join('. ')}.` });
      qc.invalidateQueries({ queryKey: ['timeline-feed', gymId] });
    } catch {
      push({ kind: 'temple', text: "That didn't save — try again." });
    } finally {
      setBusy(false);
    }
  };

  const confirmPlans = async (index: number, proposal: PlansProposal) => {
    if (!gymId || busy) return;
    setBusy(true);
    try {
      await applyPlans(supabase, gymId, proposal);
      closeCard(index);
      const names = proposal.plans
        .map((p) => `${p.name} at ${formatPrice(p.monthly_price_cents)}`)
        .join(', ');
      push({ kind: 'receipt', text: `Created. ${names}.` });
    } catch (e) {
      const msg = e instanceof Error && /already exists|duplicate/i.test(e.message)
        ? 'One of those plans already exists — nothing was created.'
        : "That didn't save — try again.";
      push({ kind: 'temple', text: msg });
    } finally {
      setBusy(false);
    }
  };

  const confirmClosure = async (
    index: number,
    c: { starts_on: string; ends_on: string; reason: string | null },
  ) => {
    if (!gymId || busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('close_gym_dates', {
        p_gym_id: gymId,
        p_start: c.starts_on,
        p_end: c.ends_on,
        p_reason: c.reason,
        p_exclude_session_ids: null,
      });
      if (error) throw error;
      closeCard(index);
      const result = data as { cancelled: number; notified: number } | null;
      const range =
        c.starts_on === c.ends_on
          ? `on ${formatClosureDay(c.starts_on)}`
          : `${formatClosureDay(c.starts_on)} to ${formatClosureDay(c.ends_on)}`;
      const cancelled = result?.cancelled ?? 0;
      push({
        kind: 'receipt',
        text:
          cancelled > 0
            ? `The gym is closed ${range}. ${cancelled} ${cancelled === 1 ? 'class' : 'classes'} cancelled — everyone booked has been refunded and told.`
            : `The gym is closed ${range}. Nothing was scheduled in those dates yet.`,
      });
      qc.invalidateQueries({ queryKey: ['timeline-feed', gymId] });
    } catch {
      push({ kind: 'temple', text: "That didn't save — try again." });
    } finally {
      setBusy(false);
    }
  };

  const confirmNewsletter = async (index: number, draft: NewsletterDraft) => {
    if (!gymId || !session?.user.id || busy) return;
    setBusy(true);
    try {
      const doc = newsletterDocument(
        {
          primaryColor: brand.primaryColor,
          secondaryColor: brand.secondaryColor,
          textColor: brand.textColor,
        },
        { gymName: brand.gymName, logoUrl: brand.logoUrl },
        draft,
      );
      const { data, error } = await supabase
        .from('email_campaigns')
        .insert({
          gym_id: gymId,
          created_by: session.user.id,
          title: draft.subject,
          subject: draft.subject,
          design: doc as unknown as Json,
          audience: DEFAULT_AUDIENCE as unknown as Json,
        })
        .select('id')
        .single();
      if (error || !data) throw error ?? new Error('Could not draft');
      closeCard(index);
      push({
        kind: 'receipt',
        text: `Drafted — “${draft.subject}”. Have a read, pick who it goes to, and send it from there.`,
      });
      qc.invalidateQueries({ queryKey: ['comms-campaigns'] });
      router.push(`/management/communications/${(data as { id: string }).id}` as never);
    } catch {
      push({ kind: 'temple', text: "That didn't save — try again." });
    } finally {
      setBusy(false);
    }
  };

  const confirmClassEdit = async (
    index: number,
    msg: Extract<LocalMsg, { kind: 'class-edit' }>,
  ) => {
    if (!gymId || busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('bulk_edit_sessions', {
        p_gym_id: gymId,
        p_start: msg.window.start,
        p_end: msg.window.end,
        p_session_ids: msg.sessionIds,
        p_capacity: msg.req.capacity,
        p_duration_minutes: msg.req.durationMinutes,
        p_shift_minutes: msg.req.shiftMinutes,
      });
      if (error) throw error;
      closeCard(index);
      push({
        kind: 'receipt',
        text: describeBulkEditResult(data as unknown as BulkEditResult),
      });
      qc.invalidateQueries({ queryKey: ['timeline-feed', gymId] });
    } catch {
      push({ kind: 'temple', text: "That didn't save — try again." });
    } finally {
      setBusy(false);
    }
  };

  const confirmAction = async (
    index: number,
    msg: Extract<LocalMsg, { kind: 'action' }>,
  ) => {
    if (!gymId || !session?.user.id || busy || !msg.spec.apply) return;
    setBusy(true);
    try {
      const receipt = await msg.spec.apply(msg.args, {
        supabase,
        gymId,
        userId: session.user.id,
      });
      closeCard(index);
      push({ kind: 'receipt', text: receipt });
      qc.invalidateQueries({ queryKey: ['timeline-feed', gymId] });
      qc.invalidateQueries({ queryKey: ['store-products', gymId] });
    } catch {
      push({ kind: 'temple', text: "That didn't save — try again." });
    } finally {
      setBusy(false);
    }
  };

  const openMemberPick = async (profileId: string, name: string) => {
    if (!gymId || busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from('v_member_cohort')
        .select(
          'profile_id, joined_at, is_intro, is_active, is_expiring_soon, is_expired, days_until_expiry, profiles!profile_id(full_name)',
        )
        .eq('gym_id', gymId)
        .eq('profile_id', profileId)
        .single();
      if (error) throw error;
      const row = data as unknown as CohortRow;
      push({ kind: 'mine', text: name });
      push({ kind: 'member-card', member: await memberCard({ ...row, name }) });
    } catch {
      push({ kind: 'temple', text: "I couldn't pull that up — try again." });
    } finally {
      setBusy(false);
    }
  };

  const showRulesSheet = () => {
    setLocal((l) =>
      l.some((m) => m.kind === 'rules-sheet')
        ? l
        : [...l, { kind: 'rules-sheet' }],
    );
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  };

  const groups = groupTimelineByDay(feed.data ?? []);

  return (
    <Screen edges={['bottom', 'left', 'right']} className="px-0">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerClassName="gap-6 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full"
          refreshControl={
            <RefreshControl
              refreshing={feed.isRefetching}
              onRefresh={() => feed.refetch()}
            />
          }>
          {feed.isLoading ? (
            <View className="py-16 items-center">
              <ActivityIndicator />
            </View>
          ) : groups.length === 0 && local.length === 0 ? (
            <View className="py-16 px-6 items-center gap-2">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold text-base">
                Nothing here yet
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-sm text-center">
                As things happen — someone joins, asks about their membership,
                needs looking after — it shows up here.
              </Text>
            </View>
          ) : (
            groups.map((g) => (
              <View key={g.key} className="gap-3">
                <Text className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-center">
                  {g.label}
                </Text>
                {g.events.map((e) =>
                  e.kind === 'membership_request' ? (
                    <RequestCard key={e.item_id} event={e} gymId={gymId} />
                  ) : e.kind === 'agent_action' &&
                    (e.detail as { status?: string }).status === 'proposed' ? (
                    <AgentActionCard key={e.item_id} event={e} gymId={gymId} />
                  ) : (
                    <ReceiptLine key={e.item_id} event={e} />
                  ),
                )}
              </View>
            ))
          )}

          {setupOutstanding ? (
            <SetupCard
              done={setupDone}
              total={REQUIRED_SETUP_KEYS.length}
            />
          ) : null}

          {showMoneyJobCard ? (
            <MoneyJobCard
              gymId={gymId}
              onDismiss={() => setJobDismissed(true)}
              onTakenOn={() => {
                setJobDismissed(true);
                push({
                  kind: 'receipt',
                  text: "The money job is on — I'll ask before anything goes out.",
                });
                qc.invalidateQueries({ queryKey: ['agent-authority', gymId] });
              }}
            />
          ) : null}

          {local.map((m, i) => (
            <LocalRow
              key={i}
              msg={m}
              index={i}
              busy={busy}
              choices={rules.data?.choices}
              onConfirmRules={confirmRules}
              onConfirmClasses={confirmClasses}
              onConfirmPlans={confirmPlans}
              onConfirmClosure={confirmClosure}
              onConfirmNewsletter={confirmNewsletter}
              onConfirmClassEdit={confirmClassEdit}
              onConfirmAction={confirmAction}
              onPickMember={openMemberPick}
              onDismiss={closeCard}
              onEditRule={applySingleRule}
            />
          ))}

          {busy ? (
            <View className="flex-row items-center gap-2 px-1">
              <ActivityIndicator size="small" color={colors.primary} />
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Working on it…
              </Text>
            </View>
          ) : null}
        </ScrollView>

        {isOwner ? (
          <View className="px-4 pb-4 pt-1 gap-2 md:max-w-2xl md:mx-auto md:w-full">
            <View className="flex-row gap-2">
              <BarChip
                icon="document-text-outline"
                label="Your rules"
                onPress={showRulesSheet}
              />
              <BarChip
                icon="people-outline"
                label="The team"
                onPress={() => router.push('/management/roster' as never)}
              />
              <BarChip
                icon="flag-outline"
                label="Goals"
                onPress={() => router.push('/management/goals' as never)}
              />
            </View>
            <View className="flex-row items-center gap-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-full pl-4 pr-1.5 py-1.5 shadow-card">
              <TextInput
                value={input}
                onChangeText={setInput}
                editable={!busy}
                placeholder="Show me a member, change a class, send a newsletter…"
                placeholderTextColor="#9CA3AF"
                multiline
                className="flex-1 text-gray-900 dark:text-gray-50 text-[15px] max-h-24 py-1.5"
                onSubmitEditing={send}
              />
              <Pressable
                onPress={send}
                disabled={busy || !input.trim()}
                accessibilityLabel="Send"
                className={`w-9 h-9 rounded-full items-center justify-center ${busy || !input.trim() ? 'bg-gray-200 dark:bg-gray-800' : 'bg-primary'}`}>
                <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

function BarChip({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 active:opacity-70">
      <Ionicons name={icon} size={14} color={colors.iconSecondary} />
      <Text className="text-gray-700 dark:text-gray-300 text-[13px] font-semibold">
        {label}
      </Text>
    </Pressable>
  );
}

function LocalRow({
  msg,
  index,
  busy,
  choices,
  onConfirmRules,
  onConfirmClasses,
  onConfirmPlans,
  onConfirmClosure,
  onConfirmNewsletter,
  onConfirmClassEdit,
  onConfirmAction,
  onPickMember,
  onDismiss,
  onEditRule,
}: {
  msg: LocalMsg;
  index: number;
  busy: boolean;
  choices: RuleChoices | undefined;
  onConfirmRules: (index: number, changes: RuleChange[]) => void;
  onConfirmClasses: (index: number, proposal: TimetableProposal) => void;
  onConfirmPlans: (index: number, proposal: PlansProposal) => void;
  onConfirmClosure: (
    index: number,
    c: { starts_on: string; ends_on: string; reason: string | null },
  ) => void;
  onConfirmNewsletter: (index: number, draft: NewsletterDraft) => void;
  onConfirmClassEdit: (
    index: number,
    msg: Extract<LocalMsg, { kind: 'class-edit' }>,
  ) => void;
  onConfirmAction: (
    index: number,
    msg: Extract<LocalMsg, { kind: 'action' }>,
  ) => void;
  onPickMember: (profileId: string, name: string) => void;
  onDismiss: (index: number) => void;
  onEditRule: (field: RuleField, value: RuleChoices[RuleField]) => void;
}) {
  if (msg.kind === 'mine') {
    return (
      <View className="self-end max-w-[85%] bg-primary rounded-2xl rounded-br-md px-4 py-2.5">
        <Text className="text-white text-[15px] leading-[21px]">{msg.text}</Text>
      </View>
    );
  }
  if (msg.kind === 'temple') {
    return (
      <Text className="text-gray-700 dark:text-gray-200 text-[15px] leading-[22px] px-1">
        {msg.text}
      </Text>
    );
  }
  if (msg.kind === 'receipt') {
    return <SoftLine text={msg.text} tone="neutral" />;
  }
  if (msg.kind === 'rules-sheet') {
    if (!choices) return null;
    return (
      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card">
        <RuleSheet choices={choices} editable={!busy} onEdit={onEditRule} />
      </View>
    );
  }

  if (msg.kind === 'rule-changes') {
    if (!msg.open || !choices) return null;
    return (
      <ProposalCard
        title={msg.changes.length === 1 ? 'Change this rule?' : 'Change these rules?'}
        lines={msg.changes.map((c) => ruleChangeLine(c, choices))}
        yes="Yes, change it"
        busy={busy}
        onYes={() => onConfirmRules(index, msg.changes)}
        onNo={() => onDismiss(index)}
      />
    );
  }
  if (msg.kind === 'add-classes') {
    if (!msg.open) return null;
    return (
      <ProposalCard
        title="Add this to the timetable?"
        lines={msg.proposal.schedules.map(
          (s) =>
            `${s.class_type} — ${formatDays(s.days)} at ${s.times.join(', ')}, ` +
            `${s.duration_minutes} min, cap ${s.capacity}`,
        )}
        yes="Yes, add it"
        busy={busy}
        onYes={() => onConfirmClasses(index, msg.proposal)}
        onNo={() => onDismiss(index)}
      />
    );
  }
  if (msg.kind === 'add-plans') {
    if (!msg.open) return null;
    return (
      <ProposalCard
        title="Create these memberships?"
        lines={msg.proposal.plans.map((p) => {
          const price = formatPrice(p.monthly_price_cents);
          const credits =
            p.credit_count !== null ? `, ${p.credit_count} classes` : '';
          const notice =
            p.notice_period_days !== null && p.notice_period_days > 0
              ? `, ${p.notice_period_days} days notice`
              : '';
          return `${p.name} — ${price}${credits}${notice}`;
        })}
        yes="Yes, create them"
        busy={busy}
        onYes={() => onConfirmPlans(index, msg.proposal)}
        onNo={() => onDismiss(index)}
      />
    );
  }
  if (msg.kind === 'newsletter') {
    if (!msg.open) return null;
    return (
      <ProposalCard
        title={`Draft this newsletter? — “${msg.draft.subject}”`}
        lines={msg.draft.sections.map(
          (s) =>
            `${s.heading} — ${s.body.length > 90 ? `${s.body.slice(0, 90)}…` : s.body}`,
        )}
        yes="Yes, draft it"
        busy={busy}
        onYes={() => onConfirmNewsletter(index, msg.draft)}
        onNo={() => onDismiss(index)}
      />
    );
  }
  if (msg.kind === 'class-edit') {
    if (!msg.open) return null;
    const count = msg.sessionIds.length;
    return (
      <ProposalCard
        title={`Change ${describeEditTarget(msg.req, count)}?`}
        lines={[
          describeBulkEdit(
            {
              capacity: msg.req.capacity,
              durationMinutes: msg.req.durationMinutes,
              shiftMinutes: msg.req.shiftMinutes,
            },
            count,
          ),
          ...msg.sample,
          ...(count > msg.sample.length
            ? [`…and ${count - msg.sample.length} more`]
            : []),
          msg.window.bounded
            ? `Everything in the next ${DEFAULT_EDIT_WEEKS} weeks. Say the dates if you want a different stretch.`
            : `${msg.window.start} to ${msg.window.end}.`,
        ]}
        yes="Yes, change them"
        busy={busy}
        onYes={() => onConfirmClassEdit(index, msg)}
        onNo={() => onDismiss(index)}
      />
    );
  }
  // One card for every registry action. A `do` keeps the two choices; an
  // `ask` is already the answer, so it renders as one.
  if (msg.kind === 'action') {
    if (msg.spec.kind === 'ask') {
      return (
        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card gap-1.5">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold text-[15px]">
            {msg.preview.title}
          </Text>
          {msg.preview.lines.map((l) => (
            <Text
              key={l}
              className="text-gray-500 dark:text-gray-400 text-[13.5px] leading-[19px]">
              {l}
            </Text>
          ))}
        </View>
      );
    }
    if (!msg.open) return null;
    // A preview with nothing to show is the action saying it couldn't
    // find what was named — the title carries that, and there is nothing
    // to confirm.
    if (msg.preview.lines.length === 0) {
      return (
        <Text className="text-gray-700 dark:text-gray-200 text-[15px] leading-[22px] px-1">
          {msg.preview.title}
        </Text>
      );
    }
    return (
      <ProposalCard
        title={msg.preview.title}
        lines={msg.preview.lines}
        yes="Yes, do it"
        busy={busy}
        onYes={() => onConfirmAction(index, msg)}
        onNo={() => onDismiss(index)}
      />
    );
  }
  if (msg.kind === 'member-picks') {
    return (
      <View className="flex-row flex-wrap gap-2 px-1">
        {msg.picks.map((p) => (
          <Pressable
            key={p.profileId}
            onPress={() => onPickMember(p.profileId, p.name)}
            disabled={busy}
            className="px-4 py-2.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 active:opacity-70">
            <Text className="text-gray-700 dark:text-gray-300 text-sm font-semibold">
              {p.name}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  }
  if (msg.kind === 'member-card') {
    return <MemberSummaryCard member={msg.member} />;
  }
  // closure
  if (!msg.open) return null;
  const range =
    msg.starts_on === msg.ends_on
      ? formatClosureDay(msg.starts_on)
      : `${formatClosureDay(msg.starts_on)} to ${formatClosureDay(msg.ends_on)}`;
  return (
    <ProposalCard
      title={`Close the gym ${range}?`}
      lines={[
        'Every class in those dates is cancelled, everyone booked is refunded and told, and nothing new can be scheduled into them.',
      ]}
      yes="Yes, close it"
      busy={busy}
      onYes={() =>
        onConfirmClosure(index, {
          starts_on: msg.starts_on,
          ends_on: msg.ends_on,
          reason: msg.reason,
        })
      }
      onNo={() => onDismiss(index)}
    />
  );
}

const STATUS_TONE: Record<
  MemberStatus['tone'],
  { bg: string; text: string }
> = {
  good: { bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300' },
  warn: { bg: 'bg-amber-50 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300' },
  bad: { bg: 'bg-red-50 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300' },
  neutral: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-300' },
};

// The member, in the chat. A summary and not the profile: who they are,
// where they stand, what they're on, what's gone wrong if anything. The
// profile screen stays the deep dive — this is the answer to "show me
// Marcus", with the way through to the work attached.
function MemberSummaryCard({ member }: { member: MemberCard }) {
  const tone = STATUS_TONE[member.status.tone];
  const facts: { label: string; value: string }[] = [
    {
      label: 'On',
      value: member.planName
        ? member.priceCents !== null
          ? `${member.planName} · ${formatPrice(member.priceCents)}`
          : member.planName
        : 'No membership',
    },
  ];
  if (member.creditBalance !== null) {
    facts.push({
      label: 'Credits',
      value: `${member.creditBalance} left this period`,
    });
  }
  if (member.compCredits !== null) {
    facts.push({ label: 'Comped', value: `${member.compCredits} classes` });
  }
  if (member.pastDueSince) {
    facts.push({
      label: 'Payment',
      value: `Failed — past due since ${formatDate(member.pastDueSince)}`,
    });
  }
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card gap-3">
      <View className="flex-row items-center gap-3">
        <Avatar name={member.name} size={40} />
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold text-[15px]">
            {member.name}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Member since {formatDate(member.joinedAt)}
          </Text>
        </View>
        <View className={`px-2.5 py-1 rounded-full ${tone.bg}`}>
          <Text className={`text-[10.5px] font-bold uppercase tracking-wide ${tone.text}`}>
            {member.status.label}
          </Text>
        </View>
      </View>

      <View className="gap-1">
        {facts.map((f) => (
          <View key={f.label} className="flex-row items-baseline gap-2">
            <Text className="text-gray-400 dark:text-gray-500 text-xs w-16">
              {f.label}
            </Text>
            <Text className="flex-1 text-gray-700 dark:text-gray-200 text-[13.5px]">
              {f.value}
            </Text>
          </View>
        ))}
      </View>

      {member.tags.length > 0 ? (
        <View className="flex-row flex-wrap gap-1.5">
          {member.tags.map((t) => (
            <MemberTagChip
              key={t.label}
              label={t.label}
              color={t.color}
              source={t.source}
            />
          ))}
        </View>
      ) : null}

      <Button
        variant="secondary"
        onPress={() =>
          router.push(`/management/members/${member.profileId}` as never)
        }>
        Open their profile
      </Button>
    </View>
  );
}

function ProposalCard({
  title,
  lines,
  yes,
  busy,
  onYes,
  onNo,
}: {
  title: string;
  lines: string[];
  yes: string;
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
      <Text className="text-gray-900 dark:text-gray-50 text-[15px] font-semibold leading-[22px]">
        {title}
      </Text>
      <View className="gap-1.5">
        {lines.map((l, i) => (
          <Text key={i} className="text-gray-600 dark:text-gray-300 text-sm leading-5">
            {l}
          </Text>
        ))}
      </View>
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <Button onPress={onYes} loading={busy}>
            {yes}
          </Button>
        </View>
        <View className="flex-1">
          <Button variant="secondary" onPress={onNo} disabled={busy}>
            No
          </Button>
        </View>
      </View>
    </View>
  );
}

function ReceiptLine({ event }: { event: TimelineEvent }) {
  const line = formatTimelineLine(event);
  return <SoftLine text={line.text} tone={line.tone} at={event.occurred_at} />;
}

function SoftLine({
  text,
  tone,
  at,
}: {
  text: string;
  tone: 'neutral' | 'amber';
  at?: string;
}) {
  return (
    <View className="flex-row items-start gap-3 px-1">
      <View
        className={`w-2 h-2 rounded-full mt-[7px] ${
          tone === 'amber' ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      />
      <Text className="flex-1 text-gray-700 dark:text-gray-200 text-[15px] leading-[22px]">
        {text}
      </Text>
      {at ? (
        <Text className="text-gray-400 dark:text-gray-500 text-xs mt-[3px]">
          {formatClock(at)}
        </Text>
      ) : null}
    </View>
  );
}

// A proposed action from the money loop: one question, one sentence of
// reasoning, the deterministic evidence behind "See the details", and
// exactly two choices. "Always allow this" rides the approval so the
// graduation is itself a ledgered decision (0206).
function AgentActionCard({
  event,
  gymId,
}: {
  event: TimelineEvent;
  gymId: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [always, setAlways] = useState(false);
  const [decided, setDecided] = useState<'approve' | 'reject' | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const qc = useQueryClient();

  const payload = ((event.detail.payload ?? {}) as Record<string, unknown>);
  const kind = typeof event.detail.action_kind === 'string' ? event.detail.action_kind : '';
  const isOffer = kind === 'plan_adjustment_offer';
  const evidence = Array.isArray(event.detail.evidence)
    ? (event.detail.evidence as unknown[]).filter(
        (x): x is string => typeof x === 'string',
      )
    : [];
  const memberName =
    typeof payload.member_name === 'string' && payload.member_name
      ? payload.member_name
      : event.subject;
  const first = memberName.trim().split(/\s+/)[0] || 'them';
  const offerPlan =
    typeof payload.offer_plan_name === 'string' ? payload.offer_plan_name : null;
  const offerPrice =
    typeof payload.offer_price === 'string' ? payload.offer_price : null;
  const actionId = event.item_id.split(':')[1];

  const line = formatTimelineLine(event);
  const reasoning =
    kind === 'retention_message'
      ? 'One warm note from the gym usually brings a regular back.'
      : kind === 'cover_ask'
        ? 'Every coach who could claim gets the same nudge; the claim stays first-come.'
        : isOffer
          ? `Stripe has stopped trying${offerPlan ? ` — ${offerPlan}${offerPrice ? ` at ${offerPrice}` : ''} might keep them` : ''}.`
          : 'A friendly note with their pay link usually sorts it.';
  const yesLabel =
    kind === 'retention_message'
      ? 'Yes, reach out'
      : kind === 'cover_ask'
        ? 'Yes, ask them'
        : isOffer
          ? 'Yes, offer it'
          : 'Yes, send it';

  const decide = async (decision: 'approve' | 'reject') => {
    if (!actionId || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { error } = await supabase.rpc('decide_agent_action', {
        p_action_id: actionId,
        p_decision: decision,
        p_always_allow: decision === 'approve' && always,
      });
      if (error) throw error;
      setDecided(decision);
      qc.invalidateQueries({ queryKey: ['timeline-feed', gymId] });
      qc.invalidateQueries({ queryKey: ['agent-authority', gymId] });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (decided) {
    return (
      <SoftLine
        tone="neutral"
        text={
          decided === 'approve'
            ? kind === 'cover_ask'
              ? 'Asked — the coaches have a fresh nudge.'
              : isOffer
                ? `Offered — ${first} has it in their inbox.`
                : `Sent — ${first} has the note.`
            : kind === 'cover_ask'
              ? 'Left alone — no one was nudged.'
              : `Left alone — nothing was sent to ${first}.`
        }
      />
    );
  }

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
      <Text className="text-gray-900 dark:text-gray-50 text-[15px] font-semibold leading-[22px]">
        {line.text}
      </Text>
      <Text className="text-gray-500 dark:text-gray-400 text-sm">{reasoning}</Text>
      {open ? (
        <View className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 gap-1.5">
          {evidence.map((s, i) => (
            <Text key={i} className="text-gray-700 dark:text-gray-200 text-sm">
              {s}
            </Text>
          ))}
          <Pressable
            onPress={() => setAlways((v) => !v)}
            className="flex-row items-center gap-2 pt-1.5"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: always }}>
            <Ionicons
              name={always ? 'checkbox' : 'square-outline'}
              size={18}
              color={always ? '#2563EB' : '#9CA3AF'}
            />
            <Text className="text-gray-700 dark:text-gray-200 text-sm">
              Always allow this — stop asking first
            </Text>
          </Pressable>
        </View>
      ) : null}
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <Button onPress={() => decide('approve')} loading={busy}>
            {yesLabel}
          </Button>
        </View>
        <View className="flex-1">
          <Button variant="secondary" onPress={() => decide('reject')} disabled={busy}>
            No
          </Button>
        </View>
      </View>
      {!open ? (
        <Pressable onPress={() => setOpen(true)} hitSlop={6}>
          <Text className="text-link text-sm font-semibold">See the details</Text>
        </Pressable>
      ) : null}
      {failed ? (
        <Text className="text-red-600 dark:text-red-400 text-sm">
          That didn&apos;t go through — try again.
        </Text>
      ) : null}
    </View>
  );
}

// The stream's only standing card. One question, one sentence of context
// behind "See the details", exactly two choices with the yes labelled by
// the action — the loop-1 register, applied to the queue that already
// exists.
function RequestCard({
  event,
  gymId,
}: {
  event: TimelineEvent;
  gymId: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [decided, setDecided] = useState<'approve' | 'reject' | null>(null);
  const decide = useDecideChangeRequest(gymId);
  const line = formatTimelineLine(event);

  const requestId =
    typeof event.detail.request_id === 'string' ? event.detail.request_id : null;
  const kind = event.detail.request_kind;
  const currentPlan =
    typeof event.detail.current_plan === 'string' ? event.detail.current_plan : null;
  const targetPlan =
    typeof event.detail.target_plan === 'string' ? event.detail.target_plan : null;
  const note =
    typeof event.detail.member_note === 'string' ? event.detail.member_note : null;
  const firstName = event.subject.trim().split(/\s+/)[0] || 'them';

  const yesLabel = kind === 'cancel' ? 'Yes, cancel it' : `Yes, move ${firstName}`;

  const onDecide = (decision: 'approve' | 'reject') => {
    if (!requestId || decide.isPending) return;
    decide.mutate(
      { requestId, decision },
      { onSuccess: () => setDecided(decision) },
    );
  };

  if (decided) {
    return (
      <SoftLine
        tone="neutral"
        text={
          decided === 'approve'
            ? `${firstName}'s membership — sorted, as they asked.`
            : `${firstName}'s request — declined; nothing has changed.`
        }
      />
    );
  }

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
      <Text className="text-gray-900 dark:text-gray-50 text-[15px] font-semibold leading-[22px]">
        {line.text}
      </Text>
      {currentPlan ? (
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          {kind === 'cancel'
            ? `They're on ${currentPlan} at the moment.`
            : `From ${currentPlan}${targetPlan ? ` to ${targetPlan}` : ''}.`}
        </Text>
      ) : null}
      {open && note ? (
        <View className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <Text className="text-gray-700 dark:text-gray-200 text-sm italic">
            &ldquo;{note}&rdquo;
          </Text>
        </View>
      ) : null}
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <Button onPress={() => onDecide('approve')} loading={decide.isPending}>
            {yesLabel}
          </Button>
        </View>
        <View className="flex-1">
          <Button
            variant="secondary"
            onPress={() => onDecide('reject')}
            disabled={decide.isPending}>
            No
          </Button>
        </View>
      </View>
      {note && !open ? (
        <Pressable onPress={() => setOpen(true)} hitSlop={6}>
          <Text className="text-link text-sm font-semibold">See the details</Text>
        </Pressable>
      ) : null}
      {decide.isError ? (
        <Text className="text-red-600 dark:text-red-400 text-sm">
          That didn&apos;t go through — try again.
        </Text>
      ) : null}
    </View>
  );
}

// Setup is never lost: while any required step is outstanding, the
// Timeline carries the checklist's own progress header with a way back
// in. (Typing "continue setup" in the bar does the same thing.)
function SetupCard({ done, total }: { done: number; total: number }) {
  const colors = useThemeColors();
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
      <View className="flex-row items-center gap-2.5">
        <View className="w-8 h-8 rounded-xl bg-primary/15 items-center justify-center">
          <Ionicons name="rocket-outline" size={17} color={colors.primary} />
        </View>
        <View className="flex-1">
          <Text className="text-primary text-[10px] font-semibold uppercase tracking-widest">
            Setting up
          </Text>
          <Text className="text-gray-900 dark:text-gray-50 font-semibold text-[15px]">
            {done} of {total} done
          </Text>
        </View>
      </View>
      <View className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <View
          style={{ width: `${(done / total) * 100}%` }}
          className="h-full bg-primary rounded-full"
        />
      </View>
      <Text className="text-gray-600 dark:text-gray-300 text-sm leading-5">
        A few things left before members can join and book. It picks up right
        where you left off.
      </Text>
      <Button onPress={() => router.push('/setup' as never)}>
        Carry on setting up
      </Button>
    </View>
  );
}
