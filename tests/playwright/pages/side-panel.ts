import { setupSidePanel } from '../helpers/setup';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export class SidePanelPage {
  constructor(
    private page: Page,
    private extensionId: string,
  ) {}

  /** Navigate to the side panel and wait for the Chat UI to be ready. */
  async navigate() {
    await setupSidePanel(this.page, this.extensionId);
  }

  /** Wait for the chat UI elements to be present. */
  async waitForLoad() {
    // Chat header should be present — look for the user-menu button or Toggle sidebar button
    await expect(
      this.page.locator('[data-testid="user-menu-button"], button[title="Toggle sidebar"]').first(),
    ).toBeVisible({ timeout: 10000 });
  }

  /** Locate the "New Session" button in the header. */
  getNewSessionButton(): Locator {
    // The header button has a PlusIcon and "New Session" text (sr-only on xs, visible on sm+)
    return this.page.locator('header button', { hasText: 'New Session' });
  }

  /** Click the hamburger menu to open sidebar. */
  async openSidebar() {
    await this.page.locator('button[title="Toggle sidebar"]').click();
    // Wait for sidebar animation to settle
    await this.page.waitForTimeout(300);
  }

  /** Get all session items in the sidebar list. */
  getSidebarSessionList(): Locator {
    return this.page.locator('button.min-w-0');
  }

  /** Click a specific session in the sidebar by title text. */
  async clickSession(title: string) {
    await this.page.locator('button.min-w-0', { hasText: title }).click();
  }

  /** Delete a session from the sidebar by hovering and clicking trash. */
  async deleteSession(title: string) {
    const row = this.page
      .locator('div', { hasText: title })
      .filter({ has: this.page.locator('button.min-w-0') });
    await row.hover();
    await row.locator('button:has(svg)').last().click();
    // Confirm deletion in the alert dialog
    await this.page.locator('button', { hasText: 'Delete' }).click();
  }

  /** Get all message elements in the chat area. */
  getMessages(): Locator {
    return this.page.locator('[data-role="user"], [data-role="assistant"]');
  }

  /** Get the current session/chat title text from the header. */
  async getChatTitle(): Promise<string | null> {
    const titleEl = this.page.locator('header span.truncate');
    if (await titleEl.isVisible()) {
      return titleEl.textContent();
    }
    return null;
  }

  /** Type in the chat input and submit. */
  async sendMessage(text: string) {
    const input = this.page.locator('textarea').last();
    await input.fill(text);
    await input.press('Enter');
  }

  /** Wait for an assistant message to appear. */
  async waitForResponse(timeout = 30_000) {
    await this.page.waitForSelector('[data-role="assistant"]', { timeout });
  }
}
