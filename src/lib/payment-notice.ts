import type { MembershipPlanKind, PlanSubState } from '@/types/database';

// What to tell a member whose card is failing. Three states, and the
// difference between them is what the member can still do:
//
//   retrying  — Stripe will try again; whether they can keep training
//               depends on the plan kind
//   stopped   — Stripe has given up, cancellation is next
//   cancelled — it already happened
//
// Paying an outstanding invoice reinstates the membership even after
// cancellation: stripe-webhook's invoice.paid branch sets status 'active'
// unconditionally. So a surviving Pay now link is the recovery path, not a
// stale button, and the cancelled copy says so.

export type PaymentNoticeInput = {
  planKind: MembershipPlanKind;
  status: PlanSubState;
  // Pre-formatted for the reader's locale by the caller, so this stays pure.
  nextAttemptLabel: string | null;
  lastError: string | null;
  hasInvoiceLink: boolean;
};

export type PaymentNoticeCopy = {
  title: string;
  body: string;
  action: 'pay' | 'plans' | 'ask-gym';
};

const TERMINAL: ReadonlySet<PlanSubState> = new Set<PlanSubState>([
  'cancelled',
  'lapsed',
]);

export function paymentNoticeCopy(input: PaymentNoticeInput): PaymentNoticeCopy {
  const { planKind, status, nextAttemptLabel, lastError, hasInvoiceLink } = input;
  const reason = lastError ? ` (${lastError})` : '';

  if (TERMINAL.has(status)) {
    return {
      title: 'Your membership was cancelled',
      body:
        "We tried your card and it kept being declined, so your membership has stopped." +
        (hasInvoiceLink
          ? ' Paying the outstanding amount puts it straight back.'
          : ' Pick a plan when you want to start again.') +
        reason,
      action: hasInvoiceLink ? 'pay' : 'plans',
    };
  }

  if (!nextAttemptLabel) {
    return {
      title: 'Your membership is about to stop',
      body:
        'We have tried your card and it keeps being declined. Your membership will be cancelled unless this is paid.' +
        reason,
      action: hasInvoiceLink ? 'pay' : 'ask-gym',
    };
  }

  // Three cases, not two. An unlimited member keeps booking. A member on a
  // renewing credit plan keeps whatever credits they already have — the
  // failure means the next batch has not ARRIVED, not that the balance is
  // zero — so "you cannot book" would be false for anyone with credits
  // left. And programming_only members do not book classes at all, so
  // neither sentence applies to them.
  const booking =
    planKind === 'unlimited'
      ? "Your classes aren't affected — you can keep booking."
      : planKind === 'programming_only'
        ? 'Your programming is not affected.'
        : "Any class credits you have left still work — but this month's haven't been added yet, so they won't top up until this is paid.";

  return {
    title: "We couldn't take your payment",
    body:
      `${booking} We'll try your card again on ${nextAttemptLabel}, and if it keeps failing your membership will be cancelled.` +
      reason,
    action: hasInvoiceLink ? 'pay' : 'ask-gym',
  };
}
