// Addresses the gym cannot reach.
//
// 0229 records a permanent bounce and holds the address back from
// campaigns; 0230 puts the fact on the member's record. This is the third
// place it has to be honoured: the transactional senders — class changes,
// cover, payment notices, automation sequences — which mail the same
// stored addresses over and over and were the reason a bounce cost a
// reputation in the first place.
//
// Not doing it was survivable and not free. Resend suppresses an address
// at the account level once it has hard bounced, so those sends came back
// refused rather than delivered; the cost was a failed row per notice and
// a queue that retried a dead address every time the gym changed a class.
// Checking here turns that into one recorded skip that says why.
//
// Keyed by gym as well as address on purpose. A suppression belongs to
// one gym: the same person can bounce for one gym and be perfectly
// reachable at another, and a shared platform must never let one gym's
// bad list silence another's mail.

type QueryClient = {
  from: (table: string) => {
    select: (columns: string) => {
      in: (
        column: string,
        values: string[],
      ) => Promise<{ data: unknown; error: unknown }>;
    };
  };
};

export const SUPPRESSED_REASON =
  'That address bounced or was marked as spam — held back from every send';

export type Suppressed = {
  has: (gymId: string, email: string | null | undefined) => boolean;
};

function key(gymId: string, email: string): string {
  // Newline, because it cannot appear in either half.
  return `${gymId}\n${email.trim().toLowerCase()}`;
}

export async function loadSuppressed(
  service: QueryClient,
  gymIds: string[],
): Promise<Suppressed> {
  const ids = [...new Set(gymIds.filter(Boolean))];
  if (ids.length === 0) return { has: () => false };

  const { data, error } = await service
    .from('email_suppressions')
    .select('gym_id, email')
    .in('gym_id', ids);

  // A failed lookup must not stop the queue. Sending to an address that
  // has bounced is a small harm; not sending a member the news that their
  // class is cancelled because a side table was briefly unreadable is a
  // bigger one.
  if (error || !data) return { has: () => false };

  const set = new Set(
    (data as { gym_id: string; email: string }[]).map((r) => key(r.gym_id, r.email)),
  );
  return {
    has: (gymId, email) => (email ? set.has(key(gymId, email)) : false),
  };
}
