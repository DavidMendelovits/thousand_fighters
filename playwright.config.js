import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  timeout: 90_000,
  workers: 1,
  expect: {
    timeout: 15_000,
  },
  webServer: process.env.ADMIN_BASE_URL ? undefined : {
    command:'node tests/fixtures/admin-workbench.mjs',
    url:`http://127.0.0.1:${process.env.TEST_CMS_PORT??8798}/api/status`,
    reuseExistingServer:false,
  },
  use: {
    baseURL: process.env.ADMIN_BASE_URL ?? `http://127.0.0.1:${process.env.TEST_CMS_PORT??8798}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 7'],
      },
    },
  ],
});
