import { expect, test } from '@playwright/test';

import { OWNER_EMAIL, signIn } from './helpers';

// Journey 16, two separate claims about the staff rail's neighbours.
//
// One: the wide staff pages centre their column like every other page.
// Manage and the Leads shell were the only two screens in the app with a
// max-width and no mx-auto, so their content ran hard against the rail
// with the whole gutter on the right, and the rail's open panel had the
// page's own heading to land on rather than empty ground.
//
// Two: a rail destination navigates when it is clicked. Nothing in this
// suite had ever pressed one — every other journey reaches its screen
// with page.goto — so the rail's rows have been drawn, measured and
// never used.
//
// Neither says anything about the open panel floating over the page.
// That is the rail's design and is measured nowhere here.

test('Manage centres its column beside the rail', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'the rail, and this column width, only exist at 1024 and up',
  );
  test.setTimeout(120_000);

  await signIn(page, OWNER_EMAIL);
  // By URL, like every other journey: this test is about the column, and
  // routing through the rail would make a rail fault look like a layout
  // fault. The click has its own test below.
  await page.goto('/management');

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

test('a rail destination navigates when clicked', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'the rail only exists at 1024 and up',
  );
  test.setTimeout(120_000);

  await signIn(page, OWNER_EMAIL);

  const manage = page.getByRole('tab', { name: 'Manage' });
  await expect(manage).toBeVisible({ timeout: 30_000 });

  // Hover, wait for the row to stop moving, then press it. Do not
  // collapse this back into a bare click(): a cold click leaves the page
  // on /timeline every time, which is what three runs of it did before
  // this dance went in.
  //
  // The row is not dead — settling first navigates, which is what proves
  // it. The press was landing on a row that had moved out from under it:
  // pointerenter sets peeking, React re-renders the row from a centred
  // 44px icon to a 222px row with a label, and Playwright's stability
  // check can sample two identical frames BEFORE that re-render commits,
  // call the box settled, and press stale coordinates. Waiting on the
  // box itself is the only honest way to press a control that resizes
  // because you pointed at it.
  await manage.hover();
  let last = '';
  for (let i = 0; i < 40; i++) {
    const box = await manage.boundingBox();
    const now = JSON.stringify(box);
    if (now === last) break;
    last = now;
    await page.waitForTimeout(50);
  }
  await manage.click();

  // Report where it actually went. A bare waitForURL times out saying
  // only that thirty seconds passed, which does not distinguish a press
  // that missed the row from a press that landed and routed nowhere.
  await expect
    .poll(() => new URL(page.url()).pathname, {
      timeout: 30_000,
      message: 'clicked Manage in the rail; the path never became /management',
    })
    .toMatch(/^\/management/);
});
