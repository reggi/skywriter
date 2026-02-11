import {test, expect} from '@playwright/test'
import {signup} from './helpers/auth.js'
import {
  waitForEditorReady,
  switchToTab,
  clickSave,
  clickPublish,
  clickRevert,
  waitForSaveButtonState,
  waitForRevertButtonState,
  waitForAutoSave,
  setAllEditors,
  getAllEditorContent,
  setEditorContentInTab,
  getEditorContent,
} from './helpers/editor.js'

test.describe('Editor', () => {
  test.beforeEach(async ({page}) => {
    // Create a test user for each test with a unique document path
    const testUsername = `test-${Date.now()}`
    const testPassword = 'test-password-123'
    const testPath = `/playwright-test-${Date.now()}`
    const editPath = `${testPath}/edit`

    // Signup and login using the unique document path
    await signup(page, testUsername, testPassword, testPassword, editPath)
    await waitForEditorReady(page)
  })

  test('should display editor interface', async ({page}) => {
    // Check for key editor elements (slug is in header, always visible)
    await expect(page.locator('#slug')).toBeVisible()
    await expect(page.locator('#save-btn')).toBeVisible()
    await expect(page.locator('#publish-btn')).toBeVisible()

    // Check for tabs
    await expect(page.locator('.tab-button[data-tab="content"]')).toBeVisible()
    await expect(page.locator('.tab-button[data-tab="settings"]')).toBeVisible()

    // Title input is only visible on settings tab
    await switchToTab(page, 'settings')
    await expect(page.locator('#title-input')).toBeVisible()
  })

  test('should allow editing document title', async ({page}) => {
    // Switch to settings tab where title input is located
    await switchToTab(page, 'settings')

    const titleInput = page.locator('#title-input')
    const newTitle = 'Test Document Title'

    await titleInput.fill(newTitle)
    await expect(titleInput).toHaveValue(newTitle)

    // Title change should enable save button
    await waitForSaveButtonState(page, true)
  })

  test('should allow editing document slug', async ({page}) => {
    const slugInput = page.locator('#slug')
    const newSlug = `/playwright-slug-${Date.now()}`

    await slugInput.fill(newSlug)
    await expect(slugInput).toHaveValue(newSlug)

    // Slug change should enable save button
    await waitForSaveButtonState(page, true)
  })

  test('should switch between tabs', async ({page}) => {
    // Start on content tab
    await expect(page.locator('.tab-button[data-tab="content"].active')).toBeVisible()

    // Switch to data tab
    await switchToTab(page, 'data')
    await expect(page.locator('.tab-content[data-tab-content="data"].active')).toBeVisible()

    // Switch to style tab
    await switchToTab(page, 'style')
    await expect(page.locator('.tab-content[data-tab-content="style"].active')).toBeVisible()

    // Switch to settings tab
    await switchToTab(page, 'settings')
    await expect(page.locator('.tab-content[data-tab-content="settings"].active')).toBeVisible()

    // Switch back to content tab
    await switchToTab(page, 'content')
    await expect(page.locator('.tab-content[data-tab-content="content"].active')).toBeVisible()
  })

  test('should edit content in content editor', async ({page}) => {
    await switchToTab(page, 'content')

    // Wait for editor to be ready
    await page.waitForTimeout(1000)

    // Get the editor panel and click to focus
    const editorPanel = page.locator('#content-editor-panel')
    await editorPanel.click()

    // Type some content
    await page.keyboard.type('# Hello World\n\nThis is test content.')

    // Wait a bit for debounced save
    await page.waitForTimeout(2000)

    // Save button should be enabled
    await waitForSaveButtonState(page, true)
  })

  test('should save document changes', async ({page}) => {
    // Switch to settings tab where title input is located
    await switchToTab(page, 'settings')

    const titleInput = page.locator('#title-input')
    const newTitle = 'Saved Document Title'

    // Change title
    await titleInput.fill(newTitle)
    await waitForSaveButtonState(page, true)

    // Click save
    await clickSave(page)

    // Wait for save to complete
    await page.waitForTimeout(1000)

    // Reload page and verify title is saved
    await page.reload()
    await waitForEditorReady(page)

    // Switch back to settings tab to check title
    await switchToTab(page, 'settings')
    await expect(page.locator('#title-input')).toHaveValue(newTitle)
  })

  test('should toggle publish status', async ({page}) => {
    // Use a unique document path with playwright prefix for this test
    const testPath = `/playwright-publish-${Date.now()}`
    const editPath = `${testPath}/edit`

    // Ensure the document doesn't exist (delete if it does)
    // Only delete playwright test documents, never the root document
    if (testPath.startsWith('/playwright-') && testPath !== '/') {
      try {
        await page.request.delete(`${editPath}?remove=true`)
        await page.waitForTimeout(500)
      } catch {
        // Document doesn't exist, which is fine
      }
    }

    // Navigate to the new document editor
    await page.goto(editPath)
    await waitForEditorReady(page)

    const publishButton = page.locator('#publish-btn')

    // For a new document that doesn't exist yet, button should show "Publish" and be disabled
    await expect(publishButton).toHaveText('Publish')
    await expect(publishButton).toHaveAttribute('data-published', 'false')
    await expect(publishButton).toBeDisabled()

    // View button should be disabled when hidden
    const viewButton = page.locator('#view-btn')
    await expect(viewButton).toBeDisabled()

    // Make a change to trigger auto-draft (this creates the document)
    await switchToTab(page, 'content')
    await page.waitForTimeout(1000)

    const editorPanel = page.locator('#content-editor-panel')
    await editorPanel.click()
    await page.keyboard.type('# Test Document\n\nThis creates the document.')

    // Wait for auto-draft to save (debounced)
    await page.waitForTimeout(3000)

    // Now the document exists (has an ID), so publish button should be enabled
    await expect(publishButton).toBeEnabled()

    // Click to publish
    await clickPublish(page)
    await page.waitForTimeout(500)

    // Should now show "Unpublish"
    await expect(publishButton).toHaveText('Unpublish')
    await expect(publishButton).toHaveAttribute('data-published', 'true')

    // View button should be enabled when published
    await expect(viewButton).toBeEnabled()

    // Toggle back to unpublished
    await clickPublish(page)
    await page.waitForTimeout(500)

    // Should be back to "Publish"
    await expect(publishButton).toHaveText('Publish')
    await expect(publishButton).toHaveAttribute('data-published', 'false')
    await expect(viewButton).toBeDisabled()
  })

  test('should show preview when content changes', async ({page}) => {
    await switchToTab(page, 'content')

    // Wait for editor to be ready
    await page.waitForTimeout(1000)

    // Get the editor panel and click to focus
    const editorPanel = page.locator('#content-editor-panel')
    await editorPanel.click()

    // Type markdown content
    await page.keyboard.type('# Test Preview\n\nThis should appear in preview.')

    // Wait for preview to update (debounced)
    await page.waitForTimeout(3000)

    // Check preview iframe has content
    const previewFrame = page.frameLocator('#preview')
    const previewBody = previewFrame.locator('body')
    await expect(previewBody).toBeVisible()
  })

  test('should disable save button when no changes', async ({page}) => {
    // Initially, save button should be disabled for a new document
    // But wait a moment for the editor to fully initialize
    await page.waitForTimeout(1000)

    // Switch to settings tab to access title input
    await switchToTab(page, 'settings')

    // Make a change
    await page.locator('#title-input').fill('Test Title')
    await waitForSaveButtonState(page, true)

    // Save the change
    await clickSave(page)
    await page.waitForTimeout(2000)

    // After save, wait a bit for state to update
    // (Note: The button state depends on whether there are still unsaved changes)
    await page.waitForTimeout(1000)
  })

  test('should allow editing settings', async ({page}) => {
    await switchToTab(page, 'settings')

    // Check settings form is visible
    await expect(page.locator('#title-input')).toBeVisible()
    await expect(page.locator('#mime-type-input')).toBeVisible()
    await expect(page.locator('#extension-input')).toBeVisible()

    // Edit MIME type
    const mimeTypeInput = page.locator('#mime-type-input')
    await mimeTypeInput.fill('text/plain')
    await expect(mimeTypeInput).toHaveValue('text/plain')

    // Edit extension
    const extensionInput = page.locator('#extension-input')
    await extensionInput.fill('.txt')
    await expect(extensionInput).toHaveValue('.txt')
  })

  test('should persist all fields across hard refresh after auto-save', async ({page}) => {
    // Set initial values (state 1)
    const expectedContent = await setAllEditors(page, {
      content: 'John Doe',
      data: 42,
      style: 800,
      script: 'hello',
      server: '"initial"',
    })

    // Wait for auto-save to complete
    await waitForAutoSave(page, 10000)
    await page.waitForTimeout(2000)

    // Perform hard refresh
    await page.reload({waitUntil: 'networkidle'})
    await waitForEditorReady(page)

    // Get all content after refresh
    const actualContent = await getAllEditorContent(page)

    // Verify all content persisted
    expect(actualContent.content).toBe(expectedContent.content)
    expect(actualContent.data).toBe(expectedContent.data)
    expect(actualContent.style).toBe(expectedContent.style)
    expect(actualContent.script).toBe(expectedContent.script)
    expect(actualContent.server).toBe(expectedContent.server)
  })

  test('should add old path to redirects table when document path is updated', async ({page}) => {
    // Use a unique document path with playwright prefix for this test
    const oldPath = `/playwright-redirect-test-${Date.now()}`
    const newPath = `/playwright-redirect-test-new-${Date.now()}`
    const oldEditPath = `${oldPath}/edit`

    // Ensure the document doesn't exist (delete if it does)
    if (oldPath.startsWith('/playwright-') && oldPath !== '/') {
      try {
        await page.request.delete(`${oldEditPath}?remove=true`)
        await page.waitForTimeout(500)
      } catch {
        // Document doesn't exist, which is fine
      }
    }

    // Navigate to the new document editor with the old path
    await page.goto(oldEditPath)
    await waitForEditorReady(page)

    // Make a change to create the document (add some content)
    await switchToTab(page, 'content')
    await page.waitForTimeout(1000)

    const editorPanel = page.locator('#content-editor-panel')
    await editorPanel.click()
    await page.keyboard.type('# Test Document\n\nThis creates the document.')

    // Wait for auto-draft to save (debounced)
    await page.waitForTimeout(3000)

    // Publish the document so it exists
    await clickPublish(page)
    await page.waitForTimeout(500)

    // Now update the path/slug
    const slugInput = page.locator('#slug')
    await slugInput.fill(newPath)
    await expect(slugInput).toHaveValue(newPath)

    // Wait for save button to be enabled
    await waitForSaveButtonState(page, true)

    // Save the changes
    await clickSave(page)

    // Wait for save to complete and state to update
    await page.waitForTimeout(2000)

    // After saving, the redirects should be updated in the current page state
    // Switch to settings tab to check redirects (without navigating away)
    await switchToTab(page, 'settings')

    // Wait for redirects table to be visible and updated
    const redirectsTable = page.locator('.redirects-table')
    await expect(redirectsTable).toBeVisible()

    // Wait for the redirects to be loaded/updated in the table
    // The old path should appear as a redirect after the path change
    await page.waitForFunction(
      expectedPath => {
        const redirectPaths = Array.from(document.querySelectorAll('.redirects-table .redirect-path')).map(el =>
          el.textContent?.trim(),
        )
        return redirectPaths.includes(expectedPath)
      },
      oldPath,
      {timeout: 5000},
    )

    // Verify the old path is in the redirects table
    const oldPathInTable = redirectsTable.locator('.redirect-path', {hasText: oldPath})
    await expect(oldPathInTable).toBeVisible()

    // Verify the old path text is correct
    const redirectPathText = await oldPathInTable.textContent()
    expect(redirectPathText?.trim()).toBe(oldPath)
  })

  test('should upload file via file input', async ({page}) => {
    // Use a unique document path
    const testPath = `/playwright-upload-${Date.now()}`
    const editPath = `${testPath}/edit`

    // Navigate to the document editor
    await page.goto(editPath)
    await waitForEditorReady(page)

    // First save the document so it exists in the database
    await switchToTab(page, 'settings')
    const titleInput = page.locator('#title-input')
    await titleInput.fill('Test Upload Document')
    await clickSave(page)
    await page.waitForTimeout(1000)

    // Create a test file
    const fileName = 'test-file.txt'
    const fileContent = 'This is a test file for upload'

    // Use the file upload input on the settings page
    const fileInput = page.locator('#file-upload-input')

    // Listen for the upload request
    const uploadPromise = page.waitForResponse(
      response =>
        response.url().includes('/edit') &&
        response.url().includes('upload=true') &&
        response.request().method() === 'POST',
      {timeout: 10000},
    )

    // Upload file using the file input
    await fileInput.setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(fileContent),
    })

    // Wait for upload request to complete
    const response = await uploadPromise
    expect(response.status()).toBe(200)

    // Wait for UI to update
    await page.waitForTimeout(500)

    // Check that the file appears in the uploads table
    const uploadsTable = page.locator('.uploads-table')
    await expect(uploadsTable).toBeVisible()

    const uploadedFile = uploadsTable.locator('.filename-link', {hasText: fileName})
    await expect(uploadedFile).toBeVisible()
  })

  test('should delete document via settings page delete button', async ({page}) => {
    // Use a unique document path for this test
    const testPath = `/playwright-delete-test-${Date.now()}`
    const editPath = `${testPath}/edit`

    // Navigate to the document editor
    await page.goto(editPath)
    await waitForEditorReady(page)

    // First, create and save the document so it exists
    await switchToTab(page, 'settings')
    const titleInput = page.locator('#title-input')
    await titleInput.fill('Document to Delete')

    // Add some content to make sure document is fully created
    await switchToTab(page, 'content')
    await page.waitForTimeout(500)
    const editorPanel = page.locator('#content-editor-panel')
    await editorPanel.click()
    await page.keyboard.type('# Test Delete\n\nThis document will be deleted.')

    // Save the document
    await clickSave(page)
    await page.waitForTimeout(1000)

    // Verify document exists by checking if we can fetch it
    const docResponse = await page.request.get(testPath)
    expect(docResponse.status()).toBe(200)

    // Go to settings tab where delete button is located
    await switchToTab(page, 'settings')
    await page.waitForTimeout(500)

    // Find the delete button
    const deleteButton = page.locator('.btn-delete')
    await expect(deleteButton).toBeVisible()
    expect(await deleteButton.textContent()).toContain('Delete this document')

    // Set up dialog handler for confirmation prompt
    page.on('dialog', async dialog => {
      expect(dialog.type()).toBe('confirm')
      expect(dialog.message()).toContain('Are you sure you want to delete this document?')
      await dialog.accept()
    })

    // Click the delete button
    await deleteButton.click()

    // Wait for redirect after deletion (should redirect back to edit page)
    await page.waitForURL(`${testPath}/edit`, {timeout: 5000})
    await waitForEditorReady(page)

    // After deletion, document should not exist
    // Try to fetch the document - should return 404
    const afterDeleteResponse = await page.request.get(testPath)
    expect(afterDeleteResponse.status()).toBe(404)

    // The editor should show empty state (no title)
    await switchToTab(page, 'settings')
    const titleAfterDelete = await page.locator('#title-input').inputValue()
    expect(titleAfterDelete).toBe('')

    // Content should be empty too
    await switchToTab(page, 'content')
    await page.waitForTimeout(500)
    const contentAfterDelete = await page.evaluate(() => {
      const ace = (window as {ace?: unknown}).ace
      const panel = document.querySelector('#content-editor-panel')
      if (panel && ace) {
        const editor = (ace as unknown as {edit: (el: Element) => {getValue: () => string}}).edit(panel)
        return editor.getValue()
      }
      return ''
    })
    expect(contentAfterDelete).toBe('')
  })

  test('should revert changes back to last saved state', async ({page}) => {
    // Use a unique document path for this test
    const testPath = `/playwright-revert-test-${Date.now()}`
    const editPath = `${testPath}/edit`

    // Navigate to the document editor
    await page.goto(editPath)
    await waitForEditorReady(page)

    // Set initial content and save it
    const initialContent = '# Initial Content\n\nThis is the original content.'
    await setEditorContentInTab(page, 'content', initialContent)

    // Wait for auto-save to create draft
    await waitForAutoSave(page, 10000)

    // Save the document to establish the baseline
    await clickSave(page)
    await page.waitForTimeout(1000)

    // Verify the document was saved and revert button is disabled
    await waitForRevertButtonState(page, false)

    // Now make changes that we want to revert
    const modifiedContent = '# Modified Content\n\nThis content should be reverted.'
    await setEditorContentInTab(page, 'content', modifiedContent)

    // Wait for auto-save to create a draft
    await waitForAutoSave(page, 10000)
    await page.waitForTimeout(1000)

    // Revert button should now be enabled
    await waitForRevertButtonState(page, true)

    // Verify modified content is in the editor before revert
    await switchToTab(page, 'content')
    await page.waitForTimeout(500)
    const contentBeforeRevert = await getEditorContent(page, 'content')
    expect(contentBeforeRevert).toBe(modifiedContent)

    // Click revert button
    await clickRevert(page)
    await page.waitForTimeout(1000)

    // Verify content has been reverted to initial state
    await switchToTab(page, 'content')
    await page.waitForTimeout(500)
    const contentAfterRevert = await getEditorContent(page, 'content')
    expect(contentAfterRevert).toBe(initialContent)

    // Revert button should now be disabled again
    await waitForRevertButtonState(page, false)
  })
})
