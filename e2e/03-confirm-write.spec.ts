import { expect, test } from '@playwright/test';

import { OWNER_EMAIL, PARSER_AVAILABLE, say, signIn } from './helpers';

// Journey 3: confirm, and the write lands. The close/reopen pair is
// chosen because it is the registry's own undo — the journey leaves the
// gym exactly as it found it, so the suite can run repeatedly against
// one seeded gym.
test('confirming a card lands the write, and its inverse undoes it', async ({ page }) => {
  test.skip(!PARSER_AVAILABLE, 'parser functions not reachable (E2E_PARSER=0)');
  await signIn(page, OWNER_EMAIL);

  await say(page, 'Close the gym on 25 December');
  // The preview card asks before anything happens. Role-scoped so the
  // echo of the sentence in the feed can never be the click target;
  // per-action confirm labels vary ('Yes, do it' default, 'Yes, send
  // it' for message-bearing cards).
  const confirm = page.getByRole('button', { name: /Yes,/ }).last();
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  await confirm.click();

  // Receipt: the card resolves into a done state rather than an error.
  await expect(page.getByText(/closed|done|cancelled/i).first()).toBeVisible({
    timeout: 30_000,
  });

  await say(page, 'Reopen 25 December');
  const reopen = page.getByRole('button', { name: /Yes,/ }).last();
  await expect(reopen).toBeVisible({ timeout: 30_000 });
  await reopen.click();
  await expect(page.getByText(/reopened|back on|done/i).first()).toBeVisible({
    timeout: 30_000,
  });
});
