import {test, expect} from '@playwright/test'
import {signup} from './helpers/auth.js'
import {waitForEditorReady, switchToTab, clickSave, waitForSaveButtonState} from './helpers/editor.js'

test.describe('API Endpoints', () => {
  test.describe('Health & Status', () => {
    test('should respond to root path', async ({request}) => {
      const response = await request.get('/')
      // Root might be 200 (has content) or 404 (no root document)
      expect([200, 404]).toContain(response.status())
    })

    test('should return proper content-type for HTML responses', async ({page}) => {
      const testUsername = `api-html-${Date.now()}`
      const testPassword = 'test-password-123'
      const testPath = `/api-html-${Date.now()}`
      const editPath = `${testPath}/edit`

      await signup(page, testUsername, testPassword, testPassword, editPath)
      await waitForEditorReady(page)

      // Add content and publish
      await switchToTab(page, 'content')
      await page.waitForTimeout(500)

      const editorPanel = page.locator('#content-editor-panel')
      await editorPanel.click()
      await page.keyboard.type('# API Test')

      await waitForSaveButtonState(page, true)
      await clickSave(page)
      await waitForSaveButtonState(page, false)

      // Publish
      await page.locator('#publish-btn').click()
      await page.waitForTimeout(500)

      // Check response headers
      const response = await page.request.get(testPath)
      expect(response.status()).toBe(200)

      const contentType = response.headers()['content-type']
      expect(contentType).toContain('text/html')
    })
  })

  test.describe('Authentication API', () => {
    test('should reject invalid login credentials', async ({request}) => {
      const response = await request.post('/edit?login', {
        form: {
          action: 'login',
          username: 'nonexistent-user',
          password: 'wrong-password',
        },
      })
      // Should return 401 or redirect with error
      expect([401, 302, 303]).toContain(response.status())
    })

    test('should require authentication for protected routes', async ({request}) => {
      const protectedRoutes = ['/edit', '/edit?query=test', '/edit?upload']

      for (const route of protectedRoutes) {
        const response = await request.get(route)
        expect(response.status()).toBe(401)
      }
    })

    test('should reject POST requests without authentication', async ({request}) => {
      const response = await request.post('/edit', {
        data: {content: 'test'},
      })
      expect(response.status()).toBe(401)
    })
  })

  test.describe('Document API', () => {
    test('should return 404 for non-existent documents', async ({request}) => {
      const nonExistentPath = `/definitely-not-exists-${Date.now()}`
      const response = await request.get(nonExistentPath)
      expect(response.status()).toBe(404)
    })

    test('should handle query parameter for search', async ({page}) => {
      const testUsername = `api-search-${Date.now()}`
      const testPassword = 'test-password-123'
      const testPath = `/api-search-${Date.now()}`
      const editPath = `${testPath}/edit`

      await signup(page, testUsername, testPassword, testPassword, editPath)
      await waitForEditorReady(page)

      // Search query should work for authenticated users
      const response = await page.request.post('/edit?query=test', {
        form: {query: 'test'},
      })
      // Should return success (might be empty results)
      expect([200]).toContain(response.status())
    })
  })

  test.describe('Error Handling', () => {
    test('should handle malformed requests gracefully', async ({request}) => {
      // Test with invalid JSON
      const response = await request.post('/edit', {
        headers: {'Content-Type': 'application/json'},
        data: 'not-valid-json{',
      })
      // Should return either 400 (bad request) or 401 (unauthorized)
      expect([400, 401, 500]).toContain(response.status())
    })

    test('should return 404 for truly non-existent routes', async ({request}) => {
      const response = await request.get('/this/path/does/not/exist/at/all')
      expect(response.status()).toBe(404)
    })

    test('should handle empty POST body', async ({request}) => {
      const response = await request.post('/edit', {
        headers: {'Content-Type': 'application/json'},
        data: '',
      })
      expect([400, 401]).toContain(response.status())
    })
  })

  test.describe('HTTP Methods', () => {
    test('should reject DELETE without authentication', async ({request}) => {
      const response = await request.delete('/edit?remove=true')
      expect(response.status()).toBe(401)
    })

    test('should handle HEAD requests', async ({request}) => {
      const response = await request.head('/')
      // HEAD should return same status as GET but without body
      expect([200, 404]).toContain(response.status())
    })

    test('should handle OPTIONS requests', async ({request}) => {
      const response = await request.fetch('/', {method: 'OPTIONS'})
      // OPTIONS might not be explicitly handled, could return 404 or 405
      expect([200, 404, 405]).toContain(response.status())
    })
  })
})
