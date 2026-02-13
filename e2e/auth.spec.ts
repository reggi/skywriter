import {test, expect} from '@playwright/test'
import {login, signup} from './helpers/auth.js'
import {waitForEditorReady, switchToTab} from './helpers/editor.js'
import {uniqueId} from './helpers/unique-id.js'

test.describe('Authentication', () => {
  test('should render login when accessing /edit without authentication', async ({page}) => {
    const response = await page.goto('/edit')

    expect(response?.status()).toBe(401)
    await expect(page).toHaveURL(/\/edit(?:\?.*)?$/)

    // Should show login form (use specific IDs to avoid matching signup form)
    await expect(page.locator('#login-username')).toBeVisible()
    await expect(page.locator('#login-password')).toBeVisible()
  })

  test('should allow login with valid credentials', async ({page}) => {
    const testUsername = `test-${uniqueId()}`
    const testPassword = 'test-password-123'

    // First signup
    await signup(page, testUsername, testPassword, testPassword, '/edit')
    await waitForEditorReady(page)

    // Logout
    await switchToTab(page, 'settings')
    await page.locator('a.btn-logout, button.btn-logout').first().click()
    await expect(page.locator('#login-username')).toBeVisible()

    // Login again
    await login(page, testUsername, testPassword, '/edit')
    await waitForEditorReady(page)

    // Should be on editor page
    await expect(page).toHaveURL(/\/edit/)
    await expect(page.locator('#slug')).toBeVisible()
  })

  test('should show error with invalid credentials', async ({page}) => {
    const response = await page.goto('/edit')
    expect(response?.status()).toBe(401)

    await page.waitForSelector('#login-username')

    // Try to login with invalid credentials
    await page.fill('#login-username', 'invalid-user')
    await page.fill('#login-password', 'invalid-password')

    // Submit the login form
    const loginForm = page.locator('form').filter({has: page.locator('input[name="action"][value="login"]')})
    await Promise.all([page.waitForNavigation(), loginForm.locator('button[type="submit"]').click()])

    await expect(page).toHaveURL(/\/edit(?:\?.*)?$/)
    await expect(page.locator('.error-message')).toBeVisible()
  })

  test('should allow signup if enabled', async ({page}) => {
    const testUsername = `test-signup-${uniqueId()}`
    const testPassword = 'test-password-123'

    await signup(page, testUsername, testPassword, testPassword, '/edit')

    // Should redirect to editor after signup
    await waitForEditorReady(page)
    await expect(page).toHaveURL(/\/edit/)
    await expect(page.locator('#slug')).toBeVisible()
  })

  test('should maintain session across page reloads', async ({page}) => {
    const testUsername = `test-${uniqueId()}`
    const testPassword = 'test-password-123'

    // Signup and login
    await signup(page, testUsername, testPassword, testPassword, '/edit')
    await waitForEditorReady(page)

    // Reload page
    await page.reload()
    await waitForEditorReady(page)

    // Should still be logged in
    await expect(page.locator('#slug')).toBeVisible()
    await expect(page).toHaveURL(/\/edit/)
  })

  test('should allow logout', async ({page}) => {
    const testUsername = `test-${uniqueId()}`
    const testPassword = 'test-password-123'

    // Signup and login
    await signup(page, testUsername, testPassword, testPassword, '/edit')
    await waitForEditorReady(page)

    // Click logout button
    await switchToTab(page, 'settings')
    const logoutLink = page.locator('a.btn-logout, button.btn-logout').first()
    await logoutLink.click()

    // Should show login page (no redirect)
    await expect(page.locator('#login-username')).toBeVisible()
    await expect(page).toHaveURL(/\/edit(?:\?.*)?$/)
  })
})
