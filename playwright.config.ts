import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/playwright/e2e',
  timeout: 30000,
  reporter: 'list',
  use: {
    headless: true,
    channel: 'chromium',
  },
});
