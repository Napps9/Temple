import { expect } from '@playwright/test';

import { BasePage } from './base';

// Member booking calendar + the class detail modal it opens.
export class BookPage extends BasePage {
  async open() {
    await this.goto('/book');
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }

  view(which: 'day' | 'week' | 'month') {
    return this.tap(which);
  }

  today() {
    return this.tap('Today');
  }

  /** Opens the class detail modal by tapping a session card for `name`. */
  async openClass(name: string) {
    await this.view('week').click().catch(() => {});
    const card = this.page.getByText(name, { exact: false }).first();
    await expect(card).toBeVisible();
    await card.click();
  }

  /**
   * Books the currently open class. Returns the terminal state so the spec
   * can assert or skip when the only materialised session is outside its
   * booking window.
   */
  async book(): Promise<'booked' | 'closed' | 'not-open' | 'needs-membership'> {
    const bookBtn = this.button('Book this class');
    const closed = this.button('Booking closed');
    const notOpen = this.button('Booking not yet open');
    const needsMembership = this.page
      .getByText('Membership required', { exact: false })
      .first();

    await expect(
      bookBtn.or(closed).or(notOpen).or(needsMembership),
    ).toBeVisible();

    if (await closed.isVisible().catch(() => false)) return 'closed';
    if (await notOpen.isVisible().catch(() => false)) return 'not-open';
    if (await needsMembership.isVisible().catch(() => false)) {
      return 'needs-membership';
    }

    await bookBtn.click();
    // Single-entitlement confirm; multi-entitlement shows the same
    // "Yes, book" after a radio pick (default pre-selected, so just confirm).
    await this.button('Yes, book').click();
    await expect(this.button('Cancel booking')).toBeVisible();
    return 'booked';
  }
}
