// Illustrative-only estimate of what a gym might give up on a platform
// that marks up payment processing or takes a cut of bookings — used to
// make Temple's zero-take Stripe Connect model felt, not just documented.
// Every platform (Temple included) passes through the card network's own
// processing rate; what varies is whether the platform adds its own
// margin on top of that. The range here is deliberately wide and
// unattributed to any named competitor, since fee structures vary and
// change over time.
const LOW_MARKUP_RATE = 0.01;
const HIGH_MARKUP_RATE = 0.03;

export type ElsewhereEstimate = {
  lowCents: number;
  highCents: number;
};

export function estimateElsewhereMarkup(monthlyVolumeCents: number): ElsewhereEstimate {
  const clamped = Math.max(0, monthlyVolumeCents);
  return {
    lowCents: Math.round(clamped * LOW_MARKUP_RATE),
    highCents: Math.round(clamped * HIGH_MARKUP_RATE),
  };
}
