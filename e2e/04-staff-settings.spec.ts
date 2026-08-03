import { expect, test } from '@playwright/test';

import { COACH_EMAIL, signIn } from './helpers';

// Journey 4: what is absent. The recurring bug in this codebase — found
// eleven times — is a switch an owner can see and a server that ignores
// it; the visible half of that is a section rendering for somebody it
// shouldn't. A coach opens Manage and the owner-only cards must not be
// there, while a card their default capabilities do grant must be.
test('a coach sees Manage without the owner-only sections', async ({ page }) => {
  await signIn(page, COACH_EMAIL);
  await page.goto('/management');

  // Granted to coaches at the defaults (can_edit_classes).
  await expect(page.getByText('Class types').first()).toBeVisible({ timeout: 30_000 });

  // visible: isOwner (management/index.tsx) — absence is the assertion.
  await expect(page.getByText('Gym settings')).toHaveCount(0);
  await expect(page.getByText('Branding')).toHaveCount(0);
});
