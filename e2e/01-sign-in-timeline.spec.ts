import { expect, test } from '@playwright/test';

import { OWNER_EMAIL, signIn } from './helpers';

// Journey 1: the whole stack agreeing. Sign in as the demo owner and the
// Timeline renders — auth, membership resolution, the capability read,
// and the server-side timeline union all have to work for the talk bar
// and at least one event card to arrive.
test('the owner signs in and the Timeline renders', async ({ page }) => {
  await signIn(page, OWNER_EMAIL);

  // The seeded gym always has agent proposals waiting (the seeder prints
  // "N question(s) waiting"), so a Timeline with no card offering its
  // evidence is a regression, not an empty gym.
  await expect(page.getByText('See the details').first()).toBeVisible();
});
