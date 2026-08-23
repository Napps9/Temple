import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import { Text } from '@/components/Text';

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { Input } from '@/components/Input';
import { ListRow, RuledList } from '@/components/ListRow';
import { PageHead } from '@/components/PageHead';
import { PillNav } from '@/components/PillNav';
import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { formatDate } from '@/lib/format-date';
import { errorMessage } from '@/lib/errors';
import {
  buildGymFeed,
  classChangeTitle,
  unreadOnly,
  type GymFeedItem,
  type InboxChip,
} from '@/lib/inbox-feed';
import { injuryTitle } from '@/lib/injuries';
import {
  snippet,
  timeAgo,
  type AnnouncementRow,
  type ClassBroadcastRow,
  type DmInboxRow,
} from '@/lib/messaging';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import {
  useLogNudge,
  useUnreadCoverNotifications,
} from '@/lib/notifications';
import { dueCheckIns, useMyInjuries } from '@/lib/useInjuries';
import { useThemeColors } from '@/lib/theme';
import type { StaffAlertKind } from '@/types/database';

type CoverNotificationRow = {
  id: string;
  kind: 'cover_requested' | 'cover_claimed' | 'cover_uncovered';
  request_id: string;
  offer_id: string | null;
  created_at: string;
  read_at: string | null;
  cover_requests: {
    range_start: string;
    range_end: string;
    requested_start: string | null;
    requested_end: string | null;
    requester: { full_name: string | null } | null;
  } | null;
};

type StaffAlertRow = {
  id: string;
  gym_id: string;
  kind: StaffAlertKind;
  subject_profile_id: string | null;
  related_id: string | null;
  created_at: string;
  acknowledged_at: string | null;
  subject: { full_name: string | null; avatar_url: string | null } | null;
};

// Per-kind alert copy. subject name is prefixed by the card.
const ALERT_COPY: Record<
  StaffAlertKind,
  { title: string; body: string; icon: 'alert-circle' | 'bandage' | 'pulse' }
> = {
  parq_flag: {
    title: 'flagged a health issue',
    body: 'They flagged at least one PAR-Q question. Open their profile to review the response.',
    icon: 'alert-circle',
  },
  injury_new: {
    title: 'logged a new injury',
    body: 'They recorded a new injury, including which movements hurt. Open their profile for the details.',
    icon: 'bandage',
  },
  injury_update: {
    title: 'updated an injury',
    body: 'They checked in on an existing injury. Open their profile to see how it is trending.',
    icon: 'pulse',
  },
};

type ClassSessionLite = {
  id: string;
  starts_at: string;
  duration_minutes: number;
  class_types: { name: string; color: string } | null;
};

type ClassBroadcastWithSession = ClassBroadcastRow & {
  class_sessions: ClassSessionLite | null;
};

type ClassChangeRow = {
  id: string;
  kind: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

// Session-only view memory: coming back to the inbox lands on the chip
// you left, and "Not now" on the payment card holds for the session —
// the payment is still failing, so it returns next visit rather than
// being silenced by one tap.
let lastInboxChip: InboxChip = 'new';
let paymentDismissedThisSession = false;

function fmtSessionTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
  return `${date} · ${time}`;
}

