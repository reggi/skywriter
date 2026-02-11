import {Page} from '@playwright/test'

/**
 * Helper function to login via the login page
 * @param page Playwright page instance
 * @param username Username to login with
 * @param password Password to login with
 * @param editPath The edit path to login to (default: '/edit')
 */
export async function login(page: Page, username: string, password: string, editPath: string = '/edit'): Promise<void> {
  await page.goto(editPath)

  // Wait for login form (it has specific IDs)
  await page.waitForSelector('#login-username')
  await page.waitForSelector('#login-password')

  // Fill in login form fields
  await page.fill('#login-username', username)
  await page.fill('#login-password', password)

  // Submit the login form (it has action="login" hidden input)
  const loginForm = page.locator('form').filter({has: page.locator('input[name="action"][value="login"]')})
  await Promise.all([
    page.waitForNavigation({
      url: new RegExp(`${editPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\?.*)?$`),
      timeout: 10000,
    }),
    loginForm.locator('button[type="submit"]').click(),
  ])
}

/**
 * Helper function to signup a new user
 * @param page Playwright page instance
 * @param username Username to signup with
 * @param password Password to signup with
 * @param passwordConfirm Password confirmation
 * @param editPath The edit path to signup for (default: '/edit')
 */
export async function signup(
  page: Page,
  username: string,
  password: string,
  passwordConfirm: string,
  editPath: string = '/edit',
): Promise<void> {
  await page.goto(editPath)

  // Wait for page to load
  await page.waitForSelector('#login-username', {timeout: 10000})

  // Check if signup form is available (it's conditionally rendered)
  const signupFormExists = (await page.locator('#signup-username').count()) > 0

  if (!signupFormExists) {
    throw new Error('Signup form is not available. Make sure ALLOW_SIGNUP=true is set in your environment variables.')
  }

  // Wait for signup form fields to be visible
  await page.waitForSelector('#signup-username', {state: 'visible'})
  await page.waitForSelector('#signup-password', {state: 'visible'})
  await page.waitForSelector('#signup-password-confirm', {state: 'visible'})

  // Fill in signup form fields
  await page.fill('#signup-username', username)
  await page.fill('#signup-password', password)
  await page.fill('#signup-password-confirm', passwordConfirm)

  // Submit the signup form (it has action="signup" hidden input)
  const signupForm = page.locator('form').filter({has: page.locator('input[name="action"][value="signup"]')})
  await Promise.all([
    page.waitForNavigation({
      url: new RegExp(`${editPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\?.*)?$`),
      timeout: 10000,
    }),
    signupForm.locator('button[type="submit"]').click(),
  ])
}

/**
 * Helper function to check if user is logged in
 * @param page Playwright page instance
 * @returns true if logged in, false otherwise
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  // If login form is visible, we're not logged in
  if ((await page.locator('#login-username').count()) > 0) {
    return false
  }

  // Check if we can see editor elements (indicating we're logged in)
  // Use #slug since it's always visible in the header (unlike #title-input which is only on settings tab)
  const editorElements = await page.locator('#slug, #save-btn').count()
  return editorElements > 0
}
