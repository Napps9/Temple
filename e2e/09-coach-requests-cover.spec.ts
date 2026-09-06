import { expect, test } from '@playwright/test';

import { COACH_EMAIL, OWNER_EMAIL, signIn } from './helpers';

// Journey 9: a coach hands a class over from the class's own sheet, and
// the owner sees the offer on the Timeline. Before the Request cover
// chip existed no signed-in account could raise a request through the
// UI on the demo gym: the Cover screen had retired (0243), the composer
// is the owner's, and request_cover refuses anyone but the class's
// coach, who on the seeded gym is never the owner.
//
// Writes to the gym like journey 3: the request stays open until a
// coach claims it or the nightly sweep expires it with the class.
test('a coach requests cover from the class sheet and the owner sees it', async ({
  page,
}) => {
  await signIn(page, COACH_EMAIL, { expectBar: false });

  // The Timeline lists the coach's remaining classes today, each linking
  // into the Classes calendar with the sheet open. None left (after the
  // last class, or a day the timetable leaves empty) is not a failure.
  const coaching = page.locator('a[href*="/classes?session="]').first();
  test.skip((await coaching.count()) === 0, 'coach1 has no class left today');
  await coaching.click();
  await page.waitForURL('**/classes**');

  const chip = page.getByRole('button', { name: 'Request cover' });
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await chip.click();
  await page.getByRole('button', { name: 'Yes, ask them' }).click();
  await expect(page.getByText('Asked the coaches.')).toBeVisible({ timeout: 15_000 });

  // The web session lives in localStorage; clearing it is the sign-out.
  await page.evaluate(() => window.localStorage.clear());
  await signIn(page, OWNER_EMAIL);
  await expect(page.getByText(/needs cover\./).first()).toBeVisible({ timeout: 30_000 });
});
