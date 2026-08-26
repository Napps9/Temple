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
