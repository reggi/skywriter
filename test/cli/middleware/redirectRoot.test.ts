import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Hono} from 'hono'
import {redirectRoot} from '../../../src/cli/middleware/redirectRoot.ts'
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

describe('redirectRoot', () => {
  describe('when requesting non-root path', () => {
    it('should call next() and skip redirect', async () => {
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
        redirectRoot(() => discovery),
        c => {
          nextHandlerCalled = true
          return c.text('Handler called')
        },
      )

      const res = await app.request('/about')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'Handler called')
      assert.strictEqual(nextHandlerCalled, true)
    })
  })

  describe('when root document exists', () => {
    it('should call next() and not redirect', async () => {
      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/',
            {path: '/', fsPath: '/docs/home', hasTemplate: false, hasSlot: false, templatePath: null, slotPath: null},
          ],
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
        sortedPaths: ['/', '/about'],
      })

      const app = new Hono()
      let nextHandlerCalled = false

      app.get(
        '/*',
        redirectRoot(() => discovery),
        c => {
          nextHandlerCalled = true
          return c.text('Root document')
        },
      )

      const res = await app.request('/')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'Root document')
      assert.strictEqual(nextHandlerCalled, true)
    })
  })

  describe('when no root document exists', () => {
    it('should redirect to first available document', async () => {
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
          [
            '/contact',
            {
              path: '/contact',
              fsPath: '/docs/contact',
              hasTemplate: false,
              hasSlot: false,
              templatePath: null,
              slotPath: null,
            },
          ],
        ]),
        sortedPaths: ['/about', '/contact'],
      })

      const app = new Hono()

      app.get(
        '/*',
        redirectRoot(() => discovery),
      )

      const res = await app.request('/')
      assert.strictEqual(res.status, 302)
      assert.strictEqual(res.headers.get('Location'), '/about')
    })

    it('should prefer top-level paths over nested paths', async () => {
      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/blog/post-1',
            {
              path: '/blog/post-1',
              fsPath: '/docs/blog/post-1',
              hasTemplate: false,
              hasSlot: false,
              templatePath: null,
              slotPath: null,
            },
          ],
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
        sortedPaths: ['/about', '/blog/post-1'],
      })

      const app = new Hono()

      app.get(
        '/*',
        redirectRoot(() => discovery),
      )

      const res = await app.request('/')
      assert.strictEqual(res.status, 302)
      // findDefaultRedirect prefers top-level paths
      assert.strictEqual(res.headers.get('Location'), '/about')
    })

    it('should preserve query string in redirect', async () => {
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

      app.get(
        '/*',
        redirectRoot(() => discovery),
      )

      const res = await app.request('/?style')
      assert.strictEqual(res.status, 302)
      assert.strictEqual(res.headers.get('Location'), '/about?style')
    })

    it('should preserve complex query strings', async () => {
      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/docs',
            {
              path: '/docs',
              fsPath: '/docs/main',
              hasTemplate: false,
              hasSlot: false,
              templatePath: null,
              slotPath: null,
            },
          ],
        ]),
        sortedPaths: ['/docs'],
      })

      const app = new Hono()

      app.get(
        '/*',
        redirectRoot(() => discovery),
      )

      const res = await app.request('/?foo=bar&baz=qux')
      assert.strictEqual(res.status, 302)
      assert.strictEqual(res.headers.get('Location'), '/docs?foo=bar&baz=qux')
    })
  })

  describe('when no documents exist', () => {
    it('should call next() when no redirect target is found', async () => {
      const discovery = createMockDiscovery({
        documents: new Map(),
        sortedPaths: [],
      })

      const app = new Hono()
      let nextHandlerCalled = false

      app.get(
        '/*',
        redirectRoot(() => discovery),
        c => {
          nextHandlerCalled = true
          return c.text('No documents')
        },
      )

      const res = await app.request('/')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(nextHandlerCalled, true)
    })
  })

  describe('with mutable discovery', () => {
    it('should use the current discovery result on each request', async () => {
      let discovery = createMockDiscovery({
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

      app.get(
        '/*',
        redirectRoot(() => discovery),
        c => c.text('Handler'),
      )

      // First request - redirects to /about
      const res1 = await app.request('/')
      assert.strictEqual(res1.status, 302)
      assert.strictEqual(res1.headers.get('Location'), '/about')

      // Mutate discovery to add root document
      discovery = createMockDiscovery({
        documents: new Map([
          [
            '/',
            {path: '/', fsPath: '/docs/home', hasTemplate: false, hasSlot: false, templatePath: null, slotPath: null},
          ],
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
        sortedPaths: ['/', '/about'],
      })

      // Second request - no redirect, root exists
      const res2 = await app.request('/')
      assert.strictEqual(res2.status, 200)
      assert.strictEqual(await res2.text(), 'Handler')
    })
  })
})
