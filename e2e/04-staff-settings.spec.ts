import { expect, test } from '@playwright/test';

import { COACH_EMAIL, signIn } from './helpers';

// Journey 4: what is absent. The recurring bug in this codebase — found
// eleven times — is a switch an owner can see and a server that ignores
// it; the visible half of that is a section rendering for somebody it
// shouldn't. A coach opens Manage and the owner-only cards must not be
// there, while a card their default capabilities do grant must be.
test('a coach sees Manage without the owner-only sections', async ({ page }) => {
  await signIn(page, COACH_EMAIL, { expectBar: false });
  // ?section= is the deep link /onboarding uses to land on Settings with
  // a section open — viewport-agnostic, where the Settings pill is a
  // desktop-only element that display:nones away at phone width.
  await page.goto('/management?section=class-types');

  // Granted to coaches at the defaults (can_edit_classes).
  await expect(page.getByText('Class types').first()).toBeVisible({ timeout: 30_000 });

  // visible: isOwner (management/index.tsx) — absence is the assertion.
  await expect(page.getByText('Gym settings')).toHaveCount(0);
  await expect(page.getByText('Branding')).toHaveCount(0);
});
