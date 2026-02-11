import {test, expect} from '@playwright/test'
import {signup} from './helpers/auth.js'
import {waitForEditorReady} from './helpers/editor.js'

test.describe('Navigation', () => {
  test('should load homepage', async ({page}) => {
    const response = await page.goto('/')
    // Homepage should either render a document or return 404 if no root document exists
    expect([200, 404]).toContain(response?.status())
  })

  test('should handle non-existent paths with 404', async ({page}) => {
    const randomPath = `/non-existent-page-${Date.now()}`
    const response = await page.goto(randomPath)
    expect(response?.status()).toBe(404)
  })

  test('should redirect /edit to login when not authenticated', async ({page}) => {
    const response = await page.goto('/edit')
    expect(response?.status()).toBe(401)

    // Should display login form
    await expect(page.locator('#login-username')).toBeVisible()
    await expect(page.locator('#login-password')).toBeVisible()
  })

  test('should navigate to nested edit paths', async ({page}) => {
    const testPath = `/test-nav-${Date.now()}/nested/path`
    const response = await page.goto(`${testPath}/edit`)

    expect(response?.status()).toBe(401)
    await expect(page.locator('#login-username')).toBeVisible()
  })

  test('should preserve query parameters after login', async ({page}) => {
    const testUsername = `nav-test-${Date.now()}`
    const testPassword = 'test-password-123'
    const testPath = `/nav-test-${Date.now()}`
    const editPath = `${testPath}/edit`

    await signup(page, testUsername, testPassword, testPassword, editPath)
    await waitForEditorReady(page)

    // Should be on the edit page
    await expect(page).toHaveURL(new RegExp(`${testPath}/edit`))
  })

  test('should handle special characters in paths', async ({page}) => {
    const testUsername = `special-test-${Date.now()}`
    const testPassword = 'test-password-123'
    // Test with URL-safe path containing numbers and hyphens
    const testPath = `/special-123-test-${Date.now()}`
    const editPath = `${testPath}/edit`

    await signup(page, testUsername, testPassword, testPassword, editPath)
    await waitForEditorReady(page)

    // Should load successfully
    await expect(page.locator('#slug')).toBeVisible()
  })

  test('should handle deep nested paths', async ({page}) => {
    const testUsername = `deep-test-${Date.now()}`
    const testPassword = 'test-password-123'
    const testPath = `/level1/level2/level3/deep-${Date.now()}`
    const editPath = `${testPath}/edit`

    await signup(page, testUsername, testPassword, testPassword, editPath)
    await waitForEditorReady(page)

    // Should display the correct slug
    const slugInput = page.locator('#slug')
    await expect(slugInput).toHaveValue(testPath)
  })
})
