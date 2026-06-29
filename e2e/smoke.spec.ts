import { test, expect, settle } from './support/fixtures';

// Backend-free smoke: proves the web build boots, the logged-out surfaces
// render, client-side navigation works, and the shared <Input> exposes its
// label to assistive tech / getByLabel. Runs with only a placeholder
// Supabase env (the logged-out screens make no queries).
test.describe('smoke @no-backend', () => {
  test('landing renders and links to sign-in', async ({ page, getStarted }) => {
    await getStarted.open();
    await expect(page.getByText('Welcome to Temple').first()).toBeVisible();
    // Front card (member) CTA + the persistent sign-in link.
    await expect(page.getByText('I have an invite').first()).toBeVisible();
    await expect(getStarted.signInLink()).toBeVisible();
  });

  test('sign-in screen exposes labelled fields', async ({ page, signIn }) => {
    await signIn.open();
    await settle(page);
    await expect(page.getByText('Welcome back').first()).toBeVisible();
    // getByLabel only resolves because <Input> now sets accessibilityLabel.
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('create-gym screen renders the owner sign-up form', async ({
    page,
    createGym,
  }) => {
    await createGym.open();
    await expect(page.getByText('Start a new gym').first()).toBeVisible();
    await expect(page.getByLabel('Your name', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  });
});
