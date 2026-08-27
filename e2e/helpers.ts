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
// Presence, never counts. The count of /Yes,/ buttons is not monotonic:
// the close card is still holding its own confirm when a pass samples
// "before", then resolves into a receipt and takes that button away. The
// count fell by one, the reopen card put it back, and `3 > 3` was false
// forever — with the right card sitting on screen the whole time.
//
// So each answer is identified by something only it says. That is the
// rule this screen keeps teaching: cards arrive and resolve
// asynchronously, so counts, `.first()` and `.last()` are all defeated,
// and only a label that belongs to one card is safe.
export async function reopenUntilClear(
  page: Page,
  sentence: string,
  // Matches the closure's own label in the "which one?" list — the date
  // the sentence named. Passed in rather than guessed, so the helper can
  // never click some unrelated button that happens to carry a digit.
  choiceLabel: RegExp,
): Promise<void> {
  // 'Yes, open it back up' is the reopen action's own confirm
  // (src/lib/actions/gym.ts) and no other card on the Timeline carries
  // it — not the standing agent questions, not the close card.
  const confirm = page.getByRole('button', { name: /Yes, open it back up/ });
  const ambiguous = page.getByText('Which closure is ending?');
  // Two sentences mean the same thing: "Nothing is closed on <date>."
  // when other closures exist, and "The gym is not closed for anything at
  // the moment." when none do. The drain hung for a whole run on only
  // knowing the first.
  const clear = page.getByText(
    /Nothing is closed on|not closed for anything at the moment/,
  );

  for (let pass = 0; pass < 4; pass += 1) {
    await say(page, sentence);

    const deadline = Date.now() + 30_000;
    for (;;) {
      if (await clear.last().isVisible()) return;
      if (await confirm.last().isVisible()) break;
      if (await ambiguous.last().isVisible()) {
        await page
          .getByRole('button')
          .filter({ hasText: choiceLabel })
          .last()
          .click();
        await expect(confirm.last()).toBeVisible({ timeout: 30_000 });
        break;
      }
      if (Date.now() > deadline) {
        // Say what the gym actually replied. A bare timeout cost a whole
        // run to learn nothing from.
        const shown = (await page.locator('body').innerText()).slice(-700);
        throw new Error(
          `"${sentence}" produced no confirm, no choice list and no ` +
            `"nothing is closed". The end of the page read:\n${shown}`,
        );
      }
      await page.waitForTimeout(500);
    }

    await confirm.last().click();
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
