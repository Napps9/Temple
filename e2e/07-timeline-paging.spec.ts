import { expect, test } from '@playwright/test';

import { OWNER_EMAIL, signIn, TALK_BAR_PLACEHOLDER } from './helpers';

// Journey 7: the Timeline pages by day. Yesterday is a read-only thread
// — no talk bar — and the Today button brings the conversation back.
// Arrow-driven on purpose: the swipe is the touch affordance, the
// arrows are the contract.
test('the Timeline pages back a day and comes home', async ({ page }) => {
  await signIn(page, OWNER_EMAIL);

  // The arrow reports enabled and the pager does not move. Two things
  // could do that and the run cannot yet tell them apart: bounds falls
  // back to { floor: today } while the gym's created_at is unknown, which
  // makes atFloor true and the arrow disabled in effect — react-native-web
  // writes that as aria-disabled, which Playwright's toBeEnabled does not
  // treat the same as the disabled attribute — or the click lands and
  // shiftDay clamps straight back to a floor of today. Read the attribute
  // and say which, rather than guessing a fourth time.
  const back = page.getByLabel('Previous day');
  await expect(back).toBeEnabled({ timeout: 30_000 });
  const picker = page.getByLabel('Pick a date');
  const startedOn = (await picker.innerText()).trim();
  const ariaDisabled = await back.getAttribute('aria-disabled');
  await back.click();

  // Changed, not equal to "Yesterday": if the pager moved at all the
  // click is landing and only the destination is wrong, which is a
  // different fault from not moving.
  await expect(async () => {
    const now = (await picker.innerText()).trim();
    expect(
      now,
      `pager did not move from "${startedOn}" — Previous day had ` +
        `aria-disabled="${ariaDisabled}"`,
    ).not.toBe(startedOn);
  }).toPass({ timeout: 15_000 });
  await expect(picker).toHaveText('Yesterday');
  // Past days are the record; the pen stays on today.
  await expect(page.getByPlaceholder(TALK_BAR_PLACEHOLDER)).toHaveCount(0);

  await page.getByLabel('Jump to today').click();
  await expect(page.getByPlaceholder(TALK_BAR_PLACEHOLDER)).toBeVisible({
    timeout: 15_000,
  });
});
