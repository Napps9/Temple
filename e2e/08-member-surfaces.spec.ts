import { expect, test } from '@playwright/test';

import { signInMember } from './helpers';

// Journey 8: the two surfaces 0277 fixed, seen the way a member sees
// them. Everything else in the repo proves these server-side — pgTAP
// proves the rank arithmetic, vitest proves the units — and none of it
// touches the client-to-PostgREST hop. src/types/database.ts is
// hand-maintained and both call sites cast through `as unknown as`, so a
// wrong parameter name typechecks perfectly and fails only in front of a
// member. This is the only test in the repo that would catch it.
//
// Read-only against the seeded demo gym: the journeys share one gym and
// a waitlist departure here would change what the others see.

test('a member can see who to message', async ({ page }) => {
  await signInMember(page);
  await page.goto('/inbox/direct/new');

  // The defect, exactly: gym_memberships hands a member their own row and
  // nothing else, the caller-exclusion removed it, and the picker said
  // this to every member while looking correct to every owner.
  await expect(page.getByText('The gym')).toBeVisible();
  await expect(page.getByText('No matches.')).toHaveCount(0);

  // A role chip only renders for non-members, so one proves the roster
  // came back with roles attached rather than a bare list of names.
  await expect(page.getByText(/^(coach|owner|admin|staff)$/i).first()).toBeVisible();
});

test('a thread says who you are talking to', async ({ page }) => {
  await signInMember(page);
  await page.goto('/inbox/direct/new');
  await expect(page.getByText('The gym')).toBeVisible();

  // First row under "The gym" is staff by construction — the screen sorts
  // owner/admin/coach/staff ahead of members.
  const firstStaffRow = page.getByText(/^(coach|owner|admin|staff)$/i).first();
  await firstStaffRow.click();
  await page.waitForURL('**/inbox/direct/**');

  // The subtitle under the name. peerRole read gym_memberships before
  // 0277, resolved null for every member, and this never appeared.
  await expect(page.getByText(/^(Coach|Owner|Admin|Staff)$/).first()).toBeVisible();
});

test('the waitlist card and the class modal agree', async ({ page }) => {
  await signInMember(page);
  await page.goto('/bookings');

  // The pill's count comes from the class_waitlist rows themselves, not
  // from my_waitlist_ranks, so it settles whether this member holds a
  // place before anything is asserted about the number on the card.
  // Counting the cards instead raced the tab's render and skipped the
  // test on a member who was queued first in line.
  const pill = page.getByText(/^Waitlisted \(\d+\)$/);
  await expect(pill).toBeVisible({ timeout: 30_000 });
  const queued = Number((await pill.innerText()).match(/\((\d+)\)/)![1]);
  if (queued === 0) {
    test.skip(
      true,
      'this member holds no waitlist entry — the seeder prints the three it queued, pass one as member_email',
    );
    return;
  }
  await pill.click();

  // "On the waitlist" with no number is bookings.tsx's null-rank
  // fallback: the rows came back but my_waitlist_ranks did not. That is
  // precisely the break this journey exists to catch, and it must fail
  // rather than quietly read as a card without a rank.
  await expect(page.getByText('On the waitlist', { exact: true })).toHaveCount(0);

  const card = page.getByText(/You're next in line|#\d+ on the waitlist/).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  const cardText = (await card.innerText()).trim();
  const cardRank = cardText.startsWith("You're next")
    ? 1
    : Number(cardText.match(/#(\d+)/)![1]);

  await card.click();
  const modal = page.getByText(/You're #\d+ on the waitlist/).first();
  await expect(modal).toBeVisible({ timeout: 15_000 });
  const modalRank = Number((await modal.innerText()).match(/#(\d+)/)![1]);

  // Two screens, one class. Bookings rendered class_waitlist.position —
  // insertion order, never renumbered (0016) — while the modal computed
  // the rank, so they disagreed by however many people had left.
  expect(cardRank).toBe(modalRank);
});
