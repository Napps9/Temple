import { expect, test } from '@playwright/test';

import { OWNER_EMAIL, PARSER_AVAILABLE, say, signIn } from './helpers';

// Journey 2: say a sentence, get a card. Exercises the parser edge
// function, the action registry shortlist, and the preview renderer —
// with a question, so nothing is written and the journey can run on any
// seeded gym without dirtying it.
test('a sentence in the bar becomes a card', async ({ page }) => {
  test.skip(!PARSER_AVAILABLE, 'parser functions not reachable (E2E_PARSER=0)');
  await signIn(page, OWNER_EMAIL);

  await say(page, 'Who has gone quiet?');

  // The quiet-members answer names its subject. Any of the answer
  // card's stable furniture would do; the header is the least likely to
  // be reworded casually — if it is, this failing is the reminder that
  // the copy is load-bearing.
  await expect(page.getByText(/gone quiet|quiet lately|not seen/i).first()).toBeVisible({
    timeout: 30_000,
  });
});
