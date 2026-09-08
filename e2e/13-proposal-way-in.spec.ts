import { expect, test } from '@playwright/test';

import { OWNER_EMAIL, signIn } from './helpers';

// Journey 13: a proposal card's way in goes somewhere.
//
// "Read and edit first" used to look the action's subscription up from the
// client when tapped and navigate only if it found one. A chase carrying no
// subject_subscription therefore swallowed the tap: the press registered,
// nothing happened, and nothing said why. Every seeded demo proposal was
// that shape, so on the showcase tenant the chip was inert every time.
//
// A unit test can prove the card computes an href. It cannot prove the tap
// changes the URL and the page at the other end renders — which is the only
// claim an owner cares about, and the one nothing had ever made.

test('the way into a proposal changes the URL and lands on a real page', async ({
  page,
}) => {
  await signIn(page, OWNER_EMAIL);

  // Either label: which one a card offers depends on its kind and on
  // whether it carries a subscription, and both have to work. The chase
  // card's chip is the editor; every other kind opens the nudge's own page.
  const wayIn = page
    .getByRole('button', { name: /^(Read and edit first|See the whole story)$/ })
    .first();
  await expect(wayIn).toBeVisible({ timeout: 30_000 });

  const label = (await wayIn.getAttribute('aria-label')) ?? '';
  await wayIn.click();

  // A path segment under /timeline, which is what both destinations are:
  // /timeline/payment/<subscription> or /timeline/<action>. The old chip
  // left the URL exactly where it was.
  await page.waitForURL(/\/timeline\/[^/?#]+/, { timeout: 30_000 });

  // And the page at the other end is Temple's, not the platform's 404 and
  // not the app's own "this one is gone" state. Back is on every one of
  // these pages; the editor additionally has something to send.
  await expect(page.getByText('Back', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Nothing here')).toHaveCount(0);
  await expect(page.getByText('The app crashed')).toHaveCount(0);

  if (label === 'Read and edit first') {
    // The draft editor: the whole point of that label is that the words
    // are on screen and changeable before anything goes.
    await expect(page.getByText(/^Send this to /).first()).toBeVisible({
      timeout: 30_000,
    });
  } else {
    await expect(page.getByText('Why it came up').first()).toBeVisible({
      timeout: 30_000,
    });
  }
});
