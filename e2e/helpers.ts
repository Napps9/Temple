import { expect, type Page } from '@playwright/test';

// The demo seeder's accounts (scripts/demo-gym/plan.ts): every account
// shares DEMO_PASSWORD and lives on @<slug>.temple.test. Not imported —
// plan.ts pulls in app modules that want Expo env at load.
const SLUG = process.env.E2E_SLUG ?? 'demo-ironworks';
export const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? `owner@${SLUG}.temple.test`;
export const COACH_EMAIL = process.env.E2E_COACH_EMAIL ?? `coach1@${SLUG}.temple.test`;
export const PASSWORD = process.env.E2E_PASSWORD ?? 'TempleDemo1!';

// Journeys 2 and 3 need the parser edge functions reachable (and their
// ANTHROPIC_API_KEY set). E2E_PARSER=0 skips them rather than failing a
// stack that never claimed to have one.
export const PARSER_AVAILABLE = process.env.E2E_PARSER !== '0';

export const TALK_BAR_PLACEHOLDER =
  'Show me a member, change a class, send a newsletter…';

// The talk bar is the owner's (timeline.tsx renders the whole bottom
// block behind isOwner), so it proves the owner's landing only — staff
// sign-in settles for reaching /timeline at all. Waiting for the bar on
// a coach account can never pass.
export async function signIn(
  page: Page,
  email: string,
  { expectBar = true }: { expectBar?: boolean } = {},
): Promise<void> {
  // Decide cookie consent before first paint so the PECR banner never
  // overlaps a control the journey needs (key: src/lib/cookie-consent.ts).
  await page.addInitScript(() => {
    window.localStorage.setItem('temple.cookieConsent', 'rejected');
  });
  await page.goto('/sign-in');
  // Role-scoped, not getByLabel: the show/hide toggle is aria-labelled
  // "Show password", which getByLabel's substring match also catches —
  // the first hosted run failed all twelve journeys on exactly that.
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByText('Sign in', { exact: true }).last().click();
  // Staff land on the Timeline; for the owner the talk bar arriving is
  // the whole stack agreeing — auth, membership resolution, capability
  // read, timeline union.
  await page.waitForURL('**/timeline**', { timeout: 30_000 });
  if (expectBar) {
    await expect(page.getByPlaceholder(TALK_BAR_PLACEHOLDER)).toBeVisible({
      timeout: 30_000,
    });
  }
}

export async function say(page: Page, sentence: string): Promise<void> {
  const bar = page.getByPlaceholder(TALK_BAR_PLACEHOLDER);
  await bar.fill(sentence);
  // exact: a card's own "Yes, send it" confirm also contains "Send" and
  // getByLabel matches substrings — the second sentence of a journey
  // otherwise hits a strict-mode violation against the previous card.
  await page.getByLabel('Send', { exact: true }).click();
}

// Say something, then confirm the card it produced — by the label only
// that card carries.
//
// Counting Yes buttons was not enough. The standing "Waiting on you"
// cards load asynchronously too, so the count rising meant "something
// appeared", not "my card appeared" — and `.last()` then confirmed a
// real agent question while the preview was still in flight. The proof
// was a run where the close card sat unclicked, the reopen reported
// nothing was closed, and Waiting on you had dropped from three to two.
//
// The confirm labels come from the action itself ('Yes, close it',
// 'Yes, open it back up' — src/lib/actions/gym.ts) and no standing card
// shares one, so matching the label cannot pick the wrong card however
// slow the parser is. The count check stays as a second lock.
export async function sayAndConfirm(
  page: Page,
  sentence: string,
  confirmLabel: RegExp,
): Promise<void> {
  const confirm = page.getByRole('button', { name: confirmLabel });
  const before = await confirm.count();
  await say(page, sentence);
  await expect
    .poll(() => confirm.count(), { timeout: 30_000 })
    .toBeGreaterThan(before);
  await confirm.last().click();
}

// Reopen every closure the journey (or a previous run of it) left on a
// date, until the gym says there is nothing left to reopen.
//
// Draining rather than reopening once, because the undo is not
// guaranteed to run: any run that dies between the close and the reopen
// leaves a closure behind, and TWO closures matching one date make the
// reopen preview ask "Which closure is ending?" instead of offering a
// confirm (src/lib/actions/gym.ts). At that point every later run added
// another closure and none could ever reopen — the journey had locked
// itself out of the gym permanently.
//
// The feed is append-only, so each pass compares counts rather than
// looking for presence: an earlier pass's text never scrolls away.
export async function reopenUntilClear(
  page: Page,
  sentence: string,
  // Matches the closure's own label in the "which one?" list — the date
  // the sentence named. Passed in rather than guessed, so the helper can
  // never click some unrelated button that happens to carry a digit.
  choiceLabel: RegExp,
): Promise<void> {
  const yes = page.getByRole('button', { name: /Yes,/ });
  const ambiguous = page.getByText('Which closure is ending?');
  // Two different sentences mean the same thing: "Nothing is closed on
  // <date>." when other closures exist, and "The gym is not closed for
  // anything at the moment." when none do (src/lib/actions/gym.ts). The
  // drain hung for a whole run on only knowing the first.
  const clear = page.getByText(
    /Nothing is closed on|not closed for anything at the moment/,
  );

  for (let pass = 0; pass < 4; pass += 1) {
    const before = {
      yes: await yes.count(),
      ambiguous: await ambiguous.count(),
      clear: await clear.count(),
    };
    await say(page, sentence);
    // Report what the gym actually said when none of the three expected
    // answers arrives. A bare poll timeout says only "false", which cost
    // a whole run to learn nothing from.
    const moved = async () =>
      (await yes.count()) > before.yes ||
      (await ambiguous.count()) > before.ambiguous ||
      (await clear.count()) > before.clear;
    const deadline = Date.now() + 30_000;
    while (!(await moved())) {
      if (Date.now() > deadline) {
        const shown = (await page.locator('body').innerText()).slice(-700);
        throw new Error(
          `"${sentence}" produced no confirm, no choice list and no ` +
            `"nothing is closed". The end of the page read:\n${shown}`,
        );
      }
      await page.waitForTimeout(500);
    }

    if ((await clear.count()) > before.clear) return;

    if ((await ambiguous.count()) > before.ambiguous) {
      // Pick the first closure it offered; that resolves to a single
      // match and the confirm appears.
      const yesBefore = await yes.count();
      await page.getByRole('button').filter({ hasText: choiceLabel }).last().click();
      await expect
        .poll(() => yes.count(), { timeout: 30_000 })
        .toBeGreaterThan(yesBefore);
    }

    await yes.last().click();
    await expect(page.getByText(/reopened|back on|done/i).last()).toBeVisible({
      timeout: 30_000,
    });
  }

  throw new Error(
    `Still closed after four reopen passes — "${sentence}" is not draining`,
  );
}

// Members do not land on the Timeline — src/app/index.tsx redirects them
// to /book — so signIn's wait can never pass for one.
// `||`, not `??`: run-the-gym passes this through from an optional
// workflow input, so "unset" arrives as the empty string rather than
// undefined, and ?? would hand sign-in a blank email.
export const MEMBER_EMAIL =
  process.env.E2E_MEMBER_EMAIL || `member01@${SLUG}.temple.test`;

export async function signInMember(page: Page, email = MEMBER_EMAIL): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('temple.cookieConsent', 'rejected');
  });
  await page.goto('/sign-in');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByText('Sign in', { exact: true }).last().click();
  await page.waitForURL('**/book**', { timeout: 30_000 });
}
