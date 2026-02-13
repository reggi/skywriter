import {describe, it, mock, beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {rm, mkdir, writeFile} from 'node:fs/promises'
import type {CliContext} from '../../../src/cli/utils/types.ts'
import type {PrefixLog} from '../../../src/cli/utils/prefixLog.ts'

const testTmpDir = join(tmpdir(), `config-test-${Date.now()}`)

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

// Mock os.homedir so config file goes to temp dir
mock.module('node:os', {
  namedExports: {
    platform: () => 'freebsd',
    homedir: () => testTmpDir,
  },
})

// Mock child_process to prevent real keychain calls
mock.module('node:child_process', {
  namedExports: {
    exec: (_command: string, callback: (error: Error | null, result: {stdout: string; stderr: string}) => void) => {
      callback(null, {stdout: '', stderr: ''})
    },
  },
})

// Import after mocking
const {sanitizeServerUrl, readConfig, resolveSource} = await import('../../../src/cli/utils/config.ts')

// Helper to build server key
function serverKey(serverUrl: string, username: string): string {
  const url = new URL(serverUrl)
  url.username = username
  return url.href.replace(/\/$/, '')
}

// Helper to write a mock config file
async function writeConfig(config: Record<string, unknown>) {
  const configFile = join(testTmpDir, '.wondoc.json')
  await writeFile(configFile, JSON.stringify(config))
}

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
    assert.throws(() => sanitizeServerUrl('not-a-valid-url'), {message: 'Invalid server URL'})
  })

  it('throws error for empty string', () => {
    assert.throws(() => sanitizeServerUrl(''), {message: 'Invalid server URL'})
  })

  it('throws error for malformed URL', () => {
    assert.throws(() => sanitizeServerUrl('://missing-protocol.com'), /Invalid server URL/)
  })
})

describe('readConfig', () => {
  beforeEach(async () => {
    await rm(testTmpDir, {recursive: true, force: true})
    await mkdir(testTmpDir, {recursive: true})
  })

  describe('with serverUrl and username provided', () => {
    it('returns credentials when found', async () => {
      const key = serverKey('https://example.com', 'testuser')
      await writeConfig({active: key, servers: {[key]: {password: 'testpass'}}})

      const result = await readConfig(mockCtx, mockLog, 'https://example.com', 'testuser')

      assert.deepEqual(result, {
        serverUrl: 'https://example.com',
        username: 'testuser',
        password: 'testpass',
      })
    })

    it('throws error when credentials not found', async () => {
      await writeConfig({active: null, servers: {}})

      await assert.rejects(() => readConfig(mockCtx, mockLog, 'https://example.com', 'testuser'), {
        message: 'No credentials found for testuser@example.com',
      })
    })
  })

  describe('with default server', () => {
    it('returns default server credentials when available', async () => {
      const key = serverKey('https://default-server.com', 'defaultuser')
      await writeConfig({active: key, servers: {[key]: {password: 'defaultpass'}}})

      const result = await readConfig(mockCtx, mockLog)

      assert.deepEqual(result, {
        serverUrl: 'https://default-server.com',
        username: 'defaultuser',
        password: 'defaultpass',
      })
    })

    it('throws login prompt when no servers exist', async () => {
      await writeConfig({active: null, servers: {}})

      await assert.rejects(() => readConfig(mockCtx, mockLog), {message: 'Not logged in. Please run: wondoc login'})
    })

    it('throws set-default prompt when servers exist but no default', async () => {
      const key1 = serverKey('https://server1.com', 'u1')
      const key2 = serverKey('https://server2.com', 'u2')
      await writeConfig({active: null, servers: {[key1]: {password: 'p1'}, [key2]: {password: 'p2'}}})

      await assert.rejects(() => readConfig(mockCtx, mockLog), {
        message: 'No default server set. Please run: wondoc login --set-default',
      })
    })
  })
})

describe('resolveSource', () => {
  beforeEach(async () => {
    await rm(testTmpDir, {recursive: true, force: true})
    await mkdir(testTmpDir, {recursive: true})
  })

  it('resolves full URL source with credentials from server list', async () => {
    const defaultKey = serverKey('https://default.com', 'user1')
    const otherKey = serverKey('https://other.com', 'user2')
    await writeConfig({
      active: defaultKey,
      servers: {[defaultKey]: {password: 'pass1'}, [otherKey]: {password: 'pass2'}},
    })

    const result = await resolveSource(mockCtx, mockLog, 'https://other.com/docs')

    assert.equal(result.serverUrl, 'https://other.com')
    assert.equal(result.documentPath, '/docs')
    assert.equal(result.username, 'user2')
    assert.equal(result.password, 'pass2')
    assert.ok(result.auth)
  })

  it('resolves full URL and uses default config when server matches', async () => {
    const key = serverKey('https://myserver.com', 'admin')
    await writeConfig({active: key, servers: {[key]: {password: 'secret'}}})

    const result = await resolveSource(mockCtx, mockLog, 'https://myserver.com/blog')

    assert.equal(result.serverUrl, 'https://myserver.com')
    assert.equal(result.documentPath, '/blog')
    assert.equal(result.username, 'admin')
    assert.equal(result.password, 'secret')
  })

  it('resolves absolute path using default server', async () => {
    const key = serverKey('https://default.com', 'user')
    await writeConfig({active: key, servers: {[key]: {password: 'pass'}}})

    const result = await resolveSource(mockCtx, mockLog, '/my-doc')

    assert.equal(result.serverUrl, 'https://default.com')
    assert.equal(result.documentPath, '/my-doc')
    assert.equal(result.username, 'user')
  })

  it('resolves bare name using default server', async () => {
    const key = serverKey('https://default.com', 'user')
    await writeConfig({active: key, servers: {[key]: {password: 'pass'}}})

    const result = await resolveSource(mockCtx, mockLog, 'my-doc')

    assert.equal(result.serverUrl, 'https://default.com')
    assert.equal(result.documentPath, '/my-doc')
  })

  it('strips .git suffix from full URL', async () => {
    const key = serverKey('https://myserver.com', 'admin')
    await writeConfig({active: key, servers: {[key]: {password: 'secret'}}})

    const result = await resolveSource(mockCtx, mockLog, 'https://myserver.com/blog.git')

    assert.equal(result.documentPath, '/blog')
  })

  it('throws when no default server and source is a path', async () => {
    await writeConfig({active: null, servers: {}})

    await assert.rejects(() => resolveSource(mockCtx, mockLog, '/my-doc'), /No default server configured/)
  })

  it('throws when no credentials found for server', async () => {
    const defaultKey = serverKey('https://default.com', 'user')
    await writeConfig({active: defaultKey, servers: {[defaultKey]: {password: 'pass'}}})

    await assert.rejects(() => resolveSource(mockCtx, mockLog, 'https://unknown.com/doc'), /No credentials for/)
  })

  it('generates valid base64 auth string', async () => {
    const key = serverKey('https://default.com', 'admin')
    await writeConfig({active: key, servers: {[key]: {password: 'secret'}}})

    const result = await resolveSource(mockCtx, mockLog, '/test')

    const decoded = Buffer.from(result.auth, 'base64').toString()
    assert.equal(decoded, 'admin:secret')
  })
})
