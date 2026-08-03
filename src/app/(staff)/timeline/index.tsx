import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AnswerFigures } from '@/components/AnswerFigures';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { HtmlPreview } from '@/components/email/HtmlPreview';
import { MemberTagChip } from '@/components/MemberTagChip';
import { MoneyJobCard } from '@/components/MoneyJobCard';
import { RuleSheet } from '@/components/RuleSheet';
import { Screen } from '@/components/Screen';
import { OfferChip, ReceiptLine, SoftLine } from '@/components/TimelineLines';
import { REQUIRED_SETUP_KEYS } from '../setup';
import { useGymMembership, useRole, useSession } from '@/lib/auth';
import {
  ActionError,
  actionsFor,
  findAction,
  type ActionPreview,
  type AnyAction,
  type EmailDraftCard,
  type MemberCard,
} from '@/lib/actions';
import { shortlist } from '@/lib/actions/shortlist';
import type { Capability } from '@/lib/can';
import { chainStopLine, leftoverLine, travelTogether } from '@/lib/chain';
import { recentTurns, toWireTurns, type Turn } from '@/lib/chat-memory';
import { formatDate } from '@/lib/format-date';
import { useDecideChangeRequest } from '@/lib/membership-changes';
import {
  choicesFromGym,
  GYM_RULES_SELECT,
  type ClassTypeCancelRow,
  type GymRulesRow,
} from '@/lib/rules-read';
import type { MemberStatus } from '@/lib/chat-lookup';
import type { ProgrammingChangeCard } from '@/lib/programming-copy';
import {
  formatPrice,
  type RuleChoices,
  type RuleField,
} from '@/lib/setup-flow';
import { fetchStripeHealth, stripeHealthQueryKey } from '@/lib/stripe-health';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import { useCanFn } from '@/lib/useCan';
import { useGymCurrency } from '@/lib/useGymCurrency';
import {
  dedupeClosures,
  formatTimelineLine,
  groupTimelineByDay,
  splitTimeline,
  stripeWarning,
  type TimelineEvent,
} from '@/lib/timeline';

// The Timeline (docs/roadmap.md phases 1, 3 and 4): the staff home. The
// stream is the gym's existing activity, read-only; the talk bar is the
// owner's pen.
//
// One dispatch, and only one. A sentence goes to the parser, comes back
// naming an action from the registry (src/lib/actions), and from there
// every action is handled identically: sanitise the arguments, ask the
// spec to preview itself, show that, and on Yes let the spec apply itself
// and hand back the receipt. This screen knows nothing about rules,
// classes, plans, closures, newsletters, members or the shop — adding a
// module adds no code here. Reads and writes run in the owner's own
// session under RLS, so the bar reaches exactly as far as the screens do.
// Anything the registry doesn't cover gets a plain "not from here yet",
// never a guess.

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

