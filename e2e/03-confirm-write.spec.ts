import { expect, test } from '@playwright/test';

import {
  OWNER_EMAIL,
  PARSER_AVAILABLE,
  reopenUntilClear,
  sayAndConfirm,
  signIn,
} from './helpers';

// Journey 3: confirm, and the write lands. The close/reopen pair is
// chosen because it is the registry's own undo — the journey leaves the
// gym exactly as it found it, so the suite can run repeatedly against
// one seeded gym.
//
// That contract only holds if every run finishes. One that dies between
// the close and the reopen leaves a closure behind, and two closures on
// one date make the reopen preview ask which is ending rather than offer
// a confirm — so the journey locked itself out of the gym, permanently,
// and every later run added another closure. Hence draining rather than
// reopening once.
test('confirming a card lands the write, and its inverse undoes it', async ({ page }) => {
  test.skip(!PARSER_AVAILABLE, 'parser functions not reachable (E2E_PARSER=0)');
  await signIn(page, OWNER_EMAIL);

  // sayAndConfirm, not a page-wide `.last()`: before the parser returns,
  // the only Yes buttons belong to the standing agent questions, and
  // confirming one of those executes a real action.
  await sayAndConfirm(page, 'Close the gym on 25 December', /Yes, close it/);

  // Receipt: the card resolves into a done state rather than an error.
  // `.last()`, not `.first()`: the close card's own body says "cancelled"
  // before anything has happened, so the first match was satisfied by the
  // question rather than by the answer.
  await expect(page.getByText(/closed|done|cancelled/i).last()).toBeVisible({
    timeout: 30_000,
  });

  await reopenUntilClear(page, 'Reopen 25 December', /December/);
});
