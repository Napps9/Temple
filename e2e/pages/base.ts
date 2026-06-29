import { expect, type Locator, type Page } from '@playwright/test';

// Shared locator helpers tuned to this app's React Native Web output:
//   - <Input> exposes its label as aria-label  -> getByLabel
//   - <Button> sets role="button" with its text -> getByRole('button')
//   - bare <Pressable> rows/links/pills carry only text -> getByText
export class BasePage {
  constructor(readonly page: Page) {}

  /** Hard-navigate to an app route and wait for the bundle to settle. */
  async goto(path: string) {
    await this.page.goto(path);
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }

  field(label: string): Locator {
    return this.page.getByLabel(label, { exact: true });
  }

  byPlaceholder(text: string): Locator {
    return this.page.getByPlaceholder(text, { exact: true });
  }

  button(name: string): Locator {
    return this.page.getByRole('button', { name, exact: true });
  }

  /** A tappable bit of text that is not rendered through <Button>. */
  tap(text: string): Locator {
    return this.page.getByText(text, { exact: true }).first();
  }

  async expectVisible(text: string) {
    await expect(this.page.getByText(text, { exact: false }).first()).toBeVisible();
  }
}
