import { describe, expect, it } from 'vitest';

import { paymentNoticeCopy } from './payment-notice';

const base = {
  planKind: 'unlimited' as const,
  status: 'active' as const,
  nextAttemptLabel: '3 Aug',
  lastError: null,
  hasInvoiceLink: true,
};

describe('paymentNoticeCopy', () => {
  it('tells an unlimited member their classes are safe', () => {
    const c = paymentNoticeCopy(base);
    expect(c.title).toBe("We couldn't take your payment");
    expect(c.body).toContain("classes aren't affected");
    expect(c.body).toContain('3 Aug');
    expect(c.action).toBe('pay');
  });

  // The bug this whole split exists for: booking needs credit_balance > 0
  // and credits only arrive with invoice.paid, so "keep booking" would send
  // a credit member to a screen that refuses every class.
  it('tells a credit member they cannot book until it is paid', () => {
    const c = paymentNoticeCopy({ ...base, planKind: 'credit_period' });
    expect(c.body).toContain("can't book until this is paid");
    expect(c.body).not.toContain("aren't affected");
  });

  it('escalates when Stripe has stopped retrying', () => {
    const c = paymentNoticeCopy({ ...base, nextAttemptLabel: null });
    expect(c.title).toBe('Your membership is about to stop');
    expect(c.body).toContain('will be cancelled unless');
  });

  it('switches to past tense once the membership is gone', () => {
    const c = paymentNoticeCopy({
      ...base,
      status: 'cancelled',
      nextAttemptLabel: null,
    });
    expect(c.title).toBe('Your membership was cancelled');
    expect(c.body).toContain('has stopped');
  });

  // invoice.paid sets status 'active' unconditionally, so paying after
  // cancellation really does reinstate — the link is worth keeping.
  it('offers to reinstate a cancelled membership when the invoice survives', () => {
    const c = paymentNoticeCopy({ ...base, status: 'cancelled' });
    expect(c.body).toContain('puts it straight back');
    expect(c.action).toBe('pay');
  });

  it('points a cancelled member at plans when there is nothing left to pay', () => {
    const c = paymentNoticeCopy({
      ...base,
      status: 'lapsed',
      hasInvoiceLink: false,
    });
    expect(c.body).toContain('Pick a plan');
    expect(c.action).toBe('plans');
  });

  it('falls back to the gym when a live failure has no pay link', () => {
    const c = paymentNoticeCopy({ ...base, hasInvoiceLink: false });
    expect(c.action).toBe('ask-gym');
  });

  it("carries Stripe's decline reason when there is one", () => {
    const c = paymentNoticeCopy({ ...base, lastError: 'Insufficient funds' });
    expect(c.body).toContain('(Insufficient funds)');
  });
});
