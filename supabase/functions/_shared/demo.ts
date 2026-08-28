// The door a demo gym's work does not leave by.
//
// Every external effect Temple can cause is a raw fetch to one of eight
// vendor hosts — Resend, Stripe, Twilio, Vapi, Anthropic, ElevenLabs, and
// the two Stripe Connect origins. There is no SDK and there was no shared
// wrapper: twenty-five of the forty-two functions import nothing from
// _shared at all, including every Stripe money-mover. So this is a new
// import in most of the places that call it, not a hook into something
// that already existed. That is the honest cost of the only chokepoint
// that actually sits in the path.
//
// WHAT IS BLOCKED, AND WHY THAT LINE.
//
// Blocked: anything a third party observes, or that moves money. Email,
// SMS, phone calls, buying a phone number, creating a voice assistant,
// every Stripe write. A visitor exploring a demo gym must not be able to
// put a message in a stranger's inbox or a charge on a card.
//
// Allowed: Anthropic and ElevenLabs. They cost tokens, but nobody outside
// Temple observes them, and they are the demo — the AI front desk
// answering, the setup parser reading a timetable, Explain-this explaining.
// Silencing them to make the demo "safe" would make it not worth showing.
// This is a decision, not an oversight; src/lib/edge-egress.test.ts holds
// the whole inventory and will fail if a new vendor call appears that is
// neither guarded nor listed here with a reason.
//
// Also allowed, separately: security-alert. It mails Temple, not the gym's
// members. It is our alarm, and a demo gym tripping it is exactly when we
// want to hear about it.
//
// WHAT A BLOCKED CALL DOES INSTEAD. It does not fail and it does not
// vanish. The senders already had this: `const live = Boolean(RESEND_API_KEY
// && fromAddress)` and, when false, the recipient row is written
// 'simulated' — a first-class status since 0044, counted and rendered in
// the campaign report. A demo gym is simply another reason for `live` to be
// false, so the campaign still reports what it did, the timeline still
// records it, and the visitor sees the product work.

// deno-lint-ignore no-explicit-any
type ServiceClient = any;

// Written into the `error` / reason columns the send tables already carry,
// so a held-back row says why rather than looking like a failure.
export const DEMO_HELD_BACK =
  'Held back: this is a demo gym, so nothing is sent outside Temple';

// For the Stripe paths, which have no simulated concept. Both checkout
// functions already return this shape with a 409 when a gym has not
// connected Stripe (stripe-checkout, store-checkout), so the client renders
// it today without changes.
export const DEMO_NO_MONEY =
  'This is a demo gym — Temple will not move real money on its behalf';

/**
 * Is this gym a demo tenant?
 *
 * For a function that already reads its gym row, select `is_demo` there and
 * skip this — one query is better than two. This exists for the functions
 * that hold a gym id and nothing else.
 *
 * Fails closed on error. A lookup that cannot answer must not be read as
 * "it is fine to send": the cost of holding back a real gym's mail for one
 * invocation is a retry, and the cost of the other mistake is a stranger's
 * inbox.
 */
export async function gymIsDemo(
  service: ServiceClient,
  gymId: string | null | undefined,
): Promise<boolean> {
  if (!gymId) return true;
  const { data, error } = await service
    .from('gyms')
    .select('is_demo')
    .eq('id', gymId)
    .maybeSingle();
  if (error || !data) return true;
  return data.is_demo === true;
}

// A phone number that can never belong to anybody. 07700 900000-900999 is
// reserved by Ofcom for drama and never allocated; +1 555-0100..0199 is the
// North American equivalent. A demo gym "buying" a number gets one of
// these, so the screen fills in and no real handset is ever involved.
export function demoPhoneNumber(seed: string): string {
  return `+4477009${String(hash(seed) % 1000).padStart(5, '0')}`;
}

// A stable stand-in for a vendor's object id, so a caller that stores what
// it got back stores something recognisable rather than an empty string.
// Prefixed `demo_` on purpose: anything that ends up in a log or a support
// question says what it is on sight.
export function demoVendorId(prefix: string, seed: string): string {
  return `demo_${prefix}_${hash(seed).toString(36)}`;
}

// FNV-1a. Deterministic so a retried invocation produces the same id, which
// is what the Idempotency-Key headers around these calls already assume.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
