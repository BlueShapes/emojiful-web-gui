import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/workers',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8787', headless: true },
  webServer: {
    command: 'bun run dev:workers',
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
    env: {
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_LOG_PATH: '.work/wrangler',
    },
  },
});
