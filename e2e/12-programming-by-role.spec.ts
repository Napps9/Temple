import { expect, test } from '@playwright/test';

import { OWNER_EMAIL, signIn } from './helpers';

// Journey 12: /programming is one URL and two screens, so it has to know who
// is asking.
//
// (member)/programming and (staff)/programming both serve at /programming,
// and the static export writes one file for it — the member one, because
// "(m" sorts before "(s". So a cold load, a refresh, a bookmark, or the
// marketing site's Programming tour stop put an owner on the read-only
// member calendar with no rail to get back to. Client-side navigation was
// fine, which is why nothing noticed: only a document load ever re-resolves
// the URL from scratch.
//
// page.goto is a real document load, which is the only way to test this. The
// vitest guard can prove the collision is declared; it cannot prove which
// screen answers.

const STAFF_ONLY = 'Year'; // the Week/Year toggle, staff editor only

test('an owner cold-loading /programming gets the editor', async ({ page }) => {
  await signIn(page, OWNER_EMAIL, { expectBar: false });

  await page.goto('/programming');

  // The Week/Year toggle and the Analysis chip exist only on the staff
  // render. The member calendar has neither.
  await expect(page.getByText(STAFF_ONLY, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Analysis', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('The app crashed')).toHaveCount(0);
});

test('the member crossing still shows an owner the member calendar', async ({ page }) => {
  await signIn(page, OWNER_EMAIL, { expectBar: false });

  // as=member is what the member nav sends when a staff viewer crosses over
  // on purpose — Viewing Staff, the member dock, Programming. Without it the
  // capability decides, which is the line above.
  await page.goto('/programming?as=member');

  await expect(page.getByText(STAFF_ONLY, { exact: true })).toHaveCount(0);
  await expect(page.getByText('The app crashed')).toHaveCount(0);
});
