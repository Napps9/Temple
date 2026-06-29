import { test, expect, journeyEnabled } from '../support/fixtures';
import {
  ConsentPage,
  CreateGymPage,
} from '../pages/auth';
import { JoinPage } from '../pages/join';
import { BookPage } from '../pages/booking';
import { ClassTypesPage, PlansPage } from '../pages/manage';
import { CLASS_TYPE_NAME, makeMember, makeOwner } from '../support/data';

// End-to-end platform journey: an owner signs up, creates a gym, sets up a
// class type with a daily schedule and a plan; then a brand-new member
// self-joins via the public link, clears the consent gate, and books a
// class.
//
// This MUTATES a real backend, so it is opt-in (E2E_JOURNEY=1) and expects
// the target Supabase project to AUTO-CONFIRM signups (email confirmation
// off). See docs/e2e.md.
test.describe('full platform journey @journey', () => {
  test.skip(
    !journeyEnabled,
    'Set E2E_JOURNEY=1 (with a non-prod backend) to run the mutating journey.',
  );
  // The whole journey is one ordered story across two browser contexts.
  test('owner sets up a gym; member joins and books', async ({ browser }) => {
    test.setTimeout(180_000);
    const owner = makeOwner();
    const member = makeMember();

    // ---- Owner: account + gym + branding ----
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    try {
      const createGym = new CreateGymPage(ownerPage);
      await createGym.open();
      const created = await createGym.create(owner);
      test.skip(
        !created,
        'Backend required email confirmation — point at an auto-confirm project.',
      );

      // Owner clears the consent gate if it is shown on first entry.
      const ownerConsent = new ConsentPage(ownerPage);
      if (await ownerConsent.isShown().isVisible().catch(() => false)) {
        await ownerConsent.complete({ name: owner.name, dob: '1990-01-01' });
      }

      // ---- Owner: gym setup (class type + schedule, plan) ----
      const classTypes = new ClassTypesPage(ownerPage);
      await classTypes.open();
      await classTypes.addWithDailySchedule(CLASS_TYPE_NAME);

      const plans = new PlansPage(ownerPage);
      await plans.open();
      await plans.addUnlimited('Unlimited', '50');

      // ---- Member: self-join via the public slug ----
      const memberCtx = await browser.newContext();
      const memberPage = await memberCtx.newPage();
      try {
        const join = new JoinPage(memberPage);
        await join.open(owner.slug);
        expect(await join.isDisabled()).toBe(false);

        const signedUp = await join.signUp(member, owner);
        test.skip(
          !signedUp,
          'Member signup hit email confirmation — use an auto-confirm project.',
        );

        // Member clears the consent gate, then lands on the booking calendar.
        const memberConsent = new ConsentPage(memberPage);
        await memberConsent.complete(member);

        // ---- Member: book a class ----
        const book = new BookPage(memberPage);
        await book.open();
        await book.openClass(CLASS_TYPE_NAME);
        const result = await book.book();
        expect(result).toBe('booked');
      } finally {
        await memberCtx.close();
      }
    } finally {
      await ownerCtx.close();
    }
  });
});
