import { expect } from '@playwright/test';

import { BasePage } from './base';

// Persistent top nav. Pills are bare Pressables carrying their label text.
export class Nav extends BasePage {
  staffPill(label: 'Programming' | 'Classes' | 'Manage') {
    return this.tap(label);
  }

  memberPill(label: 'Book' | 'Programming' | 'Track') {
    return this.tap(label);
  }
}

export class ClassTypesPage extends BasePage {
  async open() {
    await this.goto('/management/class-types');
    await expect(this.page.getByText('Class types').first()).toBeVisible();
  }

  /**
   * Adds a class type named `name` with a recurring schedule on every day
   * (so a bookable session always materialises within the horizon), then
   * saves. Defaults from EMPTY_RECURRENCE (06:00, 60 min, 12 cap,
   * indefinite) are left as-is.
   */
  async addWithDailySchedule(name: string) {
    const firstCta = this.button('Create your first type');
    if (await firstCta.isVisible().catch(() => false)) {
      await firstCta.click();
    } else {
      await this.button('Add type').click();
    }

    // The new row's name field is the only one with the "CrossFit"
    // placeholder.
    await this.byPlaceholder('CrossFit').last().fill(name);

    // Reveal the recurrence editor and select all seven days.
    await this.tap('Set up').click();
    await expect(this.page.getByText('Days', { exact: true }).last()).toBeVisible();
    const daysRow = this.page
      .getByText('Days', { exact: true })
      .last()
      .locator('xpath=following-sibling::*[1]');
    const dayCells = daysRow.locator('> div');
    const count = await dayCells.count();
    for (let i = 0; i < count; i += 1) {
      await dayCells.nth(i).click();
    }

    await this.button('Save changes').click();
    await expect(this.page.getByText('Could not', { exact: false })).toHaveCount(0);
  }
}

export class PlansPage extends BasePage {
  async open() {
    await this.goto('/management/plans');
    await expect(this.page.getByText('Plans').first()).toBeVisible();
  }

  /** Creates a simple Unlimited plan at the given monthly price. */
  async addUnlimited(name: string, monthlyPriceGbp: string) {
    const firstCta = this.button('Create your first plan');
    if (await firstCta.isVisible().catch(() => false)) {
      await firstCta.click();
    } else {
      await this.button('Add plan').click();
    }
    await this.field('Name').last().fill(name);
    // "unlimited" is the default kind; coverage defaults to All classes.
    await this.field('Monthly price (£)').last().fill(monthlyPriceGbp);
    await this.button('Save changes').click();
  }
}

export class BrandingPage extends BasePage {
  async open() {
    await this.goto('/management/branding');
  }

  // Public signup defaults ON for a new gym, so this is rarely needed. The
  // page renders two RN <Switch>es (signup, lead capture) as role="switch".
  publicSignupSwitch() {
    return this.page.getByRole('switch').first();
  }

  save() {
    return this.button('Save');
  }
}
