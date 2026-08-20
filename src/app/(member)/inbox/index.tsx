import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { Text } from '@/components/Text';

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership, useRole, useSession } from '@/lib/auth';
import { formatDate } from '@/lib/format-date';
import { errorMessage } from '@/lib/errors';
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

type Tab = 'direct' | 'announcements' | 'classes' | 'alerts' | 'cover';

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

export default function Inbox() {
  const [tab, setTab] = useState<Tab>('direct');
  const session = useSession();
  const { data: membership } = useGymMembership();
  const role = useRole();
  const canPostAnnouncements = useCan('can_post_announcements');
  const canBroadcast = useCan('can_broadcast_to_class');
  const canSeeHealthFlag = useCan('can_see_health_flag') ?? false;
  const canRequestCover = useCan('can_request_cover') ?? false;
  const canClaimCover = useCan('can_claim_cover') ?? false;
  const canCover = canRequestCover || canClaimCover;
  const unreadCover = useUnreadCoverNotifications();
  const queryClient = useQueryClient();

  const unread = useQuery({
    queryKey: ['inbox-unread-summary', session?.user.id],
    enabled: !!session?.user.id,
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

  // The Classes tab holds both broadcasts and closure/reschedule notices.
  const classesUnread =
    (unread.data?.class_broadcast_unread ?? 0) +
    (unread.data?.class_change_unread ?? 0);

  function refreshUnread() {
    queryClient.invalidateQueries({ queryKey: ['inbox-unread-summary'] });
  }

  if (!session || !membership) return null;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-1">
          <Text className="text-ink dark:text-ink-dk text-2xl font-semibold">
            Inbox
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk">
            Messages from coaches and the gym.
          </Text>
        </View>

        <PaymentNoticeBanner
          gymId={membership.gymId}
          profileId={session.user.id}
        />
        <InjuryCheckInBanner />
        <LogNudgeBanner />

        <View className="flex-row gap-2 flex-wrap">
          <TabChip
            label={`Direct${
              (unread.data?.dm_unread ?? 0) > 0
                ? ` · ${unread.data!.dm_unread}`
                : ''
            }`}
            active={tab === 'direct'}
            onPress={() => setTab('direct')}
          />
          <TabChip
            label={`Announcements${
              (unread.data?.announcement_unread ?? 0) > 0
                ? ` · ${unread.data!.announcement_unread}`
                : ''
            }`}
            active={tab === 'announcements'}
            onPress={() => setTab('announcements')}
          />
          <TabChip
            label={`Classes${
              classesUnread > 0 ? ` · ${classesUnread}` : ''
            }`}
            active={tab === 'classes'}
            onPress={() => setTab('classes')}
          />
          {canSeeHealthFlag ? (
            <TabChip
              label="Alerts"
              active={tab === 'alerts'}
              onPress={() => setTab('alerts')}
            />
          ) : null}
          {canCover ? (
            <TabChip
              label={`Cover${
                (unreadCover.data ?? 0) > 0 ? ` · ${unreadCover.data}` : ''
              }`}
              active={tab === 'cover'}
              onPress={() => setTab('cover')}
            />
          ) : null}
        </View>

        {tab === 'direct' ? (
          <DirectList />
        ) : tab === 'announcements' ? (
          <AnnouncementsTab
            canPost={canPostAnnouncements === true}
            gymId={membership.gymId}
            posterId={session.user.id}
            onChange={refreshUnread}
          />
        ) : tab === 'classes' ? (
          <ClassesTab
            canBroadcast={canBroadcast === true}
            gymId={membership.gymId}
            profileId={session.user.id}
            role={role}
            onChange={refreshUnread}
          />
        ) : tab === 'cover' ? (
          <CoverTab gymId={membership.gymId} />
        ) : (
          <AlertsTab gymId={membership.gymId} />
        )}
      </ScrollView>
    </Screen>
  );
}

function TabChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-3 py-1 rounded-full border ${
        active
          ? 'border-primary bg-primary/10'
          : 'border-line dark:border-line-dk bg-surface dark:bg-surface-dk'
      }`}>
      <Text
        className={
          active
            ? 'text-primary text-sm'
            : 'text-ink-2 dark:text-ink-2-dk text-sm'
        }>
        {label}
      </Text>
    </Pressable>
  );
}

function DirectList() {
  const session = useSession();
  const inbox = useQuery({
    queryKey: ['dm-inbox', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<DmInboxRow[]> => {
      const { data, error } = await supabase.rpc('dm_inbox');
      if (error) throw error;
      return (data ?? []) as DmInboxRow[];
    },
  });

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
          Direct messages
        </Text>
        <Pressable
          onPress={() => router.push('/inbox/direct/new' as never)}
          className="flex-row items-center gap-1 bg-primary active:bg-primary-dark rounded-full px-3 py-1.5">
          <Ionicons name="add" size={14} color="#FFFFFF" />
          <Text className="text-white text-xs font-semibold">New</Text>
        </Pressable>
      </View>

      {inbox.isLoading ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm">Loading…</Text>
      ) : (inbox.data?.length ?? 0) === 0 ? (
        <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 shadow-card">
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
            No conversations yet. Tap New to send a message.
          </Text>
        </View>
      ) : (
        inbox.data!.map((row) => (
          <Pressable
            key={row.peer_profile_id}
            onPress={() =>
              router.push(`/inbox/direct/${row.peer_profile_id}` as never)
            }
            className="bg-surface dark:bg-surface-dk rounded-xl p-4 shadow-card active:opacity-70 flex-row items-center gap-3">
            <View className="flex-1">
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 text-ink dark:text-ink-dk font-semibold" numberOfLines={1}>
                  {row.peer_full_name}
                </Text>
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
              </View>
              <Text
                className="text-ink-2 dark:text-ink-2-dk text-sm"
                numberOfLines={1}>
                {row.last_message_from_me ? 'You: ' : ''}
                {snippet(row.last_message_body, 60)}
              </Text>
            </View>
            {row.unread_count > 0 ? (
              <View className="bg-primary rounded-full min-w-5 h-5 px-1.5 items-center justify-center">
                <Text className="text-white text-xs font-semibold">
                  {row.unread_count}
                </Text>
              </View>
            ) : null}
          </Pressable>
        ))
      )}
    </View>
  );
}

function AnnouncementsTab({
  canPost,
  gymId,
  posterId,
  onChange,
}: {
  canPost: boolean;
  gymId: string;
  posterId: string;
  onChange: () => void;
}) {
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const [composeOpen, setComposeOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['gym-announcements', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<AnnouncementRow[]> => {
      const { data, error: err } = await supabase
        .from('gym_announcements')
        .select('id, gym_id, posted_by, title, body, pinned, created_at')
        .eq('gym_id', gymId)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false });
      if (err) throw err;
      return (data ?? []) as AnnouncementRow[];
    },
  });

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
      setComposeOpen(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['gym-announcements'] });
      onChange();
    },
    onError: (e) => setError(errorMessage(e, 'Could not post')),
  });

  // Mark all unread announcements visible on the page as read.
  const markAllRead = useMutation({
    mutationFn: async () => {
      const ids = (list.data ?? []).map((a) => a.id);
      if (ids.length === 0) return;
      const rows = ids.map((id) => ({
        announcement_id: id,
        profile_id: posterId,
      }));
      // Upsert ignoring conflicts so re-marking is cheap.
      const { error: err } = await supabase
        .from('announcement_reads')
        .upsert(rows, { onConflict: 'announcement_id,profile_id' });
      if (err) throw err;
    },
    onSuccess: onChange,
  });

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
          Gym announcements
        </Text>
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            className="rounded-full border border-line dark:border-line-dk px-3 py-1.5 active:opacity-70">
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              Mark all read
            </Text>
          </Pressable>
          {canPost ? (
            <Pressable
              onPress={() => setComposeOpen((v) => !v)}
              className="flex-row items-center gap-1 bg-primary rounded-full px-3 py-1.5 active:opacity-70">
              <Ionicons
                name={composeOpen ? 'close' : 'add'}
                size={14}
                color="#FFFFFF"
              />
              <Text className="text-white text-xs font-semibold">
                {composeOpen ? 'Close' : 'Post'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {composeOpen ? (
        <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-3 shadow-card">
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
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              Pin to top
            </Text>
          </View>
          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text>
          ) : null}
          <Button onPress={() => post.mutate()} loading={post.isPending}>
            Post announcement
          </Button>
        </View>
      ) : null}

      {list.isLoading ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm">Loading…</Text>
      ) : (list.data?.length ?? 0) === 0 ? (
        <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 shadow-card">
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
            No announcements yet.
          </Text>
        </View>
      ) : (
        list.data!.map((a) => (
          <View
            key={a.id}
            className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-2 shadow-card">
            <View className="flex-row items-center gap-2">
              {a.pinned ? (
                <Ionicons name="pin" size={14} color={colors.primary} />
              ) : null}
              <Text className="flex-1 text-ink dark:text-ink-dk font-semibold" numberOfLines={1}>
                {a.title}
              </Text>
              <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                {timeAgo(a.created_at)}
              </Text>
            </View>
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              {a.body}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

type ClassChangeRow = {
  id: string;
  kind:
    | 'gym_closed'
    | 'classes_rescheduled'
    | 'classes_reopened'
    | 'class_cancelled'
    | 'class_coach_changed';
  body: string;
  created_at: string;
  read_at: string | null;
};

// Closures and bulk reschedules (0169). Opening the tab marks them read —
// they carry their whole message in `body` (the classes they describe have
// been deleted), so there is nothing further to open.
// One label per kind. It was a two-branch ternary that fell through to
// "Class times changed" for anything it did not know — which is how a
// cancelled class (0212) has been announcing itself as a time change ever
// since, and what a coach change would have done next.
const NOTICE_TITLE: Record<string, string> = {
  gym_closed: 'Gym closed',
  classes_reopened: 'Classes are back on',
  classes_rescheduled: 'Class times changed',
  class_cancelled: 'Class cancelled',
  class_coach_changed: 'Different coach',
};

function ClassChangeNotices({
  gymId,
  onChange,
}: {
  gymId: string;
  onChange: () => void;
}) {
  const queryClient = useQueryClient();
  const marked = useRef(false);

  const rows = useQuery({
    queryKey: ['class-change-notifications', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<ClassChangeRow[]> => {
      const { data, error } = await supabase
        .from('class_change_notifications')
        .select('id, kind, body, created_at, read_at')
        .eq('gym_id', gymId)
        .eq('channel', 'in_app')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as ClassChangeRow[];
    },
  });

  useEffect(() => {
    if (marked.current || rows.data === undefined) return;
    if (!rows.data.some((r) => r.read_at === null)) return;
    marked.current = true;
    supabase
      .rpc('mark_class_change_notifications_read', { p_gym_id: gymId })
      .then(() => onChange());
  }, [rows.data, gymId, onChange, queryClient]);

  const list = rows.data ?? [];
  if (list.length === 0) return null;

  return (
    <View className="gap-2">
      {list.map((n) => (
        <View
          key={n.id}
          className="rounded-xl p-4 gap-1 border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
          <View className="flex-row items-center gap-2">
            <Ionicons name="alert-circle" size={18} color="#D97706" />
            <Text className="text-amber-800 dark:text-amber-200 font-semibold flex-1">
              {NOTICE_TITLE[n.kind] ?? 'Class times changed'}
            </Text>
          </View>
          <Text className="text-amber-900 dark:text-amber-100 text-sm">
            {n.body}
          </Text>
          <Text className="text-amber-700/70 dark:text-amber-300/70 text-xs">
            {formatDate(n.created_at)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ClassesTab({
  canBroadcast,
  gymId,
  profileId,
  role,
  onChange,
}: {
  canBroadcast: boolean;
  gymId: string;
  profileId: string;
  role: ReturnType<typeof useRole>;
  onChange: () => void;
}) {
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['class-session-broadcasts', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<ClassBroadcastWithSession[]> => {
      const { data, error: err } = await supabase
        .from('class_session_broadcasts')
        .select(
          'id, gym_id, class_session_id, sender_id, body, created_at, class_sessions(id, starts_at, duration_minutes, class_types(name, color))',
        )
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false });
      if (err) throw err;
      return (data ?? []) as unknown as ClassBroadcastWithSession[];
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const ids = (list.data ?? []).map((b) => b.id);
      if (ids.length === 0) return;
      const rows = ids.map((id) => ({
        broadcast_id: id,
        profile_id: profileId,
      }));
      const { error: err } = await supabase
        .from('class_session_broadcast_reads')
        .upsert(rows, { onConflict: 'broadcast_id,profile_id' });
      if (err) throw err;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['class-session-broadcasts'] });
      onChange();
    },
  });

  return (
    <View className="gap-3">
      <ClassChangeNotices gymId={gymId} onChange={onChange} />

      <View className="flex-row items-center justify-between">
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
          Class messages
        </Text>
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => markAllRead.mutate()}
            className="rounded-full border border-line dark:border-line-dk px-3 py-1.5 active:opacity-70">
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              Mark all read
            </Text>
          </Pressable>
          {canBroadcast ? (
            <Pressable
              onPress={() =>
                router.push('/inbox/broadcast/new' as never)
              }
              className="flex-row items-center gap-1 bg-primary rounded-full px-3 py-1.5 active:opacity-70">
              <Ionicons name="megaphone-outline" size={14} color="#FFFFFF" />
              <Text className="text-white text-xs font-semibold">Broadcast</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {list.isLoading ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm">Loading…</Text>
      ) : (list.data?.length ?? 0) === 0 ? (
        <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 shadow-card">
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
            {role === 'member'
              ? 'No class messages yet. You\'ll see anything your coach sends to a class you\'re booked into.'
              : 'No class messages yet. Tap Broadcast to send one.'}
          </Text>
        </View>
      ) : (
        list.data!.map((b) => {
          const sess = b.class_sessions;
          const start = sess ? new Date(sess.starts_at) : null;
          const typeColor = sess?.class_types?.color ?? colors.primary;
          const typeName = sess?.class_types?.name ?? 'Class';
          return (
            <View
              key={b.id}
              className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-2 shadow-card">
              <View className="flex-row items-center gap-2">
                <View
                  style={{ backgroundColor: typeColor }}
                  className="rounded-full px-2 py-0.5">
                  <Text className="text-white text-[10px] font-semibold">
                    {typeName}
                  </Text>
                </View>
                {start ? (
                  <Text className="flex-1 text-ink-2 dark:text-ink-2-dk text-xs">
                    {start.toLocaleDateString(undefined, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}{' '}
                    ·{' '}
                    {`${start.getHours().toString().padStart(2, '0')}:${start
                      .getMinutes()
                      .toString()
                      .padStart(2, '0')}`}
                  </Text>
                ) : null}
                <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                  {timeAgo(b.created_at)}
                </Text>
              </View>
              <Text className="text-ink dark:text-ink-dk text-sm">
                {b.body}
              </Text>
            </View>
          );
        })
      )}
    </View>
  );
}

// The weekly injury nudge: when a member's open injury hasn't been
// checked in on for a week, the inbox asks for an update.
// A failing payment is the one inbox item that costs the member their
// membership if ignored, so it sits above the tabs as a banner rather than
// inside one — the same treatment as an overdue injury check-in.
// Shown for as long as the payment is ACTUALLY failing, not for as long as
// the notice is unread. Reading it once on day 1 used to silence Temple for
// the rest of the fortnight, because one-notice-per-run collapses Stripe's
// remaining retries onto that same already-read row.
//
// The badge stays read-based on purpose (payment_unread in
// inbox_unread_summary): the badge means "something new", this banner means
// "something ongoing". Tying them together would either nag forever or go
// quiet mid-run.
function PaymentNoticeBanner({
  gymId,
  profileId,
}: {
  gymId: string;
  profileId: string;
}) {
  // Presence of a dunning row IS past-due (0176), and recovery deletes it,
  // so the banner clears itself without needing to be told.
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
      //
      // Read or unread — the stored in-app body is deliberately dateless
      // (0176), so it is still true when re-read a week into the run.
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
  if (!(failing.data ?? 0) || !notice) return null;

  return (
    <Pressable
      onPress={() => router.push('/membership' as never)}
      className="bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-xl p-4 gap-2 active:opacity-80">
      <View className="flex-row items-center gap-2">
        <Ionicons name="card-outline" size={18} color="#DC2626" />
        <Text
          className="flex-1 text-red-800 dark:text-red-200 font-semibold"
          numberOfLines={1}>
          {notice.kind === 'payment_final_notice'
            ? 'Your membership is about to stop'
            : "We couldn't take your payment"}
        </Text>
        <Ionicons name="chevron-forward" size={16} color="#DC2626" />
      </View>
      <Text className="text-red-900 dark:text-red-100 text-sm">{notice.body}</Text>
    </Pressable>
  );
}

function InjuryCheckInBanner() {
  const injuries = useMyInjuries();
  const due = dueCheckIns(injuries.data);
  if (due.length === 0) return null;
  return (
    <View className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl p-4 gap-2">
      <View className="flex-row items-center gap-2">
        <Ionicons name="pulse" size={18} color="#D97706" />
        <Text className="flex-1 text-amber-700 dark:text-amber-300 font-semibold" numberOfLines={1}>
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
// banner. Routes to Track, where the post-class prompt opens the
// recorder pre-filled for that session.
function LogNudgeBanner() {
  const nudge = useLogNudge();
  const items = nudge.data ?? [];
  if (items.length === 0) return null;
  return (
    <View className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-300 dark:border-emerald-700 rounded-xl p-4 gap-2">
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

// Cover notifications (0165). Opening the tab marks them read — every
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
        <Text className="text-ink-2 dark:text-ink-2-dk">Loading…</Text>
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
              className={`rounded-xl p-4 gap-2 border ${
                uncovered
                  ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20'
                  : 'border-transparent bg-surface dark:bg-surface-dk shadow-card'
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
        <Text className="text-ink-2 dark:text-ink-2-dk">Loading…</Text>
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
            className={`rounded-xl p-4 gap-2 border ${
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
              <Text className="text-ink dark:text-ink-dk font-semibold flex-1" numberOfLines={1}>
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
