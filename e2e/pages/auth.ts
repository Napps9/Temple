import { expect } from '@playwright/test';

import { BasePage } from './base';
import type { MemberAccount, OwnerAccount } from '../support/data';

// Logged-out landing: the three-card deck (member / owner / solo) plus a
// sign-in link.
export class GetStartedPage extends BasePage {
  async open() {
    await this.goto('/get-started');
    await expect(this.page.getByText('Welcome to Temple').first()).toBeVisible();
  }

  startGym() {
    // The owner card's CTA. Visible card only — the deck stacks others
    // behind it with pointerEvents off.
    return this.tap('Get set up');
  }

  signInLink() {
    return this.tap('Already have an account? Sign in');
  }
}

export class SignInPage extends BasePage {
  async open() {
    await this.goto('/sign-in');
    await expect(this.page.getByText('Welcome back').first()).toBeVisible();
  }

  async signIn(email: string, password: string) {
    await this.field('Email').fill(email);
    await this.field('Password').fill(password);
    await this.button('Sign in').click();
  }
}

// One screen that signs up the account, captures gym name + slug, then
// brand colours. The colour step ships valid defaults, so the happy path
// just confirms it.
export class CreateGymPage extends BasePage {
  async open() {
    await this.goto('/create-gym');
    await expect(this.page.getByText('Start a new gym').first()).toBeVisible();
  }

  /**
   * Drives account + gym + branding. Returns true if the gym was created
   * and we advanced past sign-up; false if the backend gated on email
   * confirmation (the "Check your email" wall), which the test must then
   * handle out-of-band.
   */
  async create(owner: OwnerAccount): Promise<boolean> {
    // Step 1 - account (only shown when signed out).
    if (await this.field('Your name').isVisible().catch(() => false)) {
      await this.field('Your name').fill(owner.name);
      await this.field('Email').fill(owner.email);
      await this.field('Password').fill(owner.password);
    }
    // Step 2 - gym details.
    await this.field('Gym name').fill(owner.gymName);
    await this.field('Slug (used in your join link)').fill(owner.slug);
    await this.button('Continue').click();

    // Either we hit the email-confirmation wall, or we reach the brand step.
    const emailWall = this.page.getByText('Check your email').first();
    const brandCta = this.button('Create gym');
    await expect(emailWall.or(brandCta)).toBeVisible();
    if (await emailWall.isVisible().catch(() => false)) return false;

    // Step 3 - branding (defaults are valid hex; just submit).
    await brandCta.click();
    return true;
  }
}

// Consent gate that every member (and owner) clears on first entry.
export class ConsentPage extends BasePage {
  isShown() {
    return this.page.getByText("Welcome — let's get you set up").first();
  }

  async complete(member: Pick<MemberAccount, 'name' | 'dob'>) {
    await expect(this.isShown()).toBeVisible();
    await this.field('Full name').fill(member.name);
    // DOB renders as a native <input type="date">; fill ISO directly.
    await this.page.locator('input.date-picker-input').fill(member.dob);
    // Tick all three consent clauses (the checkbox rows are pressable Text).
    const clauses = [
      'I consent to my gym storing and processing my health information',
      'I understand my coaches and gym admins can see this health information',
      'I understand my health data is erased when I leave the gym',
    ];
    for (const c of clauses) {
      await this.page.getByText(c, { exact: false }).first().click();
    }
    await this.button('Agree & continue').click();
  }
}

// Owner-only setup checklist shown after gym creation.
export class OnboardingPage extends BasePage {
  heading() {
    return this.page.getByText('Welcome to', { exact: false }).first();
  }

  step(title: string) {
    return this.tap(title);
  }

  skip() {
    return this.tap("Skip for now — I'll set this up later");
  }

  finish() {
    return this.button('Take me to my gym');
  }
}
