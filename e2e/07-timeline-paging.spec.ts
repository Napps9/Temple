import { expect, test } from '@playwright/test';

import { OWNER_EMAIL, signIn, TALK_BAR_PLACEHOLDER } from './helpers';

// Journey 7: the Timeline pages by day. Yesterday is a read-only thread
// — no talk bar — and the Today button brings the conversation back.
// Arrow-driven on purpose: the swipe is the touch affordance, the
// arrows are the contract.
test('the Timeline pages back a day and comes home', async ({ page }) => {
  await signIn(page, OWNER_EMAIL);

  // Wait on aria-disabled, not toBeEnabled. React Native Web writes a
  // Pressable's disabled state as aria-disabled, and Playwright does not
  // treat that as disabled here — toBeEnabled passed instantly against an
  // arrow that was still dead, the click went nowhere, and the pager sat
  // on Today for the full timeout. The run said so itself:
  // `pager did not move from "Today" — Previous day had
  // aria-disabled="true"`.
  //
  // It is true while the pager's bounds are unknown: they come from a
  // query for the gym's created_at, and until it lands the floor falls
  // back to today, which makes atFloor true. "false" is the signal that
  // the floor is real.
  const back = page.getByLabel('Previous day');
  // Absent, not "false": react-native-web writes aria-disabled only while
  // the control IS disabled and drops the attribute otherwise, so
  // getAttribute returns null once the arrow is live. Polling for 'false'
  // waited thirty seconds for a string that never appears.
  await expect
    .poll(() => back.getAttribute('aria-disabled'), { timeout: 30_000 })
    .not.toBe('true');

  const picker = page.getByLabel('Pick a date');
  const startedOn = (await picker.innerText()).trim();
  await back.click();

  await expect(async () => {
    const now = (await picker.innerText()).trim();
    expect(now, `pager did not move from "${startedOn}"`).not.toBe(startedOn);
  }).toPass({ timeout: 15_000 });
  await expect(picker).toHaveText('Yesterday');
  // Past days are the record; the pen stays on today, and the composer's
  // place says so rather than standing empty.
  await expect(page.getByPlaceholder(TALK_BAR_PLACEHOLDER)).toHaveCount(0);
  await expect(page.getByText('Jump to today to ask Temple something')).toBeVisible();

  await page.getByLabel('Jump to today').click();
  await expect(page.getByPlaceholder(TALK_BAR_PLACEHOLDER)).toBeVisible({
    timeout: 15_000,
  });
});
