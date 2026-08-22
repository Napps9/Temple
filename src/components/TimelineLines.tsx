import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { AIMark } from './AIMark';
import { Text } from './Text';

import { renderIconSlot, type IconSlot } from './icon-slot';

import { useThemeColors } from '@/lib/theme';
import {
  formatClock,
  formatTimelineLine,
  storyHref,
  type TimelineEvent,
} from '@/lib/timeline';

// The Timeline's line grammar, shared by every page of it — today's
// stream, past-day threads, future-day threads. The pure modules
// (src/lib/timeline.ts, future-day.ts) stay RN-free, so the icon map and
// the row renderers live here rather than in the screen.

// What each kind of line is about, at a glance. The icon carries the
// category so the sentence doesn't have to be re-read to place it — a
// stream of near-identical grey lines was the complaint that bought
// these.
export const KIND_ICON: Record<TimelineEvent['kind'], IconSlot> = {
  member_joined: 'person-add-outline',
  lead_captured: 'chatbubble-ellipses-outline',
  payment_failing: 'card-outline',
  held_back: 'time-outline',
  cover_requested: 'swap-horizontal-outline',
  cover_claimed: 'swap-horizontal-outline',
  gym_closed: 'moon-outline',
  membership_request: 'help-circle-outline',
  campaign_sent: 'paper-plane-outline',
  // Temple itself acted — one mark for every job, because "Temple did
  // this" is the category; the sentence says which job.
  agent_action: <AIMark />,
};

export function ReceiptLine({ event }: { event: TimelineEvent }) {
  const line = formatTimelineLine(event);
  // Temple confirming its own work is the least newsworthy thing on the
  // screen — kept, but spoken more quietly than what members and coaches
  // did.
  const quiet =
    line.tone === 'neutral' &&
    (event.kind === 'agent_action' || event.kind === 'held_back');
  return (
    <SoftLine
      text={line.text}
      tone={line.tone}
      lead={line.lead}
      icon={KIND_ICON[event.kind]}
      quiet={quiet}
      at={event.occurred_at}
      href={storyHref(event) ?? undefined}
    />
  );
}

export function SoftLine({
  text,
  tone,
  lead,
  icon,
  quiet,
  at,
  offer,
  href,
}: {
  text: string;
  tone: 'neutral' | 'amber' | 'red';
  lead?: string;
  icon?: IconSlot;
  // Temple's own receipts step back so the people-lines step forward.
  quiet?: boolean;
  at?: string;
  offer?: { label: string; href: string };
  // A line with somewhere to open becomes the tap itself — the whole row,
  // not a chip, because the chevron is a promise about the row.
  href?: string;
}) {
  const colors = useThemeColors();
  // Urgency is a container, not just a dot: an amber or red line sits in
  // its own tinted card so a live problem cannot hide in a scroll of
  // quiet receipts.
  const urgent = tone !== 'neutral';
  const iconColor =
    tone === 'red'
      ? '#EF4444'
      : tone === 'amber'
        ? '#F59E0B'
        : quiet
          ? '#9CA3AF'
          : colors.ink2;
  const body = (
    <>
      {icon ? (
        <View
          className={`w-7 h-7 rounded-full items-center justify-center ${
            tone === 'red'
              ? 'bg-red-500/15'
              : tone === 'amber'
                ? 'bg-amber-500/15'
                : quiet
                  ? 'bg-transparent'
                  : 'bg-sunken/70 dark:bg-raised-dk'
          }`}>
          {renderIconSlot(icon, 14, iconColor)}
        </View>
      ) : (
        <View
          className={`w-2 h-2 rounded-full mt-[7px] ${
            tone === 'red'
              ? 'bg-red-500'
              : tone === 'amber'
                ? 'bg-amber-500'
                : 'bg-sunken dark:bg-sunken-dk'
          }`}
        />
      )}
      <Text
        className={`flex-1 text-[15px] leading-[22px] mt-[3px] ${
          quiet
            ? 'text-ink-2 dark:text-ink-2-dk'
            : 'text-ink-2 dark:text-ink-2-dk'
        }`}>
        {lead && text.startsWith(lead) ? (
          <>
            <Text className="font-semibold text-ink dark:text-ink-dk">
              {lead}
            </Text>
            {text.slice(lead.length)}
          </>
        ) : (
          text
        )}
      </Text>
      {at ? (
        <Text className="text-ink-3 dark:text-ink-3-dk text-xs mt-[6px]">
          {formatClock(at)}
        </Text>
      ) : null}
      {href ? (
        <Ionicons
          name="chevron-forward"
          size={15}
          color={colors.ink2}
          style={{ marginTop: 7 }}
        />
      ) : null}
    </>
  );
  const rowClass = urgent
    ? `flex-row items-start gap-3 px-3 py-2.5 rounded-xl border ${
        tone === 'red'
          ? 'bg-red-500/10 border-red-500/20'
          : 'bg-amber-500/10 border-amber-500/20'
      }`
    : 'flex-row items-start gap-3 px-1';
  return (
    <View className="gap-2">
      {href ? (
        <Pressable
          onPress={() => router.push(href as never)}
          accessibilityRole="link"
          className={`${rowClass} active:opacity-60`}>
          {body}
        </Pressable>
      ) : (
        <View className={rowClass}>{body}</View>
      )}
      {offer ? (
        <View className="flex-row pl-10">
          <OfferChip offer={offer} />
        </View>
      ) : null}
    </View>
  );
}

// The way through, offered rather than taken. An action never navigates on
// the owner's behalf — that empties the conversation they were in the
// middle of, which is the thing this surface exists to stop — so it names
// a screen and this is the tap that goes there.
export function OfferChip({ offer }: { offer: { label: string; href: string } }) {
  return (
    <Pressable
      onPress={() => router.push(offer.href as never)}
      className="px-4 py-2 rounded-full border border-line dark:border-line-dk bg-surface dark:bg-surface-dk active:opacity-70">
      <Text className="text-ink-2 dark:text-ink-2-dk text-[13px] font-semibold">
        {offer.label}
      </Text>
    </Pressable>
  );
}
