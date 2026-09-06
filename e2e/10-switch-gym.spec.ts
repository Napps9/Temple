import { expect, test } from '@playwright/test';

import { COACH_EMAIL, signIn } from './helpers';

// Journey 10: one account, two gyms (0283). The coach of the demo gym
// joins a second demo gym by its public link, sees both in the account
// menu, and switches each way. pgTAP proves the server lets the second
// membership exist; nothing else in the repo proves the device-held
// choice reaches useGymMembership, the menu and the root redirect on a
// real build.
//
// The second gym is E2E_SECOND_SLUG (default demo-ironworks, the
// throwaway QA fixture). Joining is idempotent, so the journey can run
// again; it skips rather than fails when that gym is not seeded.

const SECOND = process.env.E2E_SECOND_SLUG ?? 'demo-ironworks';

test('a coach joins a second gym and switches between them', async ({ page }) => {
  await signIn(page, COACH_EMAIL, { expectBar: false });

  await page.goto(`/join/${SECOND}`);
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 30_000 });
  if (await page.getByText('Gym not found').count()) {
    test.skip(true, `${SECOND} is not seeded on this stack`);
  }
  const join = page.getByRole('button', { name: /^Join / });
  await expect(join).toBeVisible({ timeout: 30_000 });
  const secondName = ((await join.textContent()) ?? '').replace(/^Join /, '').trim();
  await join.click();
  await page.waitForURL((url) => !url.pathname.startsWith('/join/'), { timeout: 30_000 });

  // A membership just minted is the one the device looks at: the member
  // surfaces of the second gym, with the coach's own gym offered as the
  // switch.
  await page.goto('/book');
  await page.getByLabel(/^Account/).first().click();
  await expect(page.getByText(secondName).first()).toBeVisible({ timeout: 15_000 });
  const backToCoaching = page.getByText('Switch · Coach');
  await expect(backToCoaching).toBeVisible();
  await backToCoaching.click();

  // A coach at their own gym lands on the Timeline.
  await page.waitForURL('**/timeline**', { timeout: 30_000 });

  await page.getByLabel(/^Account/).first().click();
  const backToMember = page.getByText('Switch · Member');
  await expect(backToMember).toBeVisible({ timeout: 15_000 });
  await backToMember.click();

  // A new member at the second gym meets its gates before /book.
  await page.waitForURL(/\/(book|consent|waiver|parq)/, { timeout: 30_000 });
});
