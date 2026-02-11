import {describe, it, mock, beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import type {CliContext} from '../../../src/cli/utils/types.ts'
import type {PrefixLog} from '../../../src/cli/utils/prefixLog.ts'

// Mock CliContext for testing
const mockCtx: CliContext = {
  cliName: 'wondoc',
  cliId: 'wondoc',
  cwd: process.cwd(),
}

// Mock PrefixLog for testing
const mockLog: PrefixLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  verbose: () => {},
  exec: () => {},
  http: () => {},
  fs: () => {},
  prefix: () => mockLog,
}

// Mock data
let mockDefaultServer: {serverUrl: string; username: string; password: string} | null = null
let mockServerList: Array<{serverUrl: string; username: string}> = []
let mockRetrieveCredentials: {serverUrl: string; username: string; password: string} | null = null

// Mock credentials module
mock.module('../../../src/cli/utils/credentials.ts', {
  namedExports: {
    getDefaultServer: async () => mockDefaultServer,
    listServers: async () => mockServerList,
    retrieveCredentials: async (_ctx: CliContext, _log: PrefixLog, _serverUrl: string, _username: string) =>
      mockRetrieveCredentials,
  },
})

// Import after mocking
const {sanitizeServerUrl, readConfig, resolveSource} = await import('../../../src/cli/utils/config.ts')

describe('sanitizeServerUrl', () => {
  it('returns protocol and host for valid URL', () => {
    const result = sanitizeServerUrl('https://example.com')
    assert.equal(result, 'https://example.com')
  })

  it('strips trailing slash from URL', () => {
    const result = sanitizeServerUrl('https://example.com/')
    assert.equal(result, 'https://example.com')
  })

  it('strips path from URL', () => {
    const result = sanitizeServerUrl('https://example.com/some/path')
    assert.equal(result, 'https://example.com')
  })

  it('strips query parameters from URL', () => {
    const result = sanitizeServerUrl('https://example.com?foo=bar')
    assert.equal(result, 'https://example.com')
  })

  it('strips hash from URL', () => {
    const result = sanitizeServerUrl('https://example.com#section')
    assert.equal(result, 'https://example.com')
  })

  it('preserves port in URL', () => {
    const result = sanitizeServerUrl('https://example.com:8080/path')
    assert.equal(result, 'https://example.com:8080')
  })

  it('handles http protocol', () => {
    const result = sanitizeServerUrl('http://localhost:3000/api')
    assert.equal(result, 'http://localhost:3000')
  })

  it('throws error for invalid URL', () => {
    assert.throws(() => sanitizeServerUrl('not-a-valid-url'), {message: 'Invalid server URL: not-a-valid-url'})
  })

  it('throws error for empty string', () => {
    assert.throws(() => sanitizeServerUrl(''), {message: 'Invalid server URL: '})
  })

  it('throws error for malformed URL', () => {
    assert.throws(() => sanitizeServerUrl('://missing-protocol.com'), /Invalid server URL/)
  })
})

describe('readConfig', () => {
  beforeEach(() => {
    mockDefaultServer = null
    mockServerList = []
    mockRetrieveCredentials = null
  })

  describe('with serverUrl and username provided', () => {
    it('returns credentials when found', async () => {
      mockRetrieveCredentials = {
        serverUrl: 'https://example.com',
        username: 'testuser',
        password: 'testpass',
      }

      const result = await readConfig(mockCtx, mockLog, 'https://example.com', 'testuser')

      assert.deepEqual(result, {
        serverUrl: 'https://example.com',
        username: 'testuser',
        password: 'testpass',
      })
    })

    it('throws error when credentials not found', async () => {
      mockRetrieveCredentials = null

      await assert.rejects(() => readConfig(mockCtx, mockLog, 'https://example.com', 'testuser'), {
        message: 'No credentials found for https://example.com (testuser)',
      })
    })
  })

  describe('with default server', () => {
    it('returns default server credentials when available', async () => {
      mockDefaultServer = {
        serverUrl: 'https://default-server.com',
        username: 'defaultuser',
        password: 'defaultpass',
      }

      const result = await readConfig(mockCtx, mockLog)

      assert.deepEqual(result, {
        serverUrl: 'https://default-server.com',
        username: 'defaultuser',
        password: 'defaultpass',
      })
    })

    it('throws login prompt when no servers exist', async () => {
      mockDefaultServer = null
      mockServerList = []

      await assert.rejects(() => readConfig(mockCtx, mockLog), {message: 'Not logged in. Please run: wondoc login'})
    })

    it('throws set-default prompt when servers exist but no default', async () => {
      mockDefaultServer = null
      mockServerList = [
        {serverUrl: 'https://server1.com', username: 'u1'},
        {serverUrl: 'https://server2.com', username: 'u2'},
      ]

      await assert.rejects(() => readConfig(mockCtx, mockLog), {
        message: 'No default server set. Please run: wondoc login --set-default',
      })
    })
  })
})

