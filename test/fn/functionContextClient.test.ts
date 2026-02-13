import {describe, it, mock, beforeEach, afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {clearCache, functionContextClient} from '../../src/fn/functionContextClient.ts'
import {promises as fs} from 'fs'

describe('clearCache', () => {
  const testCacheDir = './test-cache-clear'

  beforeEach(async () => {
    // Create test cache directory with some files
    await fs.mkdir(testCacheDir, {recursive: true})
    await fs.writeFile(`${testCacheDir}/test1.json`, '{}')
    await fs.writeFile(`${testCacheDir}/test2.json`, '{}')
  })

  afterEach(async () => {
    // Clean up
    try {
      await fs.rm(testCacheDir, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  })

  it('should remove the cache directory', async () => {
    // Verify cache dir exists
    const statBefore = await fs.stat(testCacheDir)
    assert.ok(statBefore.isDirectory())

    await clearCache(testCacheDir)

    // Verify cache dir no longer exists
    await assert.rejects(async () => fs.stat(testCacheDir), {code: 'ENOENT'})
  })

  it('should not throw when cache directory does not exist', async () => {
    const nonExistentDir = './non-existent-cache-dir'

    // Should not throw
    await clearCache(nonExistentDir)
  })
})

describe('functionContextClient', () => {
  const testCacheDir = './test-client-cache'

  afterEach(async () => {
    // Clean up cache directory
    try {
      await fs.rm(testCacheDir, {recursive: true, force: true})
    } catch {
      // Ignore
    }
    // Restore global fetch
    mock.restoreAll()
  })

  describe('cache behavior', () => {
    it('should read from cache when available', async () => {
      // Create cache file
      await fs.mkdir('./cache', {recursive: true})
      const cachedData = {html: '<p>cached</p>', path: '/cached-doc'}

      // We need to compute the actual cache key used by the function
      const crypto = await import('crypto')
      const args = {query: {path: '/test-doc'}}
      const argsString = JSON.stringify(args, Object.keys(args).sort())
      const hash = crypto.createHash('sha256').update(`getPage:${argsString}`).digest('hex').substring(0, 16)
      const cacheKey = `getPage-${hash}.json`

      await fs.writeFile(`./cache/${cacheKey}`, JSON.stringify(cachedData))

      const client = functionContextClient('http://localhost:3000', undefined, {cache: true})
      const result = await client.getPage({path: '/test-doc'})

      assert.deepEqual(result, cachedData)

      // Clean up
      await fs.rm('./cache', {recursive: true, force: true})
    })

    it('should skip cache when cache is disabled', async () => {
      let fetchCalled = false
      const mockResponse = {html: '<p>fresh</p>', path: '/fresh-doc'}

      // Mock fetch
      const originalFetch = globalThis.fetch
      globalThis.fetch = async () => {
        fetchCalled = true
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({'content-type': 'application/json'}),
          json: async () => mockResponse,
          text: async () => JSON.stringify(mockResponse),
        } as Response
      }

      try {
        const client = functionContextClient('http://localhost:3000', undefined, {cache: false})
        const result = await client.getPage({path: '/test-doc'})

        assert.ok(fetchCalled, 'Fetch should be called when cache is disabled')
        assert.deepEqual(result, mockResponse)
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('authentication', () => {
    it('should add Basic Auth header when credentials provided', async () => {
      let capturedHeaders: Record<string, string> = {}
      const mockResponse = {html: '<p>auth</p>'}

      const originalFetch = globalThis.fetch
      globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string>
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({'content-type': 'application/json'}),
          json: async () => mockResponse,
        } as Response
      }

      try {
        const client = functionContextClient(
          'http://localhost:3000',
          {username: 'testuser', password: 'testpass'},
          {cache: false},
        )
        await client.getPage({path: '/test-doc'})

        const expectedAuth = Buffer.from('testuser:testpass').toString('base64')
        assert.equal(capturedHeaders['Authorization'], `Basic ${expectedAuth}`)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('should use cookies when no auth header provided', async () => {
      let capturedCredentials: string | undefined
      const mockResponse = {html: '<p>cookie auth</p>'}

      const originalFetch = globalThis.fetch
      globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
        capturedCredentials = init?.credentials as string | undefined
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({'content-type': 'application/json'}),
          json: async () => mockResponse,
        } as Response
      }

      try {
        const client = functionContextClient('http://localhost:3000', undefined, {cache: false})
        await client.getPage({path: '/test-doc'})

        assert.equal(capturedCredentials, 'include')
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('error handling', () => {
    it('should throw error when response status is unsuccessful', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = async () => {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: new Headers({'content-type': 'text/plain'}),
          text: async () => 'Document not found',
        } as Response
      }

      try {
        const client = functionContextClient('http://localhost:3000', undefined, {cache: false})

        await assert.rejects(
          async () => client.getPage({path: '/nonexistent'}),
          (error: Error) => {
            assert.ok(error.message.includes('404'))
            assert.ok(error.message.includes('Not Found'))
            assert.ok(error.message.includes('Document not found'))
            return true
          },
        )
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('should throw error when response is 500', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = async () => {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers({'content-type': 'text/plain'}),
          text: async () => 'Server error',
        } as Response
      }

      try {
        const client = functionContextClient('http://localhost:3000', undefined, {cache: false})

        await assert.rejects(
          async () => client.getPages({}),
          (error: Error) => {
            assert.ok(error.message.includes('500'))
            return true
          },
        )
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('getPage', () => {
    it('should make POST request to correct URL', async () => {
      let capturedUrl = ''
      let capturedBody = ''
      const mockResponse = {html: '<p>test</p>'}

      const originalFetch = globalThis.fetch
      globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = typeof url === 'string' ? url : url.toString()
        capturedBody = init?.body as string
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({'content-type': 'application/json'}),
          json: async () => mockResponse,
        } as Response
      }

      try {
        const client = functionContextClient('http://localhost:3000', undefined, {cache: false})
        await client.getPage({path: '/my-doc'})

        assert.equal(capturedUrl, 'http://localhost:3000/edit?fn=getPage')
        assert.deepEqual(JSON.parse(capturedBody), {query: {path: '/my-doc'}})
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('getPages', () => {
    it('should make POST request with options', async () => {
      let capturedBody = ''
      const mockResponse = [{html: '<p>doc1</p>'}, {html: '<p>doc2</p>'}]

      const originalFetch = globalThis.fetch
      globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = init?.body as string
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({'content-type': 'application/json'}),
          json: async () => mockResponse,
        } as Response
      }

      try {
        const client = functionContextClient('http://localhost:3000', undefined, {cache: false})
        const result = await client.getPages({limit: 10, startsWithPath: '/blog/'})

        assert.deepEqual(JSON.parse(capturedBody), {options: {limit: 10, startsWithPath: '/blog/'}})
        assert.deepEqual(result, mockResponse)
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('getUploads', () => {
    it('should make POST request with path and options', async () => {
      let capturedBody = ''
      const mockResponse = [{id: 1, filename: 'image.png'}]

      const originalFetch = globalThis.fetch
      globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = init?.body as string
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({'content-type': 'application/json'}),
          json: async () => mockResponse,
        } as Response
      }

      try {
        const client = functionContextClient('http://localhost:3000', undefined, {cache: false})
        const result = await client.getUploads({path: '/my-doc', limit: 5})

        assert.deepEqual(JSON.parse(capturedBody), {options: {path: '/my-doc', limit: 5}})
        assert.deepEqual(result, mockResponse)
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('default values', () => {
    it('should use empty string as default baseUrl', async () => {
      let capturedUrl = ''
      const mockResponse = {html: '<p>test</p>'}

      const originalFetch = globalThis.fetch
      globalThis.fetch = async (url: string | URL | Request) => {
        capturedUrl = typeof url === 'string' ? url : url.toString()
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({'content-type': 'application/json'}),
          json: async () => mockResponse,
        } as Response
      }

      try {
        const client = functionContextClient(undefined, undefined, {cache: false})
        await client.getPage({path: '/test'})

        assert.equal(capturedUrl, '/edit?fn=getPage')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('should enable cache by default', async () => {
      // Create cache file
      await fs.mkdir('./cache', {recursive: true})
      const cachedData = {html: '<p>default cache</p>'}

      const crypto = await import('crypto')
      const args = {query: {path: '/default-cache-test'}}
      const argsString = JSON.stringify(args, Object.keys(args).sort())
      const hash = crypto.createHash('sha256').update(`getPage:${argsString}`).digest('hex').substring(0, 16)
      const cacheKey = `getPage-${hash}.json`

      await fs.writeFile(`./cache/${cacheKey}`, JSON.stringify(cachedData))

      // Client without explicit cache option should use cache
      const client = functionContextClient('http://localhost:3000')
      const result = await client.getPage({path: '/default-cache-test'})

      assert.deepEqual(result, cachedData)

      // Clean up
      await fs.rm('./cache', {recursive: true, force: true})
    })
  })

  describe('cache write', () => {
    it('should write response to cache after successful fetch', async () => {
      const mockResponse = {html: '<p>to be cached</p>', path: '/cache-write-test'}

      const originalFetch = globalThis.fetch
      globalThis.fetch = async () => {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({'content-type': 'application/json'}),
          json: async () => mockResponse,
        } as Response
      }

      try {
        const client = functionContextClient('http://localhost:3000', undefined, {cache: true})
        await client.getPage({path: '/cache-write-test'})

        // Wait a bit for the async cache write to complete
        await new Promise(resolve => setTimeout(resolve, 100))

        // Verify cache was written
        const crypto = await import('crypto')
        const args = {query: {path: '/cache-write-test'}}
        const argsString = JSON.stringify(args, Object.keys(args).sort())
        const hash = crypto.createHash('sha256').update(`getPage:${argsString}`).digest('hex').substring(0, 16)
        const cacheKey = `getPage-${hash}.json`

        const cachedContent = await fs.readFile(`./cache/${cacheKey}`, 'utf-8')
        assert.deepEqual(JSON.parse(cachedContent), mockResponse)
      } finally {
        globalThis.fetch = originalFetch
        await fs.rm('./cache', {recursive: true, force: true})
      }
    })
  })
})
