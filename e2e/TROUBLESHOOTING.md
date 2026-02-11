# Troubleshooting Playwright Tests

## Common Issues and Fixes

### 1. Browser Not Installed

**Error:** `Executable doesn't exist at .../chrome-headless-shell`

**Fix:**

```bash
npx playwright install
# Or install just chromium:
npx playwright install chromium
```

### 2. Server Not Starting

**Error:** Tests timeout waiting for server

**Fix:**

- Make sure database is running: `npm run db:up`
- Make sure migrations are up to date: `npm run migrate:up`
- Check that port 3000 is not in use
- Make sure `.env` file exists with correct `DATABASE_URL`

### 3. Editor Bundle Not Built

**Error:** Editor elements not found or JavaScript errors

**Fix:**

```bash
npm run build:editor
```

### 4. Signup Disabled

**Error:** Signup tests fail

**Fix:**

- Check if signup is enabled in your environment
- The tests assume signup is enabled by default
- If signup is disabled, you'll need to manually create test users or modify tests

### 5. Authentication Issues

**Error:** Tests fail on login/signup

**Fixes:**

- Make sure the database has the users table: `npm run migrate:up`
- Check that sessions table exists
- Verify the login form has the correct IDs (`#login-username`, `#login-password`)
- Verify the signup form has the correct IDs (`#signup-username`, `#signup-password`, `#signup-password-confirm`)

### 6. Timing Issues with ACE Editor

**Error:** Editor content not updating or tests timing out

**Fixes:**

- The tests include waits for editor initialization
- If tests are flaky, increase timeout values in `waitForEditorReady`
- ACE editor initialization can take 1-2 seconds

### 7. Save Button State Issues

**Error:** Save button state assertions fail

**Note:**

- The save button state depends on whether there are unsaved changes
- After saving, the button may remain enabled if there are draft changes
- The tests account for this with flexible assertions

### 8. Preview Iframe Not Loading

**Error:** Preview tests fail

**Fixes:**

- Preview updates are debounced (3 second wait in tests)
- Make sure the render endpoint is working
- Check browser console for JavaScript errors

## Running Tests in Debug Mode

To debug failing tests:

```bash
# Run in UI mode (interactive)
npm run test:e2e:ui

# Run in headed mode (see browser)
npm run test:e2e:headed

# Run in debug mode (step through)
npm run test:e2e:debug

# Run specific test file
npx playwright test e2e/editor.spec.ts

# Run specific test
npx playwright test e2e/editor.spec.ts -g "should display editor interface"
```

## Viewing Test Reports

```bash
# View HTML report
npm run test:e2e:report

# Or after running tests
npx playwright show-report
```

## Test Environment Setup

Before running tests, ensure:

1. ✅ Database is running: `npm run db:up`
2. ✅ Migrations are applied: `npm run migrate:up`
3. ✅ Editor bundle is built: `npm run build:editor`
4. ✅ Playwright browsers are installed: `npx playwright install`
5. ✅ `.env` file exists with `DATABASE_URL`

## Known Limitations

- Tests create unique users for each run (using timestamps)
- Tests assume signup is enabled
- Some tests may be flaky if server is slow to respond
- ACE editor initialization timing can vary