// Two calls because they answer different questions: the row says whether
// this gym ever connected Stripe, and only if it did is it worth asking
// Stripe whether the connection still works. A gym that never connected
// must not pay for a round trip to be told what the row already said.
function useStripeWarning(gymId: string | undefined, enabled: boolean) {
  const account = useQuery({
    queryKey: ['gym-stripe-account', gymId],
    enabled: !!gymId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_stripe_accounts')
        .select('stripe_account_id')
        .eq('gym_id', gymId!)
        .maybeSingle();
      if (error) throw error;
      return data as { stripe_account_id: string | null } | null;
    },
  });
  const health = useQuery({
    queryKey: stripeHealthQueryKey(gymId),
    enabled: !!gymId && enabled && !!account.data?.stripe_account_id,
    staleTime: 60_000,
    queryFn: () => fetchStripeHealth(gymId!),
  });
  // health.isError leaves data undefined, which stripeWarning reads as
  // "could not ask" and says nothing about — the same call Billing makes
  // when its own check fails.
  return stripeWarning(health.data);
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
  | { kind: 'receipt'; text: string; offer?: { label: string; href: string } }
  | {
      kind: 'action';
      spec: AnyAction;
      args: never;
      preview: ActionPreview;
      // An `ask` action's answer can name a screen that shows more —
      // attendance behind "how busy have we been", the campaign report
      // behind "how did the Christmas email do". Same chip a receipt gets,
      // collected from the preview rather than from apply.
      offer?: { label: string; href: string };
      open: boolean;
    }
  // Two or three things said in one breath. One confirm covers the lot,
  // and they run in the order they were said — see runChain.
  | {
      kind: 'chain';
      steps: { spec: AnyAction; args: never; preview: ActionPreview }[];
      open: boolean;
    }
  | { kind: 'rules-sheet' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The member a turn was about, when the action resolved one. Recorded so
// that erasing a member can find the sentences naming them without
// reading the text of every turn ever stored.
function subjectOf(args: unknown): string | null {
  const id = (args as { profileId?: unknown } | null)?.profileId;
  return typeof id === 'string' && UUID.test(id) ? id : null;
}

const CANNOT_COPY =
  "That's not something I can change from here yet — the Manage screens still cover it.";
const NO_CHANGE_COPY =
  "I didn't catch that one. Try it like: 'show me Marcus', 'cap Saturdays " +
  "at 20', 'move the Tuesday 6am half an hour later', 'free cancel until 2 " +
  "hours before', 'add a 7am Wednesday spin class', 'close the gym 24 to 28 " +
  "December', 'send a newsletter — Christmas hours and the new barbell club', " +
  "or 'continue setup'.";
const MISSING_DETAIL =
  'I got the gist but not the details — say it again with the name and the number in it.';
const FAILED_COPY = "That didn't save — try again.";

// An action can say why it failed in words the owner should read; anything
// else that got this far is plumbing.
function failureText(e: unknown): string {
  return e instanceof ActionError ? e.message : FAILED_COPY;
}

// "continue setup", "finish setting up", "back to setup", "setup"…
const SETUP_INTENT =
  /^(continue|finish|resume|carry on with|back to|go to|open|complete)?\s*(the\s+)?set\s?up$|^set\s?up\s+(please|again)$/i;

export default function Timeline() {
  const { data: membership } = useGymMembership();
  const gymId = membership?.gymId;
  const session = useSession();
  const role = useRole();
  const isOwner = role === 'owner';
  const can = useCanFn();
  const currency = useGymCurrency();
  const colors = useThemeColors();
  const qc = useQueryClient();

  const feed = useTimelineFeed(gymId);
  const rules = useGymRules(gymId, isOwner);
  // Owner-gated because the stripe-account function is: a coach asking
  // would get an error, and an error is not a warning.
  const stripe = useStripeWarning(gymId, isOwner);
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
  const requiredLeft = isOwner && setupDone < REQUIRED_SETUP_KEYS.length;
  // The optional three (team, members across, workout history) are still
  // steps in the conversation, so the card has to survive the required
  // list being finished — otherwise finishing six of nine closes the only
  // visible door back in. It reads quieter once nothing is blocking.
  const optionalLeft =
    isOwner &&
    !requiredLeft &&
    (setupProgress.data ?? []).some(
      (r) =>
        !r.done &&
        !(REQUIRED_SETUP_KEYS as readonly string[]).includes(r.step_key),
    );
  // The same flag "Skip for now" writes on /onboarding and setup's own
  // "I'll finish later" (0105): one dismissal, honoured everywhere. The
  // strict `=== false` keeps the card from flashing in before the flag
  // has been read. Setup stays one sentence away — "continue setup" in
  // the bar — so hiding the card closes no doors.
  const setupDismissed = useQuery({
    queryKey: ['gym-onboarding-dismissed', gymId],
    enabled: !!gymId && isOwner,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('gyms')
        .select('onboarding_dismissed_at')
        .eq('id', gymId!)
        .maybeSingle();
      if (error) throw error;
      return !!data?.onboarding_dismissed_at;
    },
  });
  const dismissSetup = async () => {
    if (!gymId) return;
    const { error } = await supabase.rpc('dismiss_gym_onboarding', {
      p_gym_id: gymId,
    });
    if (error) return;
    qc.invalidateQueries({ queryKey: ['gym-onboarding-dismissed'] });
    push({
      kind: 'receipt',
      text: "Hidden. Say 'continue setup' here whenever you want it back.",
    });
  };
  const setupOutstanding =
    (requiredLeft || optionalLeft) && setupDismissed.data === false;
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
  // What was said, as words. Kept alongside the rendered feed rather than
  // read back out of it, because a card is a component and what carries a
  // subject forward is the sentence it amounts to. src/lib/chat-memory
  // bounds it by both recency and count before any of it is sent.
  const said = useRef<Turn[]>([]);
  // Kept as words in two places for two different reasons: the ref is what
  // gets sent with the next sentence, the row is what survives a reload.
  // The insert is deliberately not awaited — a conversation that stalls
  // because its own history could not be written is worse than a gap in
  // the history.
  const remember = (
    role: Turn['role'],
    text: string,
    subject?: string | null,
  ) => {
    said.current = [...said.current.slice(-20), { role, text, at: Date.now() }];
    if (!gymId || !session?.user.id) return;
    void supabase.from('chat_turns').insert({
      gym_id: gymId,
      profile_id: session.user.id,
      role,
      text: text.slice(0, 4000),
      subject_profile_id: subject ?? null,
    });
  };

  // Yesterday's conversation, read back on open. Turns restore as the
  // words they were and never as cards: a preview is a snapshot of a gym
  // that has since moved, so offering its confirm again would be asking
  // somebody to agree to a world that no longer exists.
  //
  // Restoring the ref does NOT weaken the freshness rule — recentTurns
  // still drops anything older than FRESH_MS before it is sent, so
  // reopening the app tomorrow and saying "put him on Unlimited" fails to
  // understand rather than resolving to yesterday's Marcus.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !gymId || !session?.user.id) return;
    restored.current = true;
    void (async () => {
      const { data } = await supabase
        .from('chat_turns')
        .select('role, text, created_at')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false })
        .limit(20);
      const rows = ((data ?? []) as {
        role: Turn['role'];
        text: string;
        created_at: string;
      }[]).reverse();
      if (rows.length === 0) return;
      said.current = rows.map((r) => ({
        role: r.role,
        text: r.text,
        at: Date.parse(r.created_at),
      }));
      setLocal((l) => [
        ...rows.map((r): LocalMsg =>
          r.role === 'owner'
            ? { kind: 'mine', text: r.text }
            : { kind: 'temple', text: r.text },
        ),
        ...l,
      ]);
    })();
  }, [gymId, session?.user.id]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // The stream reads oldest-at-top, so the newest line — and the Waiting
  // block — live at the bottom. Opening the screen at the top would show
  // last week first. Chat behavior instead: pinned to the end while
  // content lays out, released the moment the reader scrolls up into
  // history, re-pinned when they come back to the bottom.
  const pinnedToEnd = useRef(true);
  const onStreamScroll = (e: {
    nativeEvent: {
      contentOffset: { y: number };
      contentSize: { height: number };
      layoutMeasurement: { height: number };
    };
  }) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    pinnedToEnd.current =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - 120;
  };

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

  // Everything the bar can do arrives here. The action's own sanitiser
  // judges the arguments — model output and chip taps alike — and the
  // action's own preview says what it is about to do. Reads inside it run
  // in the owner's session, so RLS decides what it can see exactly as it
  // decides what the screens can see.
  const runAction = async (
    spec: AnyAction,
    raw: Record<string, unknown>,
  ): Promise<LocalMsg> => {
    const parsed = spec.sanitise(raw);
    if (parsed === null || parsed === undefined) {
      return { kind: 'temple', text: MISSING_DETAIL };
    }
    // Type-erased on the way in, checked on the way out: the spec's own
    // sanitiser is what guarantees this matches its preview and apply.
    const args = parsed as never;
    let offer: { label: string; href: string } | undefined;
    const preview = await spec.preview(
      args,
      actionCtx((label, href) => {
        offer = { label, href };
      }),
    );
    return {
      kind: 'action',
      spec,
      args,
      preview,
      offer,
      open: spec.kind === 'do',
    };
  };

  // Two or three things in one sentence. They travel together only if
  // every one of them is a confirmable `do` — a step that came back as a
  // question ("which Marcus?") or a refusal cannot be agreed to in advance
  // alongside something else, so the chain collapses to its first step and
  // the owner is told what was left. Guessing past a question is the one
  // thing this surface must never do.
  const runChain = async (
    steps: { spec: AnyAction; raw: Record<string, unknown> }[],
  ): Promise<LocalMsg[]> => {
    const built: {
      spec: AnyAction;
      args: never;
      preview: ActionPreview;
      offer?: { label: string; href: string };
    }[] = [];
    for (const s of steps) {
      const parsed = s.spec.sanitise(s.raw);
      if (parsed === null || parsed === undefined) break;
      const args = parsed as never;
      let offer: { label: string; href: string } | undefined;
      const preview = await s.spec.preview(
        args,
        actionCtx((label, href) => {
          offer = { label, href };
        }),
      );
      built.push({ spec: s.spec, args, preview, offer });
    }
    const together = travelTogether(
      built.map((b) => ({
        kind: b.spec.kind,
        canApply: !!b.spec.apply,
        confirmable: !!b.preview.yes,
      })),
      steps.length,
    );
    if (together) return [{ kind: 'chain', steps: built, open: true }];
    if (built.length === 0) return [{ kind: 'temple', text: MISSING_DETAIL }];
    const first = built[0];
    const leftover = leftoverLine(steps.length - 1);
    return [
      {
        kind: 'action',
        spec: first.spec,
        args: first.args,
        preview: first.preview,
        offer: first.offer,
        open: first.spec.kind === 'do',
      },
      ...(leftover ? [{ kind: 'temple' as const, text: leftover }] : []),
    ];
  };

  // `offer` is collected during apply and rides on the receipt as a chip.
  // Nothing here navigates: an action that moved the owner to another
  // screen would empty the conversation they were in the middle of.
  const actionCtx = (
    offer?: (label: string, href: string) => void,
  ) => ({
    supabase,
    gymId: gymId!,
    userId: session!.user.id,
    currency,
    offer,
    can: (c: string) => can(c as Capability),
    role,
  });

  const freshen = (spec: AnyAction) => {
    // The stream is this screen's own concern; what else went stale is the
    // module's, and it says so.
    qc.invalidateQueries({ queryKey: ['timeline-feed'] });
    for (const key of spec.invalidate ?? []) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy || !gymId || !session?.user.id) return;
    setInput('');
    push({ kind: 'mine', text });
    const history = toWireTurns(recentTurns(said.current, Date.now()));
    remember('owner', text);
    // "continue setup" is unambiguous enough to answer without a model
    // round-trip — and the owner asking for it is usually mid-task.
    if (SETUP_INTENT.test(text)) {
      push({ kind: 'temple', text: 'Picking up where we left off…' });
      setTimeout(() => router.push('/setup' as never), 400);
      return;
    }
    setBusy(true);
    try {
      const vocabulary = actionsFor((c) => can(c as Capability), role);
      // The last card's action rides along whatever the words say, so
      // "do that again" and "the same for Sarah" still find it.
      const lastSpoken = [...local].reverse().find((m) => m.kind === 'action');
      const keep =
        lastSpoken && lastSpoken.kind === 'action' ? [lastSpoken.spec.name] : [];

      const ask = async (actions: typeof vocabulary) => {
        const { data, error } = await supabase.functions.invoke('parse-setup', {
          body: { gym_id: gymId, step: 'change', text, actions, history },
        });
        if (error) throw error;
        return (data as { proposal?: Record<string, unknown> })?.proposal ?? {};
      };

      // `steps` is the shape; `action`/`args` is the same thing with one
      // step, and is read too because the function and the web app deploy
      // separately — for the minute between the two, one of them is the
      // older half.
      const readSteps = (p: Record<string, unknown>) => {
        const wire = Array.isArray(p.steps)
          ? (p.steps as { action?: unknown; args?: unknown }[])
          : p.action
            ? [{ action: p.action, args: p.args }]
            : [];
        return wire
          .slice(0, 3)
          .map((w) => ({
            spec: findAction(w.action),
            raw: (w.args ?? {}) as Record<string, unknown>,
          }))
          .filter(
            (w): w is { spec: AnyAction; raw: Record<string, unknown> } => !!w.spec,
          );
      };

      // Only the verbs this sentence looks like, which is most of the cost
      // of a turn removed. The catalogue is the fallback rather than the
      // default: a shortlist that drops the right verb would have the bar
      // refuse something it can plainly do, and nothing about that failure
      // looks like a bug — so a refusal is re-asked against everything
      // before it is ever repeated to the owner.
      let p = await ask(shortlist(text, vocabulary, SHORTLIST, keep));
      let steps = readSteps(p);
      if (steps.length === 0 && vocabulary.length > SHORTLIST) {
        p = await ask(vocabulary);
        steps = readSteps(p);
      }
      if (steps.length === 1) {
        const msg = await runAction(steps[0].spec, steps[0].raw);
        if (msg.kind === 'action') remember('gym', msg.preview.title);
        else if (msg.kind === 'temple') remember('gym', msg.text);
        push(msg);
      } else if (steps.length > 1) {
        for (const msg of await runChain(steps)) {
          if (msg.kind === 'chain') remember('gym', msg.steps.map((x) => x.preview.title).join(' '));
          else if (msg.kind === 'action') remember('gym', msg.preview.title);
          else if (msg.kind === 'temple') remember('gym', msg.text);
          push(msg);
        }
      } else if (typeof p.cannot === 'string' && p.cannot.trim()) {
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

  const confirmAction = async (
    index: number,
    msg: Extract<LocalMsg, { kind: 'action' }>,
  ) => {
    if (!gymId || !session?.user.id || busy || !msg.spec.apply) return;
    setBusy(true);
    try {
      let offer: { label: string; href: string } | undefined;
      const receipt = await msg.spec.apply(
        msg.args,
        actionCtx((label, href) => {
          offer = { label, href };
        }),
      );
      closeCard(index);
      push({ kind: 'receipt', text: receipt, offer });
      remember('gym', receipt, subjectOf(msg.args));
      freshen(msg.spec);
    } catch (e) {
      push({ kind: 'temple', text: failureText(e) });
    } finally {
      setBusy(false);
    }
  };

  // The chain, run in the order it was said.
  //
  // No transaction and no rollback, deliberately. These are separate
  // writes across separate tables and some of them leave the database
  // entirely — an email has gone out, Stripe has moved money. "Undoing"
  // the first step after the second failed would mean inventing a reverse
  // for every verb, and a reverse that itself fails leaves the owner worse
  // off than being told plainly.
  //
  // So it stops at the first failure and says exactly where: what got
  // done, what did not, and why. Everything after the failure is left
  // untouched rather than attempted, because the second thing usually
  // assumed the first.
  const confirmChain = async (
    index: number,
    msg: Extract<LocalMsg, { kind: 'chain' }>,
  ) => {
    if (!gymId || !session?.user.id || busy) return;
    setBusy(true);
    try {
      const done: string[] = [];
      let failedAt: { title: string; why: string } | null = null;
      let offer: { label: string; href: string } | undefined;
      for (const st of msg.steps) {
        try {
          done.push(
            await st.spec.apply!(
              st.args,
              actionCtx((label, href) => {
                offer = { label, href };
              }),
            ),
          );
          freshen(st.spec);
        } catch (e) {
          failedAt = { title: st.preview.title, why: failureText(e) };
          break;
        }
      }
      closeCard(index);
      if (done.length > 0) {
        const receipt = done.join(' ');
        push({ kind: 'receipt', text: receipt, offer });
        remember('gym', receipt, subjectOf(msg.steps[0].args));
      }
      if (failedAt) {
        push({ kind: 'temple', text: chainStopLine(done.length, failedAt.why) });
      }
    } finally {
      setBusy(false);
    }
  };

  // A clarifying question answered: the same action again, with the
  // ambiguity settled. It reads as the owner having said the name.
  const pickChoice = async (
    spec: AnyAction,
    label: string,
    args: Record<string, unknown>,
  ) => {
    if (busy || !gymId || !session?.user.id) return;
    setBusy(true);
    push({ kind: 'mine', text: label });
    remember('owner', label);
    try {
      const msg = await runAction(spec, args);
      if (msg.kind === 'action') remember('gym', msg.preview.title);
      push(msg);
    } catch {
      push({ kind: 'temple', text: "I couldn't pull that up — try again." });
    } finally {
      setBusy(false);
    }
  };

  // Tapping a value in the rule sheet is the same write as saying it out
  // loud, so it goes through the same action — there is one path to a
  // rule change, not a tap path and a sentence path.
  const applySingleRule = async (
    field: RuleField,
    value: RuleChoices[RuleField],
  ) => {
    const spec = findAction('gym.change_rules');
    if (!spec?.apply || !gymId || !session?.user.id || busy) return;
    const parsed = spec.sanitise({ rule_changes: [{ field, value }] });
    if (parsed === null || parsed === undefined) return;
    setBusy(true);
    try {
      push({
        kind: 'receipt',
        text: await spec.apply(parsed as never, actionCtx()),
      });
      freshen(spec);
    } catch (e) {
      push({ kind: 'temple', text: failureText(e) });
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

  // ?rules=1 opens the sheet, which is what makes it a destination rather
  // than a chip only somebody already here can find. Settings sections
  // fold into this sheet as they retire, and each one arrives carrying
  // the words people searched for it by — "dm", "leaderboards",
  // "cancellation". Those words need somewhere to land, and until this
  // they had nowhere: the sheet had no address.
  const { rules: rulesParam } = useLocalSearchParams<{ rules?: string }>();
  const openRules = rulesParam === '1';
  useEffect(() => {
    if (openRules && isOwner) showRulesSheet();
    // Once per arrival. Re-opening on every render would re-add the sheet
    // after the owner scrolled past it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRules, isOwner]);

  // The stream is the record; the block is the work. Splitting them is
  // what answers "what do I need to care about" without reading every
  // line — if it's in the stream, it already happened.
  const { stream, waiting } = splitTimeline(
    dedupeClosures(feed.data ?? []),
    session?.user.id,
  );
  const groups = groupTimelineByDay(stream);
  const feedEmpty = (feed.data ?? []).length === 0;

  return (
    <Screen edges={['bottom', 'left', 'right']} className="px-0">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerClassName="gap-6 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full"
          onScroll={onStreamScroll}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            if (pinnedToEnd.current) {
              scrollRef.current?.scrollToEnd({ animated: false });
            }
          }}
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
          ) : feedEmpty && local.length === 0 ? (
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
              <View key={g.key} className="gap-4">
                <Text className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-center pt-2">
                  {g.label}
                </Text>
                {g.events.map((e) => (
                  <ReceiptLine key={e.item_id} event={e} />
                ))}
              </View>
            ))
          )}

          {/* The work, separated from the record. Everything in here is a
              decision or a live problem; the stripe warning joins it
              because money that has stopped arriving is exactly what this
              block exists to surface. */}
          {stripe || waiting.length > 0 ? (
            <View className="gap-3 pt-2">
              <View className="flex-row items-center gap-2 px-1">
                <Ionicons name="hand-left-outline" size={15} color="#F59E0B" />
                <Text className="text-gray-900 dark:text-gray-50 text-[12px] font-bold uppercase tracking-wider">
                  Waiting on you
                </Text>
                <View className="bg-amber-500/15 rounded-full px-2 py-0.5">
                  <Text className="text-amber-600 dark:text-amber-400 text-[11px] font-bold">
                    {waiting.length + (stripe ? 1 : 0)}
                  </Text>
                </View>
              </View>
              {stripe ? (
                <SoftLine
                  text={stripe.text}
                  tone={stripe.tone}
                  icon="card-outline"
                  offer={{ label: 'Open billing', href: '/management/billing' }}
                />
              ) : null}
              {waiting.map((e) =>
                e.kind === 'membership_request' ? (
                  <RequestCard key={e.item_id} event={e} gymId={gymId} />
                ) : e.kind === 'agent_action' ? (
                  <AgentActionCard key={e.item_id} event={e} gymId={gymId} />
                ) : e.kind === 'cover_requested' ? (
                  <CoverOfferCard key={e.item_id} event={e} gymId={gymId} />
                ) : (
                  <ReceiptLine key={e.item_id} event={e} />
                ),
              )}
            </View>
          ) : null}

          {setupOutstanding ? (
            <SetupCard
              done={setupDone}
              total={REQUIRED_SETUP_KEYS.length}
              blocking={requiredLeft}
              onDismiss={dismissSetup}
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
              onConfirmAction={confirmAction}
              onConfirmChain={confirmChain}
              onPickChoice={pickChoice}
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
  onConfirmAction,
  onConfirmChain,
  onPickChoice,
  onDismiss,
  onEditRule,
}: {
  msg: LocalMsg;
  index: number;
  busy: boolean;
  choices: RuleChoices | undefined;
  onConfirmAction: (
    index: number,
    msg: Extract<LocalMsg, { kind: 'action' }>,
  ) => void;
  onConfirmChain: (
    index: number,
    msg: Extract<LocalMsg, { kind: 'chain' }>,
  ) => void;
  onPickChoice: (
    spec: AnyAction,
    label: string,
    args: Record<string, unknown>,
  ) => void;
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
    return (
      <SoftLine
        text={msg.text}
        tone="neutral"
        icon="checkmark-circle-outline"
        offer={msg.offer}
      />
    );
  }
  if (msg.kind === 'rules-sheet') {
    if (!choices) return null;
    return (
      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card">
        <RuleSheet choices={choices} editable={!busy} onEdit={onEditRule} />
      </View>
    );
  }

  // Two or three things, agreed to once. Each step keeps its own title
  // and evidence — collapsing them into "do 3 things?" would be asking
  // somebody to approve a number.
  if (msg.kind === 'chain') {
    if (!msg.open) return null;
    const n = msg.steps.length;
    return (
      <ProposalCard
        title={n === 2 ? 'Both of these?' : `All ${n} of these?`}
        lines={[]}
        body={
          <View className="gap-3">
            {msg.steps.map((st, i) => (
              <View
                key={`${st.spec.name}-${i}`}
                className={`gap-1 ${i > 0 ? 'border-t border-gray-100 dark:border-gray-800 pt-3' : ''}`}>
                <Text className="text-gray-900 dark:text-gray-50 text-[14.5px] font-semibold leading-[20px]">
                  {st.preview.title}
                </Text>
                {st.preview.lines.map((l) => (
                  <Text
                    key={l}
                    className="text-gray-500 dark:text-gray-400 text-[13px] leading-[18px]">
                    {l}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        }
        yes={n === 2 ? 'Yes, do both' : `Yes, do all ${n}`}
        busy={busy}
        onYes={() => onConfirmChain(index, msg)}
        onNo={() => onDismiss(index)}
      />
    );
  }

  // One card for every registry action, whatever the module. A preview
  // asking a clarifying question comes with chips; one naming a renderer
  // gets that renderer; otherwise it is a title and its evidence, with
  // the two choices underneath if there is something to do.
  if (msg.preview.choices?.length) {
    return (
      <View className="gap-3">
        <Text className="text-gray-700 dark:text-gray-200 text-[15px] leading-[22px] px-1">
          {msg.preview.title}
        </Text>
        <View className="flex-row flex-wrap gap-2 px-1">
          {msg.preview.choices.map((c) => (
            <Pressable
              key={c.label}
              onPress={() => onPickChoice(msg.spec, c.label, c.args)}
              disabled={busy}
              className="px-4 py-2.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 active:opacity-70">
              <Text className="text-gray-700 dark:text-gray-300 text-sm font-semibold">
                {c.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }
  if (msg.preview.card === 'member') {
    return <MemberSummaryCard member={msg.preview.data as MemberCard} />;
  }
  if (msg.spec.kind === 'ask') {
    return (
      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card gap-1.5">
        <Text className="text-gray-900 dark:text-gray-50 font-semibold text-[15px]">
          {msg.preview.title}
        </Text>
        {msg.preview.answer ? (
          <View className="pb-1">
            <AnswerFigures answer={msg.preview.answer} />
          </View>
        ) : null}
        {msg.preview.lines.map((l) => (
          <Text
            key={l}
            className="text-gray-500 dark:text-gray-400 text-[13.5px] leading-[19px]">
            {l}
          </Text>
        ))}
        {msg.offer ? (
          <View className="flex-row pt-1.5">
            <OfferChip offer={msg.offer} />
          </View>
        ) : null}
      </View>
    );
  }
  if (!msg.open) return null;
  // A preview with nothing to show is the action saying it couldn't find
  // what was named — the title carries that, and there is nothing to
  // confirm. A named renderer IS something to show, so it does not count
  // as nothing.
  if (msg.preview.lines.length === 0 && !msg.preview.card) {
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
      body={
        msg.preview.card === 'email' ? (
          <EmailDraftPreview draft={msg.preview.data as EmailDraftCard} />
        ) : msg.preview.card === 'programming' ? (
          <ProgrammingChangePreview card={msg.preview.data as ProgrammingChangeCard} />
        ) : null
      }
      yes={msg.preview.yes ?? 'Yes, do it'}
      busy={busy}
      onYes={() => onConfirmAction(index, msg)}
      onNo={() => onDismiss(index)}
    />
  );
}

// Twelve is where the held-out set stops improving: 30 of 32 hand-written
// paraphrases land inside it, and the two that do not share no words at
// all with the action they mean, which no depth would fix. The retry
// catches those.
const SHORTLIST = 12;

const WEB = Platform.OS === 'web';

// Tall enough that a short newsletter doesn't sit in a letterbox, short
// enough that three of them in a sequence card don't bury the two
// choices underneath. The iframe scrolls past this either way.
function frameHeight(sections: number): number {
  return Math.min(520, 230 + sections * 105);
}

// The drafted email, in the chat.
//
// On web this is the email — the compiled HTML the send worker will post,
// in the same sandboxed iframe the campaign editor previews with, so the
// logo is the logo and the styling is the styling. On native there is no
// WebView in this app, so the card shows the subject and the sections as
// text; that is a downgrade in fidelity and not in content, which is the
// right way round for a surface whose question is "does this say the
// right thing".
//
// One card for both verbs. A newsletter is one email with no timing on
// it; a sequence is several, each stamped with when it goes.
function EmailDraftPreview({ draft }: { draft: EmailDraftCard }) {
  return (
    <View className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
      <View
        className="px-4 py-3 flex-row items-center gap-2.5"
        style={{ backgroundColor: draft.primaryColor }}>
        {draft.logoUrl ? (
          <Image
            source={{ uri: draft.logoUrl }}
            style={{ width: 22, height: 22, borderRadius: 5 }}
            resizeMode="contain"
          />
        ) : null}
        <Text className="text-white text-[13px] font-bold flex-1" numberOfLines={1}>
          {draft.gymName}
        </Text>
      </View>

      {draft.audience ? (
        <View className="px-4 py-2 bg-gray-50 dark:bg-gray-800/60">
          <Text className="text-gray-600 dark:text-gray-300 text-xs font-semibold">
            {draft.audience}
          </Text>
        </View>
      ) : null}

      <View className="bg-white dark:bg-gray-950">
        {draft.emails.map((e, i) => (
          <View
            key={`${e.subject}-${i}`}
            className={`px-4 py-3 gap-2 ${i > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''}`}>
            {e.when ? (
              <Text className="text-gray-400 dark:text-gray-500 text-[11px] font-bold uppercase tracking-wider">
                {e.when}
              </Text>
            ) : null}
            <Text className="text-gray-900 dark:text-gray-50 text-[14.5px] font-semibold leading-[20px]">
              {e.subject}
            </Text>
            {WEB ? (
              // The compiled email in a sandboxed iframe: the real logo,
              // the real block styling, the real widths. Same component
              // the campaign editor previews with, read-only.
              <HtmlPreview html={e.html} height={frameHeight(e.sections.length)} />
            ) : (
              // No WebView in this app, so native reads the words instead
              // of the email. Better than the stock "open Temple on the
              // web" placeholder, which answers a question nobody asked
              // while sitting on top of the draft they wanted to read.
              e.sections.map((sec, j) => (
                <View key={`${sec.heading}-${j}`} className="gap-0.5">
                  <Text className="text-gray-800 dark:text-gray-100 text-[13.5px] font-semibold">
                    {sec.heading}
                  </Text>
                  <Text className="text-gray-600 dark:text-gray-300 text-[13.5px] leading-[19px]">
                    {sec.body}
                  </Text>
                </View>
              ))
            )}
          </View>
        ))}
      </View>

      {draft.note ? (
        <View className="px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-100 dark:border-amber-900/40">
          <Text className="text-amber-800 dark:text-amber-300 text-xs leading-[17px]">
            {draft.note}
          </Text>
        </View>
      ) : null}
    </View>
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
  const currency = useGymCurrency();
  const facts: { label: string; value: string }[] = [
    {
      label: 'On',
      value: member.planName
        ? member.priceCents !== null
          ? `${member.planName} · ${formatPrice(member.priceCents, currency)}`
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
  if (member.unreachable) {
    facts.push({
      label: 'Email',
      value:
        member.unreachable === 'complaint'
          ? 'They marked one as spam — nothing is sent to them'
          : 'Bounces — phone them or message them here instead',
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


// What a copy or a wipe is about to do to the whiteboard (0231).
//
// The one card in the bar whose job is to make somebody say no. Every
// other preview summarises; this one quotes, because the thing at risk is
// a session a coach wrote by hand and the only way to recognise it is to
// see their own words. A count would confirm an overwrite without ever
// showing what was overwritten.
function ProgrammingChangePreview({ card }: { card: ProgrammingChangeCard }) {
  return (
    <View className="gap-2">
      {card.rows.map((row, i) => (
        <View
          key={`${row.date}:${row.classType}:${i}`}
          className="border border-gray-200 dark:border-gray-800 rounded-lg p-3 gap-1.5">
          <View className="flex-row items-baseline gap-2">
            <Text className="text-gray-900 dark:text-gray-50 text-[13px] font-semibold">
              {row.day}
            </Text>
            <Text className="text-gray-400 dark:text-gray-500 text-[12px] flex-1">
              {row.classType}
            </Text>
          </View>

          {row.incoming.map((line, j) => (
            <Text
              key={`in:${j}`}
              className="text-gray-700 dark:text-gray-200 text-[13px] leading-[18px]">
              {line}
            </Text>
          ))}

          {row.replacing.length > 0 ? (
            <View className="gap-1 pt-1.5 border-t border-gray-100 dark:border-gray-800">
              <Text className="text-red-600 dark:text-red-400 text-[11px] font-semibold uppercase tracking-wide">
                {row.incoming.length > 0 ? 'Replaces' : 'Deletes'}
              </Text>
              {row.replacing.map((line, j) => (
                <Text
                  key={`out:${j}`}
                  className="text-red-600/90 dark:text-red-400/90 text-[13px] leading-[18px] line-through">
                  {line}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function ProposalCard({
  title,
  lines,
  body,
  yes,
  busy,
  onYes,
  onNo,
}: {
  title: string;
  lines: string[];
  // A preview that named a renderer shows it here, in place of prose. The
  // two choices underneath are the same either way — what is being agreed
  // to doesn't change because it can be seen properly.
  body?: ReactNode;
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
      {body ?? null}
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
  // How many actually get the email, which is not the same as how many
  // qualified: past twelve this is a mailshot and the tick caps it.
  const sentCount = Array.isArray(payload.recipients) ? payload.recipients.length : 0;

  const line = formatTimelineLine(event);
  const reasoning =
    kind === 'class_return_message'
      ? 'They have not left the gym, only this class — which is the one Temple can still do something about.'
      : kind === 'retention_message'
      ? 'One warm note from the gym usually brings a regular back.'
      : kind === 'first_week_message'
        ? 'The first session is the hard one — most people who never start never come back.'
        : kind === 'credits_low_message'
        ? 'Topping up is easy while they are still coming; finding out at the door is not.'
        : kind === 'plan_upgrade_offer'
          ? `Their own training says ${offerPlan ?? 'a membership'} is cheaper than the next pack.`
        : kind === 'cover_ask'
          ? 'Every coach who could claim gets the same nudge; the claim stays first-come.'
          : isOffer
            ? `Stripe has stopped trying${offerPlan ? ` — ${offerPlan}${offerPrice ? ` at ${offerPrice}` : ''} might keep them` : ''}.`
            : 'A friendly note with their pay link usually sorts it.';
  const yesLabel =
    kind === 'class_return_message'
      ? 'Yes, ask them back'
      : kind === 'retention_message'
      ? 'Yes, reach out'
      : kind === 'first_week_message'
        ? 'Yes, get them in'
        : kind === 'credits_low_message'
        ? 'Yes, tell them'
        : kind === 'plan_upgrade_offer'
          ? 'Yes, show them'
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
        icon="sparkles-outline"
        href={actionId ? `/timeline/${actionId}` : undefined}
        text={
          decided === 'approve'
            ? kind === 'class_return_message'
              ? `Asked — ${sentCount === 1 ? 'the one regular has' : `all ${sentCount} have`} the invitation.`
              : kind === 'cover_ask'
              ? 'Asked — the coaches have a fresh nudge.'
              : isOffer
                ? `Offered — ${first} has it in their inbox.`
                : `Sent — ${first} has the note.`
            : kind === 'class_return_message'
              ? 'Left alone — nobody was asked back.'
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

// A cover offer, where the coach already is (0243). The feed has carried
// `cover_requested` since 0204 and gates it on can_claim_cover — exactly
// the people who could take it — but it carried a count, which is a thing
// to read. The offers ride along now, so it is a thing to do.
//
// The claim is a race and stays one: claim_cover locks the row, so two
// coaches tapping at once resolve in the database. Losing is a normal
// outcome rather than an error, and the card says so in the server's own
// words rather than inventing a friendlier lie.
type CoverOffer = { offer_id: string; name: string; starts_at: string };

function openOffers(event: TimelineEvent): CoverOffer[] {
  const raw = (event.detail as { open_sessions?: unknown }).open_sessions;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (o): o is CoverOffer =>
      !!o &&
      typeof (o as CoverOffer).offer_id === 'string' &&
      typeof (o as CoverOffer).starts_at === 'string',
  );
}

function CoverOfferCard({
  event,
  gymId,
}: {
  event: TimelineEvent;
  gymId: string | undefined;
}) {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [taken, setTaken] = useState<string[]>([]);
  const [refused, setRefused] = useState<string | null>(null);
  const offers = openOffers(event);
  const who = event.subject.trim().split(/\s+/)[0] || 'A coach';

  const claim = async (offer: CoverOffer) => {
    if (busyId) return;
    setBusyId(offer.offer_id);
    setRefused(null);
    const { error } = await supabase.rpc('claim_cover', {
      p_session_offer_id: offer.offer_id,
    });
    setBusyId(null);
    if (error) {
      // "Offer already claimed or cancelled", "You are not qualified to
      // cover this class type", "That would clash with a class you are
      // already teaching" — every one of these is already the sentence a
      // coach needs, written where the rule is enforced.
      setRefused(error.message);
      qc.invalidateQueries({ queryKey: ['timeline-feed', gymId] });
      return;
    }
    setTaken((t) => [...t, offer.offer_id]);
    qc.invalidateQueries({ queryKey: ['timeline-feed', gymId] });
    qc.invalidateQueries({ queryKey: ['my-upcoming-sessions'] });
  };

  const left = offers.filter((o) => !taken.includes(o.offer_id));

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card gap-3">
      <Text className="text-gray-900 dark:text-gray-50 font-semibold text-[15px] leading-[22px]">
        {who} needs cover.{' '}
        {left.length === 0 ? 'You picked it up.' : 'Take one?'}
      </Text>

      {left.map((o) => (
        <View key={o.offer_id} className="flex-row items-center gap-3">
          <View className="flex-1">
            <Text className="text-gray-700 dark:text-gray-200 text-[14px]">
              {o.name}
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-[12.5px]">
              {new Date(o.starts_at).toLocaleString('en-GB', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              })}
            </Text>
          </View>
          <Pressable
            onPress={() => claim(o)}
            disabled={!!busyId}
            className="px-4 py-2.5 rounded-lg bg-primary active:opacity-70">
            <Text className="text-white text-sm font-semibold">
              {busyId === o.offer_id ? 'Taking…' : "I'll take it"}
            </Text>
          </Pressable>
        </View>
      ))}

      {taken.length > 0 ? (
        <Text className="text-gray-500 dark:text-gray-400 text-[13px]">
          It&apos;s yours — it&apos;s on your schedule now.
        </Text>
      ) : null}

      {refused ? (
        <Text className="text-amber-700 dark:text-amber-500 text-[13px]">
          {refused}
        </Text>
      ) : null}

      <Text className="text-gray-400 dark:text-gray-500 text-[12.5px]">
        First to claim takes it.
      </Text>
    </View>
  );
}

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
        icon="checkmark-circle-outline"
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
function SetupCard({
  done,
  total,
  blocking,
  onDismiss,
}: {
  done: number;
  total: number;
  blocking: boolean;
  // Writes the same 0105 flag as "Skip for now" on /onboarding: this
  // card never comes back, and setup stays reachable through the bar.
  onDismiss: () => void;
}) {
  const colors = useThemeColors();
  // Once nothing is blocking, this is an offer rather than a warning: one
  // line and a link, no progress bar counting a list that's finished.
  if (!blocking) {
    return (
      <View className="flex-row items-center gap-2.5 px-1">
        <Ionicons name="rocket-outline" size={15} color={colors.iconSecondary} />
        <Pressable
          onPress={() => router.push('/setup' as never)}
          className="flex-1 active:opacity-70">
          <Text className="text-gray-500 dark:text-gray-400 text-[13.5px]">
            Your gym is ready. A few optional bits are still there if you want
            them —{' '}
            <Text className="text-link font-medium">
              pick up where you left off
            </Text>
            .
          </Text>
        </Pressable>
        <Pressable
          onPress={onDismiss}
          hitSlop={8}
          accessibilityLabel="Don't show this again">
          <Ionicons name="close" size={16} color={colors.iconSecondary} />
        </Pressable>
      </View>
    );
  }
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
      <Pressable
        onPress={onDismiss}
        hitSlop={6}
        className="items-center active:opacity-70">
        <Text className="text-gray-400 dark:text-gray-500 text-[13px] font-medium">
          Don&apos;t show this again
        </Text>
      </Pressable>
    </View>
  );
}
