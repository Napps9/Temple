// Display helpers shared by the inbox / thread / announcement UI.

export type DmInboxRow = {
  peer_profile_id: string;
  peer_full_name: string;
  peer_role: 'owner' | 'admin' | 'coach' | 'staff' | 'member' | null;
  last_message_id: string;
  last_message_body: string;
  last_message_at: string;
  last_message_from_me: boolean;
  unread_count: number;
};

export type DirectMessageRow = {
  id: string;
  gym_id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

export type AnnouncementRow = {
  id: string;
  gym_id: string;
  posted_by: string | null;
  title: string;
  body: string;
  pinned: boolean;
  pinned_from: string | null;
  pinned_until: string | null;
  created_at: string;
};

export type ClassBroadcastRow = {
  id: string;
  gym_id: string;
  class_session_id: string;
  sender_id: string | null;
  body: string;
  created_at: string;
};

// Friendly "time ago" for inbox rows. We deliberately keep this
// dependency-free so it stays unit-testable.
export function timeAgo(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  const seconds = Math.max(0, Math.floor((now.getTime() - t) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

// Truncate a snippet for the inbox list — first line only, cap length.
export function snippet(body: string, max = 80): string {
  const firstLine = body.replace(/\s*\n+\s*/g, ' ').trim();
  if (firstLine.length <= max) return firstLine;
  return firstLine.slice(0, max - 1).trimEnd() + '…';
}

// Group messages by day so the thread view can show date separators.
export function groupByDay(messages: DirectMessageRow[]): Array<{
  key: string;
  label: string;
  rows: DirectMessageRow[];
}> {
  const out: Array<{ key: string; label: string; rows: DirectMessageRow[] }> =
    [];
  for (const m of messages) {
    const d = new Date(m.created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let bucket = out.find((b) => b.key === key);
    if (!bucket) {
      bucket = {
        key,
        label: d.toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        }),
        rows: [],
      };
      out.push(bucket);
    }
    bucket.rows.push(m);
  }
  return out;
}
