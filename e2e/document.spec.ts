import {test, expect} from '@playwright/test'
import {signup} from './helpers/auth.js'
import {
  waitForEditorReady,
  switchToTab,
  clickSave,
  clickPublish,
  waitForSaveButtonState,
  setEditorContent,
  getEditorContent,
} from './helpers/editor.js'

test.describe('Document CRUD', () => {
  test.describe('Create Document', () => {
    test('should create a new document with content', async ({page}) => {
      const testUsername = `doc-create-${Date.now()}`
      const testPassword = 'test-password-123'
      const testPath = `/playwright-doc-${Date.now()}`
      const editPath = `${testPath}/edit`

      await signup(page, testUsername, testPassword, testPassword, editPath)
      await waitForEditorReady(page)

      // Add content to the document
      await switchToTab(page, 'content')
      await page.waitForTimeout(500)

      const editorPanel = page.locator('#content-editor-panel')
      await editorPanel.click()
      await page.keyboard.type('# Test Document\n\nThis is test content.')

      // Save the document
      await waitForSaveButtonState(page, true)
      await clickSave(page)
      await waitForSaveButtonState(page, false)

      // Verify content persists after reload
      await page.reload()
      await waitForEditorReady(page)
      await switchToTab(page, 'content')

      const content = await getEditorContent(page, 'content')
      expect(content).toContain('# Test Document')
    })

    test('should create document with title', async ({page}) => {
      const testUsername = `doc-title-${Date.now()}`
      const testPassword = 'test-password-123'
      const testPath = `/playwright-title-${Date.now()}`
      const editPath = `${testPath}/edit`

      await signup(page, testUsername, testPassword, testPassword, editPath)
      await waitForEditorReady(page)

      // Set title in settings tab
      await switchToTab(page, 'settings')
      const titleInput = page.locator('#title-input')
      await titleInput.fill('My Test Document Title')

      // Save
      await waitForSaveButtonState(page, true)
      await clickSave(page)
      await waitForSaveButtonState(page, false)

      // Verify title persists
      await page.reload()
      await waitForEditorReady(page)
      await switchToTab(page, 'settings')
      await expect(page.locator('#title-input')).toHaveValue('My Test Document Title')
    })
  })

  test.describe('Read Document', () => {
    test('should display published document to anonymous users', async ({page}) => {
      const testUsername = `doc-read-${Date.now()}`
      const testPassword = 'test-password-123'
      const testPath = `/playwright-read-${Date.now()}`
      const editPath = `${testPath}/edit`

      // Create and publish document
      await signup(page, testUsername, testPassword, testPassword, editPath)
      await waitForEditorReady(page)

      await switchToTab(page, 'content')
      await page.waitForTimeout(500)

      const editorPanel = page.locator('#content-editor-panel')
      await editorPanel.click()
      await page.keyboard.type('# Published Content\n\nThis content is public.')

      await waitForSaveButtonState(page, true)
      await clickSave(page)
      await waitForSaveButtonState(page, false)

      // Publish the document
      await clickPublish(page)
      await page.waitForTimeout(1000)

      // Visit as anonymous user (new context)
      const response = await page.request.get(testPath)
      expect(response.status()).toBe(200)

      const html = await response.text()
      expect(html).toContain('Published Content')
    })

    test('should hide unpublished document from anonymous users', async ({page, request}) => {
      const testUsername = `doc-unpub-${Date.now()}`
      const testPassword = 'test-password-123'
      const testPath = `/playwright-unpub-${Date.now()}`
      const editPath = `${testPath}/edit`

      // Create document but don't publish
      await signup(page, testUsername, testPassword, testPassword, editPath)
      await waitForEditorReady(page)

      await switchToTab(page, 'content')
      await page.waitForTimeout(500)

      const editorPanel = page.locator('#content-editor-panel')
      await editorPanel.click()
      await page.keyboard.type('# Private Content')

      await waitForSaveButtonState(page, true)
      await clickSave(page)
      await waitForSaveButtonState(page, false)

      // Try to access as truly anonymous (fresh request context without cookies)
      const baseUrl = page.url().split('/').slice(0, 3).join('/')
      const response = await request.get(`${baseUrl}${testPath}`)
      // Should return 404 for unpublished content
      expect(response.status()).toBe(404)
    })
  })

  test.describe('Update Document', () => {
    test('should update document slug', async ({page}) => {
      const testUsername = `doc-update-${Date.now()}`
      const testPassword = 'test-password-123'
      const originalPath = `/playwright-original-${Date.now()}`
      const newPath = `/playwright-renamed-${Date.now()}`
      const editPath = `${originalPath}/edit`

      await signup(page, testUsername, testPassword, testPassword, editPath)
      await waitForEditorReady(page)

      // Change the slug
      const slugInput = page.locator('#slug')
      await slugInput.fill(newPath)

      // Save
      await waitForSaveButtonState(page, true)
      await clickSave(page)

      // Wait for redirect to new path
      await page.waitForURL(new RegExp(`${newPath}/edit`), {timeout: 10000})

      // Verify new slug is set
      await expect(page.locator('#slug')).toHaveValue(newPath)
    })

    test('should update document content', async ({page}) => {
      const testUsername = `doc-content-${Date.now()}`
      const testPassword = 'test-password-123'
      const testPath = `/playwright-content-${Date.now()}`
      const editPath = `${testPath}/edit`

      await signup(page, testUsername, testPassword, testPassword, editPath)
      await waitForEditorReady(page)

      // Add initial content
      await switchToTab(page, 'content')
      await page.waitForTimeout(500)

      const editorPanel = page.locator('#content-editor-panel')
      await editorPanel.click()
      await page.keyboard.type('Initial content')

      await waitForSaveButtonState(page, true)
      await clickSave(page)
      await waitForSaveButtonState(page, false)

      // Update content using the helper
      await setEditorContent(page, 'content', 'Updated content')

      await waitForSaveButtonState(page, true)
      await clickSave(page)
      await waitForSaveButtonState(page, false)

      // Verify update
      await page.reload()
      await waitForEditorReady(page)
      await switchToTab(page, 'content')

      const content = await getEditorContent(page, 'content')
      expect(content).toContain('Updated content')
      expect(content).not.toContain('Initial content')
    })
  })

  test.describe('Delete Document', () => {
    test('should delete document via API', async ({page}) => {
      const testUsername = `doc-delete-${Date.now()}`
      const testPassword = 'test-password-123'
      const testPath = `/playwright-delete-${Date.now()}`
      const editPath = `${testPath}/edit`

      // Create document
      await signup(page, testUsername, testPassword, testPassword, editPath)
      await waitForEditorReady(page)

      await switchToTab(page, 'content')
      await page.waitForTimeout(500)

      const editorPanel = page.locator('#content-editor-panel')
      await editorPanel.click()
      await page.keyboard.type('Content to delete')

      await waitForSaveButtonState(page, true)
      await clickSave(page)
      await waitForSaveButtonState(page, false)
      await clickPublish(page)
      await page.waitForTimeout(500)

      // Verify document exists
      const beforeDelete = await page.request.get(testPath)
      expect(beforeDelete.status()).toBe(200)

      // Delete via API (using the existing session)
      // The delete endpoint returns a 302 redirect on success
      const deleteResponse = await page.request.delete(`${editPath}?remove=true`, {
        maxRedirects: 0, // Don't follow redirects to check the actual response
      })
      expect(deleteResponse.status()).toBe(302)

      // Verify document no longer exists
      const afterDelete = await page.request.get(testPath)
      expect(afterDelete.status()).toBe(404)
    })
  })
})
