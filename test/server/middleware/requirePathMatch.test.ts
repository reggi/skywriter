import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Hono} from 'hono'
import {requirePathMatch} from '../../../src/server/middleware/requirePathMatch.ts'
import type {AppContext} from '../../../src/server/utils/types.ts'

describe('requirePathMatch', () => {
  describe('when path does not match pattern', () => {
    it('should call next() and skip handlers', async () => {
      const app = new Hono<AppContext>()
      let handlerCalled = false

      app.get(
        '/*',
        requirePathMatch(/^\/admin\/(.+)$/, async c => {
          handlerCalled = true
          return c.text('Handler called')
        }),
        c => {
          return c.text('Default response')
        },
      )

      const res = await app.request('/test')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'Default response')
      assert.strictEqual(handlerCalled, false)
    })
  })

  describe('when path matches pattern', () => {
    it('should execute the handler', async () => {
      const app = new Hono<AppContext>()

      app.get(
        '/*',
        requirePathMatch(/^\/admin\/(.+)$/, async c => {
          return c.text('Admin handler')
        }),
        c => {
          return c.text('Default response')
        },
      )

      const res = await app.request('/admin/users')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'Admin handler')
    })

    it('should set pathMatch in context with capture groups', async () => {
      const app = new Hono<AppContext>()
      let capturedMatch: RegExpMatchArray | undefined

      app.get(
        '/*',
        requirePathMatch(/^\/files\/(.+)\/(.+)$/, async c => {
          capturedMatch = c.get('pathMatch')
          return c.text('OK')
        }),
        c => {
          return c.text('Default')
        },
      )

      const res = await app.request('/files/folder/document.txt')
      assert.strictEqual(res.status, 200)
      assert.ok(capturedMatch)
      assert.strictEqual(capturedMatch![0], '/files/folder/document.txt')
      assert.strictEqual(capturedMatch![1], 'folder')
      assert.strictEqual(capturedMatch![2], 'document.txt')
    })
  })

  describe('with uploads pattern', () => {
    it('should match upload paths', async () => {
      const app = new Hono<AppContext>()
      let capturedMatch: RegExpMatchArray | undefined

      app.get(
        '/*',
        requirePathMatch(/^(.*)\/uploads\/([^/]+)$/, async c => {
          capturedMatch = c.get('pathMatch')
          return c.text('Upload handler')
        }),
        c => {
          return c.text('Default')
        },
      )

      const res = await app.request('/docs/my-doc/uploads/image.png')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'Upload handler')
      assert.ok(capturedMatch)
      assert.strictEqual(capturedMatch![1], '/docs/my-doc')
      assert.strictEqual(capturedMatch![2], 'image.png')
    })
  })

  describe('with git pattern', () => {
    it('should match .git paths', async () => {
      const app = new Hono<AppContext>()

      app.get(
        '/*',
        requirePathMatch(/^(.*)\.git(\/.*)?$/, async c => {
          return c.text('Git handler')
        }),
        c => {
          return c.text('Default')
        },
      )

      const res = await app.request('/repo.git/info/refs')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'Git handler')
    })

    it('should match .git root path', async () => {
      const app = new Hono<AppContext>()

      app.get(
        '/*',
        requirePathMatch(/^(.*)\.git(\/.*)?$/, async c => {
          return c.text('Git handler')
        }),
        c => {
          return c.text('Default')
        },
      )

      const res = await app.request('/my-repo.git')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'Git handler')
    })
  })

  describe('with multiple handlers', () => {
    it('should execute handler that returns a response', async () => {
      const app = new Hono<AppContext>()
      const calls: string[] = []

      app.get(
        '/*',
        requirePathMatch(/^\/api\//, async c => {
          calls.push('handler')
          return c.text('API response')
        }),
        c => {
          return c.text('Default')
        },
      )

      const res = await app.request('/api/users')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'API response')
      assert.deepStrictEqual(calls, ['handler'])
    })

    it('should chain multiple handlers when second handler returns response', async () => {
      const app = new Hono<AppContext>()
      const calls: string[] = []

      app.get(
        '/*',
        requirePathMatch(
          /^\/chain\//,
          async (c, next) => {
            calls.push('handler1')
            return next()
          },
          async c => {
            calls.push('handler2')
            return c.text('Chained result')
          },
        ),
        c => {
          return c.text('Default')
        },
      )

      const res = await app.request('/chain/test')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'Chained result')
      assert.deepStrictEqual(calls, ['handler1', 'handler2'])
    })

    it('should call next route if no handler in chain returns a response', async () => {
      const app = new Hono<AppContext>()
      const calls: string[] = []

      app.get(
        '/*',
        requirePathMatch(/^\/passthrough\//, async (c, next) => {
          calls.push('handler1')
          return next()
        }),
        c => {
          calls.push('default')
          return c.text('Default reached')
        },
      )

      const res = await app.request('/passthrough/test')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'Default reached')
      assert.deepStrictEqual(calls, ['handler1', 'default'])
    })
  })
})
