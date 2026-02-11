# End-to-End Tests

This directory contains Playwright end-to-end tests for the frontend editor behavior.

## Setup

1. Install dependencies (including Playwright):

   ```bash
   npm install
   ```

2. Install Playwright browsers:

   ```bash
   npx playwright install
   ```

3. Make sure your database is running:

   ```bash
   npm run db:up
   npm run migrate:up
   ```

4. Build the editor bundle:
   ```bash
   npm run build:editor
   ```

## Running Tests

### Run all tests

```bash
npm run test:e2e
```

### Run tests in UI mode (interactive)

```bash
npm run test:e2e:ui
```

### Run tests in headed mode (see browser)

```bash
npm run test:e2e:headed
```

### Debug tests

```bash
npm run test:e2e:debug
```

### View test report

```bash
npm run test:e2e:report
```

### Run specific test file

```bash
npx playwright test e2e/editor.spec.ts
```

### Run tests in a specific browser

```bash
npx playwright test --project=chromium
```

## Test Structure

- `e2e/helpers/` - Helper utilities for common test operations
  - `auth.ts` - Authentication helpers (login, signup, etc.)
  - `editor.ts` - Editor interaction helpers (tabs, content editing, etc.)
- `e2e/*.spec.ts` - Test specification files
  - `auth.spec.ts` - Authentication flow tests
  - `editor.spec.ts` - Editor functionality tests

## Writing Tests

### Example Test

```typescript
import {test, expect} from '@playwright/test'
import {login} from './helpers/auth'
import {waitForEditorReady, switchToTab} from './helpers/editor'

test('my test', async ({page}) => {
  // Login
  await login(page, 'username', 'password', '/edit')
  await waitForEditorReady(page)

  // Interact with editor
  await switchToTab(page, 'content')

  // Assert
  await expect(page.locator('#title-input')).toBeVisible()
})
```

### Helper Functions

The test helpers provide common operations:

**Auth Helpers:**

- `login(page, username, password, editPath)` - Login to the editor
- `signup(page, username, password, passwordConfirm, editPath)` - Signup a new user
- `isLoggedIn(page)` - Check if user is logged in

**Editor Helpers:**

- `waitForEditorReady(page)` - Wait for editor to initialize
- `switchToTab(page, tabName)` - Switch to a specific tab
- `getEditorContent(page, editorId)` - Get editor content
- `setEditorContent(page, editorId, content)` - Set editor content
- `clickSave(page)` - Click the save button
- `clickPublish(page)` - Click the publish button
- `waitForSaveButtonState(page, enabled)` - Wait for save button state

## Configuration

Test configuration is in `playwright.config.ts`. Key settings:

- **Base URL**: `http://localhost:3000` (configurable via `PLAYWRIGHT_BASE_URL` env var)
- **Web Server**: Automatically starts the dev server before tests
- **Browsers**: Tests run on Chromium, Firefox, and WebKit by default
- **Retries**: 2 retries on CI, 0 locally

## CI/CD

The tests are configured to:

- Run in parallel on CI
- Retry failed tests twice
- Generate HTML reports
- Take screenshots on failure
- Record traces for failed tests

## Troubleshooting

### Tests fail with "Server not ready"

- Make sure the database is running: `npm run db:up`
- Make sure migrations are up to date: `npm run migrate:up`
- Check that port 3000 is not in use

### Tests fail with "Editor not ready"

- Make sure the editor bundle is built: `npm run build:editor`
- Check browser console for JavaScript errors

### Authentication issues

- Tests create unique users for each run (using timestamps)
- Make sure signup is enabled in your environment
