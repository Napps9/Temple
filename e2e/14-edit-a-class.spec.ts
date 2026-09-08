import { expect, test } from '@playwright/test';

import { OWNER_EMAIL, signIn } from './helpers';

// Journey 14: an owner changes a class from the class's own sheet.
//
// edit_session_scoped takes twelve arguments and the sheet decides which of
// them are "leave this alone", so the unit tests in class-edit.test.ts cover
// what a save sends. What they cannot cover is whether the round trip works
// at all — the chip opens, the RPC accepts what the sheet built, the result
// comes back in the shape describeEditResult reads, and the calendar shows
// the new value. That is four things nothing had asserted, on a brand new
// surface, and only a real browser against the real database can say it.
//
// Deliberately the narrowest possible edit: capacity on one class, which
// touches no schedule, moves nothing, and tells nobody. The scope machinery
// has its own pgTAP; this journey is about the path existing.

test('an owner edits one class from its sheet', async ({ page }, testInfo) => {
  // Phone only, and not because the feature is: the sheet and its Edit chip
  // are identical at both widths. The day arrows are not — the wide header
  // renders a month nav and nothing that steps a day — and this journey has
  // to reach a day whose classes are all still ahead of it.
  test.skip(
    testInfo.project.name !== 'phone',
    'the day arrows belong to the phone header',
  );
  // Sign-in, a cold load and two round trips do not fit the 60s default.
  test.setTimeout(120_000);

  // expectBar false: this journey never types at Temple, and waiting for
  // the talk bar to arrive is what put the first run over its budget.
  await signIn(page, OWNER_EMAIL, { expectBar: false });

  // Tomorrow, so every class on the day is still ahead of us — Edit is not
  // offered on a class that has already run, and "today" late in the day
  // would leave nothing to click.
  await page.goto('/classes');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // The row's accessible name is "<class> at <time>", which is also the
  // only stable handle on it: the card is a Pressable with no test id.
  const row = page.getByRole('button', { name: / at \d\d:\d\d$/ }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();

  const edit = page.getByRole('button', { name: 'Edit class' });
  await expect(edit).toBeVisible({ timeout: 15_000 });
  await edit.click();

  // Capacity is the one field with no consequences: nobody is told, no
  // schedule is rewritten, and it is visible again on the sheet underneath.
  const capacity = page.getByLabel('Capacity');
  await expect(capacity).toBeVisible({ timeout: 15_000 });
  await capacity.fill('17');

  await page.getByRole('button', { name: 'Save this class' }).click();

  // describeEditResult's first line for a single class. Its exact words are
  // the contract between the RPC's counters and the sheet.
  //
  // Reported with the sheet's own words on failure, because "not visible"
  // cannot distinguish a save that was refused (the reason is on screen, in
  // red, a few pixels away) from one that never went. Both look identical
  // to a locator waiting for a receipt.
  try {
    await expect(page.getByText('That class is updated.')).toBeVisible({
      timeout: 30_000,
    });
  } catch {
    const said = (await page.locator('body').innerText())
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' | ');
    throw new Error(`No receipt after Save. The screen said: ${said.slice(0, 1500)}`);
  }

  await page.getByRole('button', { name: 'Done' }).click();

  // And the class underneath agrees, which is the invalidation working.
  await expect(page.getByText(/\/ 17 spots taken/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('The app crashed')).toHaveCount(0);
});
