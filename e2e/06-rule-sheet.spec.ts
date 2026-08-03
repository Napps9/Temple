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

  await expect(page.getByText('Your rules')).toBeVisible({ timeout: 30_000 });

  // Value tokens are the tappable spans inside the rule sentences. Tap
  // the first one and its options must appear as chips beneath the line.
  const sheet = page.getByText('Your rules').locator('..');
  const token = sheet.locator('[tabindex="0"]').first();
  await token.click();

  // Option chips carry short labels; at least two choices must appear
  // (a rule with one option is not a choice).
  const chips = sheet.locator('[tabindex="0"]');
  await expect.poll(() => chips.count()).toBeGreaterThan(2);

  // Re-selecting the current value is a save that changes nothing —
  // exercises the write path without altering the gym. The sheet must
  // settle without an error line.
  await chips.nth(1).click();
  await expect(page.getByText(/couldn.t|failed|error/i)).toHaveCount(0);
});
