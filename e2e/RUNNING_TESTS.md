# Running Tests One at a Time

## Run a Single Test

To run just one specific test:

```bash
# Run a specific test by name
npx playwright test --grep "should display editor interface"

# Run a specific test file
npx playwright test e2e/auth.spec.ts

# Run a specific test in a file
npx playwright test e2e/auth.spec.ts -g "should redirect to login"
```

## Run Tests Sequentially

The config is now set to run tests one at a time (not in parallel). Just run:

```bash
npm run test:e2e
```

This will run all tests, but one after another, making it easier to see what's failing.

## Run in Debug Mode

For step-by-step debugging:

```bash
# Interactive UI mode (best for debugging)
npm run test:e2e:ui

# Or headed mode to see the browser
npm run test:e2e:headed

# Or debug mode with breakpoints
npm run test:e2e:debug
```

## Run Only One Test File

```bash
# Just auth tests
npx playwright test e2e/auth.spec.ts

# Just editor tests
npx playwright test e2e/editor.spec.ts
```

## Temporarily Skip Tests

You can use `.skip()` to skip tests while debugging:

```typescript
test.skip('should do something', async ({page}) => {
  // This test will be skipped
})
```

Or use `.only()` to run just one test:

```typescript
test.only('should do something', async ({page}) => {
  // Only this test will run
})
```
