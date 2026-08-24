// The two client-side judgements about a plan switch, kept pure so the
// membership screen's confirm copy can be pinned by tests.
//
// switchDirection mirrors isUpgradeFor in stripe-modify-subscription:
// a strictly greater price is an upgrade (applied now, pro-rated),
// everything else — cheaper, equal, or unpriced on either side — is
// scheduled for a renewal. If the two ever disagree, the confirm row
// promises one thing and the server does the other.
//
// scheduledChangeEffective mirrors the apply-plan-changes worker's notice
// gate: a pending change lands at paid_period_end unless that renewal is
// still inside the notice window (paid_period_end < not_before), in which
// case it waits for the first renewal after the gate — a date the client
// cannot know (the webhook advances paid_period_end), so the copy says
// "after <gate>" rather than guessing one.

export type ScheduledChangeEffective =
  | { kind: 'on'; date: string }
  | { kind: 'after'; date: string }
  | { kind: 'unknown' };

export function switchDirection(
  currentPriceCents: number | null,
  targetPriceCents: number | null,
): 'upgrade' | 'scheduled' {
  return (targetPriceCents ?? 0) > (currentPriceCents ?? 0)
    ? 'upgrade'
    : 'scheduled';
}

export function scheduledChangeEffective(
  paidPeriodEnd: string | null,
  notBefore: string | null,
): ScheduledChangeEffective {
  if (!paidPeriodEnd) return { kind: 'unknown' };
  if (!notBefore || new Date(paidPeriodEnd) >= new Date(notBefore)) {
    return { kind: 'on', date: paidPeriodEnd };
  }
  return { kind: 'after', date: notBefore };
}
