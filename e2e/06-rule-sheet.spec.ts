import { expect, test } from '@playwright/test';

import { OWNER_EMAIL, signIn } from './helpers';

// Journey 6: the rules read back and the tap path works. The rule sheet
// is the settings surface as sentences; tapping a value token opens that
// field's options as chips. The save path runs through the same RPC the
// setup conversation uses, so a tap that saves proves parse-free editing
// end to end.
test('the rule sheet opens, offers options on tap, and saves a value', async ({ page }) => {
  await signIn(page, OWNER_EMAIL);
  await page.goto('/timeline?rules=1');

  // first(): on desktop the owner's bar chip is also labelled "Your
  // rules", so the bare text matches twice.
  await expect(page.getByText('Your rules').first()).toBeVisible({ timeout: 30_000 });

  // Value tokens are the tappable spans inside the rule sentences,
  // marked with a ▾ (RuleSheet.tsx) — tapping one opens that field's
  // options as chips beneath the line.
  const before = await page.locator('[tabindex="0"]').count();
  await page.getByText(/▾/).first().click();
  await expect
    .poll(() => page.locator('[tabindex="0"]').count(), { timeout: 15_000 })
    .toBeGreaterThan(before);

  // Re-selecting the current value is a save that changes nothing —
  // exercises the write path without altering the gym. The selected
  // chip carries bg-raised (NativeWind classes land verbatim on web):
  // selected is a soft tint, not the accent, because a sheet full of
  // accent-filled chips is a wash rather than a selection.
  await page.locator('[tabindex="0"].bg-raised').first().click();
  await expect(page.getByText(/couldn.t|failed|error/i)).toHaveCount(0);
});
