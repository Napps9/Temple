import { expect, test } from '@playwright/test';

import { OWNER_EMAIL, signIn } from './helpers';

// Journey 5: layout, the class of bug nothing else in the repo can see.
// StatTile broke "RECIPIENTS" across two lines mid-word on six screens;
// 1,630 unit tests passed over it because jsdom has no layout engine and
// the render harness stubs NativeWind. A real browser measuring real
// boxes is the only fence.
//
// Runs in both projects, and the phone project is the one that matters:
// the wrap only shows at narrow widths.
test('campaign report stat tiles hold one line', async ({ page }, testInfo) => {
  await signIn(page, OWNER_EMAIL);
  await page.goto('/management/communications');

  // The seeder creates exactly one campaign — open it.
  await page.getByText(/newsletter|campaign|welcome/i).first().click();
  await expect(page.getByText(/recipients|arrived|delivered/i).first()).toBeVisible({
    timeout: 30_000,
  });

  // Every stat-tile label is uppercase tracking-wider text. Measure the
  // rendered boxes: a single line of 11-13px caps is under 24px tall;
  // a mid-word wrap doubles it. This is the assertion that would have
  // caught the original bug.
  const labels = page.locator('div[dir="auto"]', {
    hasText: /^[A-Z][A-Z %]+$/,
  });
  const count = await labels.count();
  for (let i = 0; i < count; i += 1) {
    const box = await labels.nth(i).boundingBox();
    if (!box) continue;
    expect
      .soft(box.height, `stat label ${i} wrapped onto a second line`)
      .toBeLessThan(24);
  }

  await page.screenshot({
    path: testInfo.outputPath('campaign-report.png'),
    fullPage: true,
  });
});
