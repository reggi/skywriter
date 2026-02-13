import {defineConfig, devices} from '@playwright/test'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  /* Global setup/teardown to clean up test users */
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  /* Run tests in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Use default workers (half of CPU cores) */
  workers: undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [['list'], ['html']], // Show progress in terminal + HTML report
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  /* For debugging, we'll just use chromium. Uncomment others when ready. */
  projects: [
    {
      name: 'chromium',
      use: {...devices['Desktop Chrome']},
    },

    // Uncomment these when tests are stable:
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'ALLOW_SIGNUP=true SIGNUP_LIMIT=1000 npm run start',
    url: 'http://localhost:3000/edit',
    reuseExistingServer: false,
    timeout: 120 * 1000,
    stdout: 'ignore', // Ignore server stdout to see test output
    stderr: 'pipe', // Keep stderr to see server errors
    env: {
      // Enable signup for tests
      ALLOW_SIGNUP: 'true',
      // Set high signup limit for e2e tests (each test creates a new user)
      SIGNUP_LIMIT: '1000',
      // Explicitly set DATABASE_URL to ensure connection works
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://astrodoc:astrodoc_password@localhost:5455/astrodoc',
    },
  },
})