describe('resolveSource', () => {
  beforeEach(() => {
    mockDefaultServer = null
    mockServerList = []
    mockRetrieveCredentials = null
  })

  it('resolves full URL source with credentials from server list', async () => {
    mockDefaultServer = {serverUrl: 'https://default.com', username: 'user1', password: 'pass1'}
    mockServerList = [{serverUrl: 'https://other.com', username: 'user2'}]
    mockRetrieveCredentials = {serverUrl: 'https://other.com', username: 'user2', password: 'pass2'}

    const result = await resolveSource(mockCtx, mockLog, 'https://other.com/docs')

    assert.equal(result.serverUrl, 'https://other.com')
    assert.equal(result.documentPath, '/docs')
    assert.equal(result.username, 'user2')
    assert.equal(result.password, 'pass2')
    assert.ok(result.auth) // base64 encoded
  })

  it('resolves full URL and uses default config when server matches', async () => {
    mockDefaultServer = {serverUrl: 'https://myserver.com', username: 'admin', password: 'secret'}

    const result = await resolveSource(mockCtx, mockLog, 'https://myserver.com/blog')

    assert.equal(result.serverUrl, 'https://myserver.com')
    assert.equal(result.documentPath, '/blog')
    assert.equal(result.username, 'admin')
    assert.equal(result.password, 'secret')
  })

  it('resolves absolute path using default server', async () => {
    mockDefaultServer = {serverUrl: 'https://default.com', username: 'user', password: 'pass'}

    const result = await resolveSource(mockCtx, mockLog, '/my-doc')

    assert.equal(result.serverUrl, 'https://default.com')
    assert.equal(result.documentPath, '/my-doc')
    assert.equal(result.username, 'user')
  })

  it('resolves bare name using default server', async () => {
    mockDefaultServer = {serverUrl: 'https://default.com', username: 'user', password: 'pass'}

    const result = await resolveSource(mockCtx, mockLog, 'my-doc')

    assert.equal(result.serverUrl, 'https://default.com')
    assert.equal(result.documentPath, '/my-doc')
  })

  it('strips .git suffix from full URL', async () => {
    mockDefaultServer = {serverUrl: 'https://myserver.com', username: 'admin', password: 'secret'}

    const result = await resolveSource(mockCtx, mockLog, 'https://myserver.com/blog.git')

    assert.equal(result.documentPath, '/blog')
  })

  it('throws when no default server and source is a path', async () => {
    mockDefaultServer = null

    await assert.rejects(() => resolveSource(mockCtx, mockLog, '/my-doc'), /No default server configured/)
  })

  it('throws when no credentials found for server', async () => {
    mockDefaultServer = {serverUrl: 'https://default.com', username: 'user', password: 'pass'}
    mockServerList = [] // No matching server
    mockRetrieveCredentials = null

    await assert.rejects(() => resolveSource(mockCtx, mockLog, 'https://unknown.com/doc'), /No credentials for/)
  })

  it('throws when credentials are expired', async () => {
    mockDefaultServer = {serverUrl: 'https://default.com', username: 'user', password: 'pass'}
    mockServerList = [{serverUrl: 'https://other.com', username: 'user2'}]
    mockRetrieveCredentials = null // Expired

    await assert.rejects(() => resolveSource(mockCtx, mockLog, 'https://other.com/doc'), /Credentials expired/)
  })

  it('generates valid base64 auth string', async () => {
    mockDefaultServer = {serverUrl: 'https://default.com', username: 'admin', password: 'secret'}

    const result = await resolveSource(mockCtx, mockLog, '/test')

    const decoded = Buffer.from(result.auth, 'base64').toString()
    assert.equal(decoded, 'admin:secret')
  })
})
