import { expect } from '@playwright/test';

import { BasePage } from './base';
import type { MemberAccount, OwnerAccount } from '../support/data';

// Public self-signup against a gym's slug. Requires the gym to have
// public signup enabled.
export class JoinPage extends BasePage {
  async open(slug: string) {
    await this.goto(`/join/${slug}`);
    await expect(this.page.getByText("You're joining").first()).toBeVisible();
  }

  /** True iff the gym has public signup off (the disabled-state message). */
  async isDisabled(): Promise<boolean> {
    return this.page
      .getByText('Public signup is disabled', { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
  }

  /**
   * Signs up a brand-new member against the slug. Returns false if the
   * backend gated on email confirmation.
   */
  async signUp(member: MemberAccount, owner: OwnerAccount): Promise<boolean> {
    await this.field('Your name').fill(member.name);
    await this.field('Email').fill(member.email);
    await this.field('Password').fill(member.password);
    await this.button(`Sign up and join ${owner.gymName}`).click();

    const emailWall = this.page
      .getByText('We sent a confirmation link', { exact: false })
      .first();
    // On success we leave /join for the consent gate or the app.
    const consent = this.page
      .getByText("Welcome — let's get you set up")
      .first();
    await expect(emailWall.or(consent)).toBeVisible({ timeout: 30_000 });
    return !(await emailWall.isVisible().catch(() => false));
  }
}

// Code-based onboarding (staff or member invite codes).
export class AcceptInvitePage extends BasePage {
  async open(code?: string) {
    await this.goto(code ? `/accept-invite?code=${code}` : '/accept-invite');
    await expect(this.page.getByText('Join your gym').first()).toBeVisible();
  }

  async accept(code: string, member: MemberAccount): Promise<boolean> {
    await this.field('Invite code').fill(code);
    await this.field('Full name').fill(member.name);
    await this.field('Email').fill(member.email);
    await this.field('Password').fill(member.password);
    await this.button('Create account').click();

    const emailWall = this.page
      .getByText('We sent a confirmation link', { exact: false })
      .first();
    const consent = this.page
      .getByText("Welcome — let's get you set up")
      .first();
    await expect(emailWall.or(consent)).toBeVisible({ timeout: 30_000 });
    return !(await emailWall.isVisible().catch(() => false));
  }
}
