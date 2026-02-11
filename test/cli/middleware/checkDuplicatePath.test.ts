import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Hono} from 'hono'
import {checkDuplicatePath} from '../../../src/cli/middleware/checkDuplicatePath.ts'
import type {DiscoveryResult} from '../../../src/cli/middleware/types.ts'

/**
 * Create a mock DiscoveryResult for testing
 */
function createMockDiscovery(options: {
  documents?: Map<
    string,
    {
      path: string
      fsPath: string
      hasTemplate: boolean
      hasSlot: boolean
      templatePath: string | null
      slotPath: string | null
    }
  >
  duplicates?: Map<string, string[]>
  sortedPaths?: string[]
}): DiscoveryResult {
  return {
    documents: options.documents ?? new Map(),
    duplicates: options.duplicates ?? new Map(),
    sortedPaths: options.sortedPaths ?? [],
    errors: [],
  }
}

describe('checkDuplicatePath', () => {
  describe('when path has no duplicates', () => {
    it('should call next() and continue to subsequent handlers', async () => {
      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/about',
            {
              path: '/about',
              fsPath: '/docs/about',
              hasTemplate: false,
              hasSlot: false,
              templatePath: null,
              slotPath: null,
            },
          ],
        ]),
        sortedPaths: ['/about'],
      })

      const app = new Hono()
      let nextHandlerCalled = false

      app.get(
        '/*',
        checkDuplicatePath(() => discovery),
        c => {
          nextHandlerCalled = true
          return c.text('OK')
        },
      )

      const res = await app.request('/about')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'OK')
      assert.strictEqual(nextHandlerCalled, true)
    })
  })

  describe('when path has duplicates', () => {
    it('should return 500 error with duplicate locations', async () => {
      const discovery = createMockDiscovery({
        duplicates: new Map([['/shared-template', ['/docs/page1/template', '/docs/page2/template']]]),
      })

      const app = new Hono()
      let nextHandlerCalled = false

      app.get(
        '/*',
        checkDuplicatePath(() => discovery),
        c => {
          nextHandlerCalled = true
          return c.text('OK')
        },
      )

      const res = await app.request('/shared-template')
      assert.strictEqual(res.status, 500)
      const body = await res.text()
      assert.ok(body.includes('Duplicate document path'))
      assert.ok(body.includes('/shared-template'))
      assert.ok(body.includes('/docs/page1/template'))
      assert.ok(body.includes('/docs/page2/template'))
      assert.strictEqual(nextHandlerCalled, false)
    })

    it('should include helpful error message about unique paths', async () => {
      const discovery = createMockDiscovery({
        duplicates: new Map([['/dupe', ['/loc1', '/loc2']]]),
      })

      const app = new Hono()

      app.get(
        '/*',
        checkDuplicatePath(() => discovery),
      )

      const res = await app.request('/dupe')
      const body = await res.text()
      assert.ok(body.includes('Each document must have a unique path'))
      assert.ok(body.includes('cannot be served as a standalone page'))
    })
  })

  describe('with mutable discovery', () => {
    it('should use the current discovery result on each request', async () => {
      let discovery = createMockDiscovery({})

      const app = new Hono()

      app.get(
        '/*',
        checkDuplicatePath(() => discovery),
        c => c.text('OK'),
      )

      // First request - no duplicates
      const res1 = await app.request('/path')
      assert.strictEqual(res1.status, 200)

      // Mutate discovery to add a duplicate
      discovery = createMockDiscovery({
        duplicates: new Map([['/path', ['/loc1', '/loc2']]]),
      })

      // Second request - now has duplicate
      const res2 = await app.request('/path')
      assert.strictEqual(res2.status, 500)
    })
  })

  describe('with root path', () => {
    it('should check root path for duplicates', async () => {
      const discovery = createMockDiscovery({
        duplicates: new Map([['/', ['/docs/home', '/docs/index']]]),
      })

      const app = new Hono()

      app.get(
        '/*',
        checkDuplicatePath(() => discovery),
      )

      const res = await app.request('/')
      assert.strictEqual(res.status, 500)
      const body = await res.text()
      assert.ok(body.includes('Duplicate document path "/"'))
    })

    it('should pass through root path if no duplicates', async () => {
      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/',
            {path: '/', fsPath: '/docs/home', hasTemplate: false, hasSlot: false, templatePath: null, slotPath: null},
          ],
        ]),
        sortedPaths: ['/'],
      })

      const app = new Hono()

      app.get(
        '/*',
        checkDuplicatePath(() => discovery),
        c => c.text('Root OK'),
      )

      const res = await app.request('/')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'Root OK')
    })
  })
})
