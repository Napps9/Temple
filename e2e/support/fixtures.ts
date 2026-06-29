import { test as base, expect, type Page } from '@playwright/test';

import { AcceptInvitePage } from '../pages/join';
import { BookPage } from '../pages/booking';
import {
  ConsentPage,
  CreateGymPage,
  GetStartedPage,
  OnboardingPage,
  SignInPage,
} from '../pages/auth';
import { JoinPage } from '../pages/join';
import {
  BrandingPage,
  ClassTypesPage,
  Nav,
  PlansPage,
} from '../pages/manage';

// React Native Web mounts the whole app into a single root and routes
// client-side. After a hard navigation, give the bundle a beat to hydrate
// and settle before asserting — the first paint is often a loading spinner.
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
}

type Pages = {
  getStarted: GetStartedPage;
  signIn: SignInPage;
  createGym: CreateGymPage;
  consent: ConsentPage;
  onboarding: OnboardingPage;
  join: JoinPage;
  acceptInvite: AcceptInvitePage;
  nav: Nav;
  classTypes: ClassTypesPage;
  plans: PlansPage;
  branding: BrandingPage;
  book: BookPage;
};

export const test = base.extend<Pages>({
  getStarted: async ({ page }, use) => use(new GetStartedPage(page)),
  signIn: async ({ page }, use) => use(new SignInPage(page)),
  createGym: async ({ page }, use) => use(new CreateGymPage(page)),
  consent: async ({ page }, use) => use(new ConsentPage(page)),
  onboarding: async ({ page }, use) => use(new OnboardingPage(page)),
  join: async ({ page }, use) => use(new JoinPage(page)),
  acceptInvite: async ({ page }, use) => use(new AcceptInvitePage(page)),
  nav: async ({ page }, use) => use(new Nav(page)),
  classTypes: async ({ page }, use) => use(new ClassTypesPage(page)),
  plans: async ({ page }, use) => use(new PlansPage(page)),
  branding: async ({ page }, use) => use(new BrandingPage(page)),
  book: async ({ page }, use) => use(new BookPage(page)),
});

export { expect };

// Journey specs mutate a real backend (create gyms / members, maybe send
// invite mail), so they are opt-in: set E2E_JOURNEY=1 alongside an
// E2E_BASE_URL that points at an app wired to a *non-production* Supabase.
export const journeyEnabled = process.env.E2E_JOURNEY === '1';
