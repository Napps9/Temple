import { expect, test } from '@playwright/test';

import { OWNER_EMAIL, signIn, TALK_BAR_PLACEHOLDER } from './helpers';

// Journey 7: the Timeline pages by day. Yesterday is a read-only thread
// — no talk bar — and the Today button brings the conversation back.
// Arrow-driven on purpose: the swipe is the touch affordance, the
// arrows are the contract.
test('the Timeline pages back a day and comes home', async ({ page }) => {
  await signIn(page, OWNER_EMAIL);

  // Wait for the arrow to mean something. The pager's bounds come from a
  // query for the gym's created_at, and while that is in flight
  // timeline/index.tsx falls back to { floor: today, ceiling: today } —
  // so the arrow renders disabled and an immediate click is swallowed
  // with no error. Enabled is the signal that the floor is known.
  const back = page.getByLabel('Previous day');
  await expect(back).toBeEnabled({ timeout: 30_000 });
  await back.click();
  await expect(page.getByText('Yesterday').first()).toBeVisible({
    timeout: 15_000,
  });
  // Past days are the record; the pen stays on today.
  await expect(page.getByPlaceholder(TALK_BAR_PLACEHOLDER)).toHaveCount(0);

  await page.getByLabel('Jump to today').click();
  await expect(page.getByPlaceholder(TALK_BAR_PLACEHOLDER)).toBeVisible({
    timeout: 15_000,
  });
});
