import { expect, test } from '@playwright/test';

import { OWNER_EMAIL, signIn } from './helpers';

// Journey 16: the staff rail and the page do not occupy the same pixels.
//
// They did. The rail was an icon strip that floated its full 246px panel
// out over the page on hover, so reaching for a destination covered the
// page heading, the section pills and the first card — the exact content
// you were pointing past. Both elements were present and correctly
// styled, which is why nothing caught it: the fault was geometry, the
// same shape as journey 15's talk bar over the dock.
//
// The rail is in the row now and takes permanent width. That is a claim
// about boxes, so ask the browser for the boxes.

test('the rail never covers the page', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'the rail only exists at 1024 and up',
  );
  test.setTimeout(120_000);

  await signIn(page, OWNER_EMAIL);

  // Manage: the page whose heading the panel used to land on.
  await page.getByRole('tab', { name: 'Manage' }).click();
  await page.waitForURL(/\/management/, { timeout: 30_000 });

  const heading = page.getByRole('heading', { name: 'Manage', exact: true });
  await expect(heading).toBeVisible({ timeout: 30_000 });

  // Hover the rail. Under the old behaviour this is what opened the panel
  // over the page; under this one it does nothing at all, which is the
  // point.
  const railLink = page.getByRole('tab', { name: 'Timeline' });
  await railLink.hover();

  const railBox = await railLink.boundingBox();
  const headingBox = await heading.boundingBox();
  if (!railBox || !headingBox) throw new Error('one of them is not laid out');

  // The whole of the rail to the left of the whole of the page content.
  expect(
    railBox.x + railBox.width,
    `the rail ends at ${Math.round(railBox.x + railBox.width)} and the page heading starts at ${Math.round(headingBox.x)}`,
  ).toBeLessThanOrEqual(headingBox.x);

  // And the page is centred in what is left, not shoved against the rail.
  // The gutter to the left of the content is the rail's width plus a
  // margin; a page hard against the rail has only the container padding.
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  const rightGutter = viewport.width - (headingBox.x + headingBox.width);
  const leftGutter = headingBox.x - (railBox.x + railBox.width);
  expect(
    Math.abs(leftGutter - rightGutter),
    `left gutter ${Math.round(leftGutter)}, right gutter ${Math.round(rightGutter)}`,
  ).toBeLessThanOrEqual(24);
});
