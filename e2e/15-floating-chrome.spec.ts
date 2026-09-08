import { expect, test } from '@playwright/test';

import { OWNER_EMAIL, TALK_BAR_PLACEHOLDER, signIn } from './helpers';

// Journey 15: the two floating containers do not sit on top of each other.
//
// They did, on the first cut. The talk bar is absolutely positioned and I
// gave it bottom-0, expecting the scroller's pb-dock to hold it clear of
// the dock — but an absolutely positioned child is laid out against its
// containing block's PADDING box, whose bottom edge is below that padding,
// so the padding lifted it by nothing and the dock drew straight over the
// bar's text.
//
// Nothing could have caught that except geometry. Both elements were
// present, visible and correctly styled; they were simply in the same
// place, and a screenshot in a mockup is drawn by hand from the intent
// rather than from the layout. So: ask the browser where they actually
// are.

test('the talk bar clears the dock', async ({ page }, testInfo) => {
  // The dock is the phone's navigation and does not exist at md and up,
  // where the rail takes over and the bar sits at the bottom of the window.
  test.skip(
    testInfo.project.name !== 'phone',
    'the dock is the phone navigation',
  );

  await signIn(page, OWNER_EMAIL);
  await expect(page.getByPlaceholder(TALK_BAR_PLACEHOLDER)).toBeVisible({
    timeout: 30_000,
  });

  // Send is the bottom-most control of the bar in both its sizes: in the
  // chips row when full, on its own row when compact.
  const send = page.getByLabel('Send', { exact: true });
  const tab = page.getByRole('tab').first();
  await expect(send).toBeVisible();
  await expect(tab).toBeVisible();

  const sendBox = await send.boundingBox();
  const tabBox = await tab.boundingBox();
  if (!sendBox || !tabBox) throw new Error('one of them is not laid out');

  // The whole of the bar's last row above the whole of the dock. Not a
  // near-miss tolerance: they are separate pieces of chrome and the gap
  // between them is deliberate.
  expect(
    sendBox.y + sendBox.height,
    `the talk bar's last row ends at ${Math.round(sendBox.y + sendBox.height)} and the dock starts at ${Math.round(tabBox.y)}`,
  ).toBeLessThanOrEqual(tabBox.y);
});
