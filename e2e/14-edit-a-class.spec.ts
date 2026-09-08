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

test('an owner edits one class from its sheet', async ({ page }) => {
  await signIn(page, OWNER_EMAIL);

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
  await expect(page.getByText('That class is updated.')).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('button', { name: 'Done' }).click();

  // And the class underneath agrees, which is the invalidation working.
  await expect(page.getByText(/\/ 17 spots taken/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('The app crashed')).toHaveCount(0);
});