export default function Inbox() {
  const colors = useThemeColors();
  const session = useSession();
  const { data: membership } = useGymMembership();
  const canPostAnnouncements = useCan('can_post_announcements');
  const canBroadcast = useCan('can_broadcast_to_class');
  const canSeeHealthFlag = useCan('can_see_health_flag') ?? false;
  const canRequestCover = useCan('can_request_cover') ?? false;
  const canClaimCover = useCan('can_claim_cover') ?? false;
  const canCover = canRequestCover || canClaimCover;
  const unreadCover = useUnreadCoverNotifications();
  const queryClient = useQueryClient();

  const [chip, setChipState] = useState<InboxChip>(lastInboxChip);
  const setChip = (next: InboxChip) => {
    lastInboxChip = next;
    setChipState(next);
  };
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const gymId = membership?.gymId;
  const uid = session?.user.id;

  const unread = useQuery({
    queryKey: ['inbox-unread-summary', uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('inbox_unread_summary');
      if (error) throw error;
      const row = (data ?? [])[0] as
        | {
            dm_unread: number;
            announcement_unread: number;
            class_broadcast_unread: number;
            class_change_unread: number;
            payment_unread: number;
          }
        | undefined;
      return (
        row ?? {
          dm_unread: 0,
          announcement_unread: 0,
          class_broadcast_unread: 0,
          class_change_unread: 0,
          payment_unread: 0,
        }
      );
    },
  });

  function refreshUnread() {
    queryClient.invalidateQueries({ queryKey: ['inbox-unread-summary'] });
  }

  const dms = useQuery({
    queryKey: ['dm-inbox', uid],
    enabled: !!uid,
    queryFn: async (): Promise<DmInboxRow[]> => {
      const { data, error } = await supabase.rpc('dm_inbox');
      if (error) throw error;
      return (data ?? []) as DmInboxRow[];
    },
  });

  const announcements = useQuery({
    queryKey: ['gym-announcements', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<AnnouncementRow[]> => {
      const { data, error } = await supabase
        .from('gym_announcements')
        .select('id, gym_id, posted_by, title, body, pinned, created_at')
        .eq('gym_id', gymId!)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as AnnouncementRow[];
    },
  });

  const announcementReads = useQuery({
    queryKey: ['my-announcement-reads', uid],
    enabled: !!uid,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('announcement_reads')
        .select('announcement_id')
        .eq('profile_id', uid!);
      if (error) throw error;
      return new Set(
        (data ?? []).map((r) => (r as { announcement_id: string }).announcement_id),
      );
    },
  });

  const broadcasts = useQuery({
    queryKey: ['class-session-broadcasts', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<ClassBroadcastWithSession[]> => {
      const { data, error } = await supabase
        .from('class_session_broadcasts')
        .select(
          'id, gym_id, class_session_id, sender_id, body, created_at, class_sessions(id, starts_at, duration_minutes, class_types(name, color))',
        )
        .eq('gym_id', gymId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ClassBroadcastWithSession[];
    },
  });

  const broadcastReads = useQuery({
    queryKey: ['my-broadcast-reads', uid],
    enabled: !!uid,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('class_session_broadcast_reads')
        .select('broadcast_id')
        .eq('profile_id', uid!);
      if (error) throw error;
      return new Set(
        (data ?? []).map((r) => (r as { broadcast_id: string }).broadcast_id),
      );
    },
  });

  const classChanges = useQuery({
    queryKey: ['class-change-notifications', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<ClassChangeRow[]> => {
      const { data, error } = await supabase
        .from('class_change_notifications')
        .select('id, kind, body, created_at, read_at')
        .eq('gym_id', gymId!)
        .eq('channel', 'in_app')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as ClassChangeRow[];
    },
  });

  // Closures and cancellations carry their whole message in `body` (the
  // classes they describe may be deleted), so seeing them IS reading
  // them — mark once per mount, only while a chip that shows them is up.
  const markedChanges = useRef(false);
  const showsGymFeed = chip === 'new' || chip === 'all' || chip === 'gym';
  useEffect(() => {
    if (markedChanges.current || !gymId || !showsGymFeed) return;
    if (!(classChanges.data ?? []).some((r) => r.read_at === null)) return;
    markedChanges.current = true;
    supabase
      .rpc('mark_class_change_notifications_read', { p_gym_id: gymId })
      .then(() => refreshUnread());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classChanges.data, gymId, showsGymFeed]);

  if (!session || !membership) return null;

  const summary = unread.data;
  const gymUnread =
    (summary?.announcement_unread ?? 0) +
    (summary?.class_broadcast_unread ?? 0) +
    (summary?.class_change_unread ?? 0);
  const newCount =
    gymUnread + (summary?.dm_unread ?? 0) + (summary?.payment_unread ?? 0);

  const gymFeed = buildGymFeed([
    ...(announcements.data ?? []).map(
      (a): GymFeedItem => ({
        kind: 'announcement',
        id: a.id,
        ts: a.created_at,
        unread: announcementReads.data ? !announcementReads.data.has(a.id) : false,
        pinned: a.pinned,
        title: a.title,
        body: a.body,
        dotColor: null,
      }),
    ),
    ...(broadcasts.data ?? []).map(
      (b): GymFeedItem => ({
        kind: 'broadcast',
        id: b.id,
        ts: b.created_at,
        unread: broadcastReads.data ? !broadcastReads.data.has(b.id) : false,
        pinned: false,
        title: b.class_sessions?.class_types?.name ?? 'Class',
        body: b.class_sessions
          ? `${fmtSessionTime(b.class_sessions.starts_at)} — ${b.body}`
          : b.body,
        dotColor: b.class_sessions?.class_types?.color ?? null,
      }),
    ),
    ...(classChanges.data ?? []).map(
      (n): GymFeedItem => ({
        kind: 'class_change',
        id: n.id,
        ts: n.created_at,
        unread: n.read_at === null,
        pinned: false,
        title: classChangeTitle(n.kind),
        body: n.body,
        dotColor: null,
      }),
    ),
  ]);

  const dmRows = dms.data ?? [];
  const shownGym = chip === 'new' ? unreadOnly(gymFeed) : gymFeed;
  const shownDms =
    chip === 'new' ? dmRows.filter((r) => r.unread_count > 0) : dmRows;

  const loading =
    unread.isLoading ||
    dms.isLoading ||
    announcements.isLoading ||
    broadcasts.isLoading ||
    classChanges.isLoading;

  const chips = [
    { key: 'new' as const, label: newCount > 0 ? `New · ${newCount}` : 'New' },
    { key: 'all' as const, label: 'All' },
    {
      key: 'gym' as const,
      label: gymUnread > 0 ? `From the gym · ${gymUnread}` : 'From the gym',
    },
    {
      key: 'direct' as const,
      label:
        (summary?.dm_unread ?? 0) > 0
          ? `Direct · ${summary!.dm_unread}`
          : 'Direct',
    },
    ...(canSeeHealthFlag ? [{ key: 'alerts' as const, label: 'Alerts' }] : []),
    ...(canCover
      ? [
          {
            key: 'cover' as const,
            label:
              (unreadCover.data ?? 0) > 0
                ? `Cover · ${unreadCover.data}`
                : 'Cover',
          },
        ]
      : []),
  ];
  // A remembered staff chip degrades for a viewer who can no longer see it.
  const activeChip = chips.some((c) => c.key === chip) ? chip : 'new';

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const gymSection = (
    <GymFeedSection
      items={shownGym}
      loading={loading}
      showLabel={activeChip !== 'gym'}
      canPost={canPostAnnouncements === true}
      canBroadcast={canBroadcast === true}
      gymId={membership.gymId}
      posterId={session.user.id}
      allIds={(announcements.data ?? []).map((a) => a.id)}
      allBroadcastIds={(broadcasts.data ?? []).map((b) => b.id)}
      expanded={expanded}
      onToggle={toggleExpanded}
      onChange={() => {
        refreshUnread();
        queryClient.invalidateQueries({ queryKey: ['my-announcement-reads'] });
        queryClient.invalidateQueries({ queryKey: ['my-broadcast-reads'] });
      }}
      emptyCopy={
        activeChip === 'new' ? null : 'Nothing from the gym yet.'
      }
    />
  );

  const directSection = (
    <View className="gap-2">
      {activeChip !== 'direct' ? <SectionLabel>Direct</SectionLabel> : null}
      {dms.isLoading ? (
        <EmptyState kind="loading" rows={2} />
      ) : shownDms.length === 0 ? (
        activeChip === 'direct' ? (
          <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4">
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              No conversations yet. Tap New message to start one.
            </Text>
          </View>
        ) : null
      ) : (
        <RuledList>
          {shownDms.map((row, i) => (
            <ListRow
              key={row.peer_profile_id}
              ruled
              first={i === 0}
              href={`/inbox/direct/${row.peer_profile_id}` as never}
              title={row.peer_full_name ?? 'Member'}
              subtitle={`${row.last_message_from_me ? 'You: ' : ''}${snippet(
                row.last_message_body,
                60,
              )}`}
              chip={
                <View className="flex-row items-center gap-2">
                  {row.peer_role && row.peer_role !== 'member' ? (
                    <View className="rounded-full bg-raised dark:bg-raised-dk px-2 py-0.5">
                      <Text className="text-ink-2 dark:text-ink-2-dk text-[10px] uppercase tracking-wider">
                        {row.peer_role}
                      </Text>
                    </View>
                  ) : null}
                  <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                    {timeAgo(row.last_message_at)}
                  </Text>
                  {row.unread_count > 0 ? (
                    <View className="bg-primary rounded-full min-w-5 h-5 px-1.5 items-center justify-center">
                      <Text className="text-on-primary text-xs font-semibold">
                        {row.unread_count}
                      </Text>
                    </View>
                  ) : null}
                </View>
              }
            />
          ))}
        </RuledList>
      )}
    </View>
  );

  const decisionCards = (
    <>
      <PaymentDecisionCard
        gymId={membership.gymId}
        profileId={session.user.id}
      />
      <InjuryCheckInCard />
      <LogNudgeCard />
    </>
  );

  const caughtUp =
    activeChip === 'new' &&
    !loading &&
    shownGym.length === 0 &&
    shownDms.length === 0;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <PageHead
          title="Inbox"
          subtitle="Messages from coaches and the gym."
          action={
            <Pressable
              onPress={() => router.push('/inbox/direct/new' as never)}
              accessibilityRole="button"
              accessibilityLabel="New message"
              className="flex-row items-center gap-1 bg-primary active:bg-primary-dark rounded-full px-3 py-1.5">
              <Ionicons name="add" size={14} color={colors.onPrimary} />
              <Text className="text-on-primary text-xs font-semibold">
                New message
              </Text>
            </Pressable>
          }
        />

        <PillNav items={chips} active={activeChip} onSelect={setChip} />

        {activeChip === 'alerts' ? (
          <AlertsTab gymId={membership.gymId} />
        ) : activeChip === 'cover' ? (
          <CoverTab gymId={membership.gymId} />
        ) : (
          <>
            {activeChip === 'new' || activeChip === 'all'
              ? decisionCards
              : null}
            {caughtUp ? (
              <EmptyState
                icon="checkmark-done-outline"
                title="You're all caught up"
                description="Nothing new from the gym or your conversations."
                actionLabel="See everything"
                actionIcon="albums-outline"
                onAction={() => setChip('all')}
              />
            ) : (
              <>
                {activeChip !== 'direct' ? gymSection : null}
                {activeChip !== 'gym' ? directSection : null}
              </>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function GymFeedSection({
  items,
  loading,
  showLabel,
  canPost,
  canBroadcast,
  gymId,
  posterId,
  allIds,
  allBroadcastIds,
  expanded,
  onToggle,
  onChange,
  emptyCopy,
}: {
  items: GymFeedItem[];
  loading: boolean;
  showLabel: boolean;
  canPost: boolean;
  canBroadcast: boolean;
  gymId: string;
  posterId: string;
  allIds: string[];
  allBroadcastIds: string[];
  expanded: Set<string>;
  onToggle: (key: string) => void;
  emptyCopy: string | null;
  onChange: () => void;
}) {
  const colors = useThemeColors();
  const [composeOpen, setComposeOpen] = useState(false);

  // Marks every announcement and broadcast on the page read in one go.
  const markAllRead = useMutation({
    mutationFn: async () => {
      if (allIds.length > 0) {
        const { error } = await supabase.from('announcement_reads').upsert(
          allIds.map((id) => ({ announcement_id: id, profile_id: posterId })),
          { onConflict: 'announcement_id,profile_id' },
        );
        if (error) throw error;
      }
      if (allBroadcastIds.length > 0) {
        const { error } = await supabase
          .from('class_session_broadcast_reads')
          .upsert(
            allBroadcastIds.map((id) => ({
              broadcast_id: id,
              profile_id: posterId,
            })),
            { onConflict: 'broadcast_id,profile_id' },
          );
        if (error) throw error;
      }
    },
    onSuccess: onChange,
  });

  const header = (
    <View className="flex-row items-center justify-between gap-3">
      {showLabel ? (
        <SectionLabel>From the gym</SectionLabel>
      ) : (
        <View className="flex-1" />
      )}
      <View className="flex-row gap-2">
        {items.some((i) => i.unread) ? (
          <ChipButton
            tone="neutral"
            label="Mark all read"
            icon="checkmark-done-outline"
            onPress={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
          />
        ) : null}
        {canBroadcast ? (
          <ChipButton
            tone="neutral"
            label="Broadcast"
            icon="megaphone-outline"
            onPress={() => router.push('/inbox/broadcast/new' as never)}
          />
        ) : null}
        {canPost ? (
          <ChipButton
            tone="neutral"
            label={composeOpen ? 'Close' : 'Post'}
            icon={composeOpen ? 'close' : 'add'}
            onPress={() => setComposeOpen((v) => !v)}
          />
        ) : null}
      </View>
    </View>
  );

  return (
    <View className="gap-2">
      {header}
      {composeOpen ? (
        <AnnouncementComposer
          gymId={gymId}
          posterId={posterId}
          onPosted={() => {
            setComposeOpen(false);
            onChange();
          }}
        />
      ) : null}
      {loading ? (
        <EmptyState kind="loading" rows={3} />
      ) : items.length === 0 ? (
        emptyCopy ? (
          <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4">
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              {emptyCopy}
            </Text>
          </View>
        ) : null
      ) : (
        <RuledList>
          {items.map((item, i) => {
            const key = `${item.kind}:${item.id}`;
            const isOpen = expanded.has(key);
            return (
              <ListRow
                key={key}
                ruled
                first={i === 0}
                title={item.title}
                subtitle={isOpen ? undefined : snippet(item.body, 80)}
                onPress={() => onToggle(key)}
                lead={
                  item.dotColor ? (
                    <View
                      style={{ backgroundColor: item.dotColor }}
                      className="w-2.5 h-2.5 rounded-full"
                    />
                  ) : undefined
                }
                chip={
                  item.pinned ? (
                    <View className="flex-row items-center gap-1 rounded-full bg-raised dark:bg-raised-dk px-2 py-0.5">
                      <Ionicons name="pin" size={10} color={colors.ink2} />
                      <Text className="text-ink-2 dark:text-ink-2-dk text-[10px] font-semibold">
                        Pinned
                      </Text>
                    </View>
                  ) : undefined
                }
                trailing={
                  <View className="items-end gap-1">
                    <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                      {timeAgo(item.ts)}
                    </Text>
                    {item.unread ? (
                      <View className="w-2 h-2 rounded-full bg-primary" />
                    ) : null}
                  </View>
                }
                foot={
                  isOpen ? (
                    <Text className="text-ink-2 dark:text-ink-2-dk text-sm pt-1">
                      {item.body}
                    </Text>
                  ) : undefined
                }
              />
            );
          })}
        </RuledList>
      )}
    </View>
  );
}

function AnnouncementComposer({
  gymId,
  posterId,
  onPosted,
}: {
  gymId: string;
  posterId: string;
  onPosted: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = useMutation({
    mutationFn: async () => {
      if (!title.trim() || !body.trim()) {
        throw new Error('Title and body are required');
      }
      const { error: e } = await supabase.from('gym_announcements').insert({
        gym_id: gymId,
        posted_by: posterId,
        title: title.trim(),
        body: body.trim(),
        pinned,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setTitle('');
      setBody('');
      setPinned(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['gym-announcements'] });
      onPosted();
    },
    onError: (e) => setError(errorMessage(e, 'Could not post')),
  });

  return (
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
      <Input
        label="Title"
        value={title}
        onChangeText={setTitle}
        placeholder="Closed Monday"
        autoCapitalize="sentences"
      />
      <Input
        label="Body"
        value={body}
        onChangeText={setBody}
        placeholder="Cleaning the floor — reopening Tuesday at 6am."
        multiline
        numberOfLines={4}
        style={{ minHeight: 100, textAlignVertical: 'top' }}
        autoCapitalize="sentences"
      />
      <View className="flex-row items-center gap-2">
        <Switch
          accessibilityLabel="Pin to top"
          value={pinned}
          onValueChange={setPinned}
        />
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm">Pin to top</Text>
      </View>
      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text>
      ) : null}
      <Button onPress={() => post.mutate()} loading={post.isPending}>
        Post announcement
      </Button>
    </View>
  );
}

// A failing payment is the one inbox item that costs the member their
// membership if ignored, so it leads the feed as a decision card with
// its two real choices. Shown for as long as the payment is ACTUALLY
// failing (dunning row present), not for as long as the notice is
// unread; "Not now" holds for the session only, because the payment is
// still failing tomorrow. The badge stays read-based on purpose — the
// badge means "something new", this card means "something ongoing".
function PaymentDecisionCard({
  gymId,
  profileId,
}: {
  gymId: string;
  profileId: string;
}) {
  const [dismissed, setDismissed] = useState(paymentDismissedThisSession);

  // Presence of a dunning row IS past-due (0176), and recovery deletes it,
  // so the card clears itself without needing to be told.
  const failing = useQuery({
    queryKey: ['my-dunning', gymId, profileId],
    enabled: !!gymId && !!profileId,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('plan_subscription_dunning')
        .select('plan_subscription_id', { count: 'exact', head: true })
        .eq('gym_id', gymId)
        .eq('profile_id', profileId);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const notices = useQuery({
    queryKey: ['payment-notifications', gymId, profileId],
    enabled: !!gymId && !!profileId && (failing.data ?? 0) > 0,
    queryFn: async (): Promise<{ id: string; kind: string; body: string }[]> => {
      // Scoped to the reader. RLS lets can_see_money staff read every
      // member's rows, so without this an owner sees a member's failed
      // payment as their own.
      const { data, error } = await supabase
        .from('payment_notifications')
        .select('id, kind, body')
        .eq('gym_id', gymId)
        .eq('recipient_profile_id', profileId)
        .eq('channel', 'in_app')
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data ?? []) as { id: string; kind: string; body: string }[];
    },
  });

  const notice = notices.data?.[0];
  if (dismissed || !(failing.data ?? 0) || !notice) return null;

  return (
    <View className="bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-card p-4 gap-2">
      <View className="flex-row items-center gap-2">
        <Ionicons name="card-outline" size={18} color="#DC2626" />
        <Text
          className="flex-1 text-red-800 dark:text-red-200 font-semibold"
          numberOfLines={1}>
          {notice.kind === 'payment_final_notice'
            ? 'Your membership is about to stop'
            : "We couldn't take your payment"}
        </Text>
      </View>
      <Text className="text-red-900 dark:text-red-100 text-sm">
        {notice.body}
      </Text>
      <View className="flex-row gap-2">
        <ChipButton
          tone="red"
          label="Update card"
          icon="card-outline"
          onPress={() => router.push('/membership' as never)}
        />
        <ChipButton
          tone="neutral"
          label="Not now"
          icon="close"
          onPress={() => {
            paymentDismissedThisSession = true;
            setDismissed(true);
          }}
        />
      </View>
    </View>
  );
}

// The weekly injury nudge, as a feed decision card: when a member's open
// injury hasn't been checked in on for a week, the inbox asks for an
// update. Clears itself once the check-in happens.
function InjuryCheckInCard() {
  const injuries = useMyInjuries();
  const due = dueCheckIns(injuries.data);
  if (due.length === 0) return null;
  return (
    <View className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-card p-4 gap-2">
      <View className="flex-row items-center gap-2">
        <Ionicons name="pulse" size={18} color="#D97706" />
        <Text
          className="flex-1 text-amber-700 dark:text-amber-300 font-semibold"
          numberOfLines={1}>
          {due.length === 1
            ? `How's your ${injuryTitle(due[0].body_region, due[0].side).toLowerCase()}?`
            : `${due.length} injuries need a check-in`}
        </Text>
      </View>
      <Text className="text-amber-700 dark:text-amber-300 text-sm">
        It's been a week since your last update — a quick check-in keeps
        your coaches in the loop.
      </Text>
      <ChipButton
        tone="amber"
        className="self-start"
        label="Check in now"
        icon="arrow-forward"
        iconSide="right"
        onPress={() => router.push('/track/injuries' as never)}
      />
    </View>
  );
}

// Nudge to log results after an attended class — mirrors the injury
// card. Routes to Track, where the post-class prompt opens the recorder
// pre-filled for that session.
function LogNudgeCard() {
  const nudge = useLogNudge();
  const items = nudge.data ?? [];
  if (items.length === 0) return null;
  return (
    <View className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-300 dark:border-emerald-700 rounded-card p-4 gap-2">
      <View className="flex-row items-center gap-2">
        <Ionicons name="checkmark-done-circle" size={18} color="#059669" />
        <Text
          className="flex-1 text-emerald-700 dark:text-emerald-300 font-semibold"
          numberOfLines={1}>
          {items.length === 1
            ? `Log your ${items[0].className} session`
            : `${items.length} sessions to log`}
        </Text>
      </View>
      <Text className="text-emerald-700 dark:text-emerald-300 text-sm">
        You were marked in — log your results to keep your streak and PRs up to
        date.
      </Text>
      <ChipButton
        tone="neutral"
        className="self-start"
        label="Log results"
        icon="arrow-forward"
        iconSide="right"
        onPress={() => router.push('/track' as never)}
      />
    </View>
  );
}

// Cover notifications (0165). Opening the chip marks them read — every
// one of them points at the same place, and that place is one tap away.
function CoverTab({ gymId }: { gymId: string }) {
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const marked = useRef(false);

  const rows = useQuery({
    queryKey: ['cover-notifications', gymId],
    queryFn: async (): Promise<CoverNotificationRow[]> => {
      const { data, error } = await supabase
        .from('cover_notifications')
        .select(
          'id, kind, request_id, offer_id, created_at, read_at, cover_requests(range_start, range_end, requested_start, requested_end, requester:profiles!requested_by(full_name))',
        )
        .eq('gym_id', gymId)
        .eq('channel', 'in_app')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as CoverNotificationRow[];
    },
  });

  useEffect(() => {
    if (marked.current || rows.data === undefined) return;
    marked.current = true;
    supabase
      .rpc('mark_cover_notifications_read', { p_gym_id: gymId })
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: ['unread-cover-notifications'],
        }),
      );
  }, [rows.data, gymId, queryClient]);

  const list = rows.data ?? [];

  return (
    <View className="gap-3">
      {rows.isLoading ? (
        <EmptyState kind="loading" rows={2} />
      ) : list.length === 0 ? (
        <Text className="text-ink-2 dark:text-ink-2-dk">
          Nothing yet. You'll hear here when a coach needs cover, or when
          someone picks up one of your classes.
        </Text>
      ) : (
        list.map((n) => {
          const req = n.cover_requests;
          const from = req?.requested_start ?? req?.range_start;
          const to = req?.requested_end ?? req?.range_end;
          const window =
            from && to
              ? formatDate(from) === formatDate(to)
                ? formatDate(from)
                : `${formatDate(from)} → ${formatDate(to)}`
              : '';
          const claimed = n.kind === 'cover_claimed';
          const uncovered = n.kind === 'cover_uncovered';
          const who = req?.requester?.full_name ?? 'A coach';
          return (
            <View
              key={n.id}
              className={`rounded-card p-4 gap-2 border ${
                uncovered
                  ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20'
                  : 'border-transparent bg-surface dark:bg-surface-dk border border-line dark:border-line-dk'
              }`}>
              <View className="flex-row items-center gap-2">
                <Ionicons
                  name={
                    uncovered
                      ? 'alert-circle'
                      : claimed
                        ? 'checkmark-circle'
                        : 'swap-horizontal-outline'
                  }
                  size={18}
                  color={uncovered ? '#D97706' : colors.primary}
                />
                <Text
                  className={`font-semibold flex-1 ${
                    uncovered
                      ? 'text-amber-800 dark:text-amber-200'
                      : 'text-ink dark:text-ink-dk'
                  }`}>
                  {uncovered
                    ? 'Classes still have no coach'
                    : claimed
                      ? 'One of your classes is covered'
                      : `${who} needs cover`}
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  {timeAgo(n.created_at)}
                </Text>
              </View>
              {uncovered ? (
                <Text className="text-amber-700 dark:text-amber-300 text-sm">
                  Cover {who} asked for is coming up and nobody has claimed
                  it.
                </Text>
              ) : null}
              {window ? (
                <Text
                  className={
                    uncovered
                      ? 'text-amber-700 dark:text-amber-300 text-sm'
                      : 'text-ink-2 dark:text-ink-2-dk text-sm'
                  }>
                  {window}
                </Text>
              ) : null}
              <View className="flex-row">
                <ChipButton
                  tone={uncovered ? 'amber' : 'primary'}
                  label={
                    uncovered
                      ? 'Sort out cover'
                      : claimed
                        ? 'View your requests'
                        : 'See what needs cover'
                  }
                  icon="open-outline"
                  onPress={() => router.push('/timeline' as never)}
                />
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

function AlertsTab({ gymId }: { gymId: string }) {
  const queryClient = useQueryClient();
  const [showAcked, setShowAcked] = useState(false);

  const alerts = useQuery({
    queryKey: ['staff-alerts', gymId, showAcked],
    queryFn: async (): Promise<StaffAlertRow[]> => {
      let q = supabase
        .from('staff_alerts')
        .select(
          'id, gym_id, kind, subject_profile_id, related_id, created_at, acknowledged_at, subject:profiles!subject_profile_id(full_name, avatar_url)',
        )
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false });
      if (!showAcked) q = q.is('acknowledged_at', null);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as StaffAlertRow[];
    },
  });

  const ack = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase.rpc('acknowledge_staff_alert', {
        p_alert_id: alertId,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['staff-alerts'] }),
  });

  const rows = alerts.data ?? [];

  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2">
        <Switch
          accessibilityLabel="Show acknowledged"
          value={showAcked}
          onValueChange={setShowAcked}
        />
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
          Show acknowledged
        </Text>
      </View>
      {alerts.isLoading ? (
        <EmptyState kind="loading" rows={2} />
      ) : rows.length === 0 ? (
        <Text className="text-ink-2 dark:text-ink-2-dk">
          {showAcked
            ? 'No alerts yet.'
            : 'No open alerts. Members with health flags will show up here.'}
        </Text>
      ) : (
        rows.map((a) => {
          const copy = ALERT_COPY[a.kind] ?? ALERT_COPY.parq_flag;
          const amber = a.kind === 'injury_update';
          return (
            <View
              key={a.id}
              className={`rounded-card p-4 gap-2 border ${
                a.acknowledged_at
                  ? 'border-line dark:border-line-dk bg-surface dark:bg-surface-dk'
                  : amber
                    ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20'
                    : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
              }`}>
              <View className="flex-row items-center gap-2">
                <Ionicons
                  name={copy.icon}
                  size={18}
                  color={amber ? '#D97706' : '#DC2626'}
                />
                <Text
                  className="text-ink dark:text-ink-dk font-semibold flex-1"
                  numberOfLines={1}>
                  {a.subject?.full_name ?? 'Member'} {copy.title}
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  {formatDate(a.created_at)}
                </Text>
              </View>
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                {copy.body}
              </Text>
              <View className="flex-row gap-2">
                {a.subject_profile_id ? (
                  <ChipButton
                    tone="neutral"
                    label="Open profile"
                    icon="person-outline"
                    onPress={() =>
                      router.push(
                        `/management/members/${a.subject_profile_id}` as never,
                      )
                    }
                  />
                ) : null}
                {!a.acknowledged_at ? (
                  <ChipButton
                    tone="filled"
                    label="Acknowledge"
                    icon="checkmark"
                    onPress={() => ack.mutate(a.id)}
                    disabled={ack.isPending}
                  />
                ) : (
                  <Text className="text-ink-2 dark:text-ink-2-dk text-xs self-center">
                    Acknowledged
                  </Text>
                )}
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}
