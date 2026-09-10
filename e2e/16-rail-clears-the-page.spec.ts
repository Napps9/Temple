import { expect, test } from '@playwright/test';

import { OWNER_EMAIL, signIn } from './helpers';

// Journey 16: the wide staff pages centre their column like every other
// page does.
//
// Manage and the Leads shell were the only two screens in the app with a
// max-width and no mx-auto, so their content ran hard against the rail
// with the whole gutter on the right. That is why the rail's panel, when
// it opens, had the page's own heading and first cards to land on rather
// than empty ground — and why these two screens read as a different
// product beside the others.
//
// A claim about boxes, so ask the browser for the boxes. This says
// nothing about the rail's open panel: that floats over the page by
// design and is measured nowhere here.

test('Manage centres its column beside the rail', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'the rail, and this column width, only exist at 1024 and up',
  );
  test.setTimeout(120_000);

  await signIn(page, OWNER_EMAIL);

  await page.getByRole('tab', { name: 'Manage' }).click();
  await page.waitForURL(/\/management/, { timeout: 30_000 });

  const heading = page.getByRole('heading', { name: 'Manage', exact: true });
  await expect(heading).toBeVisible({ timeout: 30_000 });

  // The rail at rest is the icon strip, and the strip's width is what the
  // page lays out around.
  const strip = page.getByRole('tab', { name: 'Timeline' });
  await expect(strip).toBeVisible();

  const stripBox = await strip.boundingBox();
  const headingBox = await heading.boundingBox();
  const viewport = page.viewportSize();
  if (!stripBox || !headingBox || !viewport) {
    throw new Error('one of them is not laid out');
  }

  const leftGutter = headingBox.x - (stripBox.x + stripBox.width);
  const rightGutter = viewport.width - (headingBox.x + headingBox.width);
  expect(
    Math.abs(leftGutter - rightGutter),
    `left gutter ${Math.round(leftGutter)}, right gutter ${Math.round(rightGutter)}`,
  ).toBeLessThanOrEqual(24);
});
