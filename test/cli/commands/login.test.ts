import {describe, it, mock, beforeEach, afterEach, after} from 'node:test'
import assert from 'node:assert/strict'
import {stripAnsi} from '../../helpers/stripAnsi.ts'

// Shared output array - mocks and tests both push here
const output: {lines: string[]} = {lines: []}
const logHandler = (...args: unknown[]) => {
  const messageParts = args.slice(1)
  output.lines.push(messageParts.map(String).join(' '))
}

// Track stored credentials
let storedCredentials: Array<{
  serverUrl: string
  username: string
  password: string
  setAsDefault: boolean
}> = []

// Mock responses for prompts
let mockPromptResponses: {
  serverUrl?: string
  username?: string
  password?: string
  setAsDefault?: boolean
} = {}

// Mock server list
let mockServerList: string[] = []

// Mock fetch response
let mockFetchResponse: {ok: boolean; status: number} = {ok: true, status: 200}
let mockFetchError: Error | null = null

// Mock @inquirer/prompts module - pushes to output so prompts appear in snapshots
mock.module('@inquirer/prompts', {
  namedExports: {
    input: async (options: {message: string; validate?: (value: string) => boolean | string}) => {
      if (options.message === 'Server URL:') {
        const value = mockPromptResponses.serverUrl || 'https://example.com'
        if (options.validate) {
          const result = options.validate(value)
          if (result !== true) {
            throw new Error(result as string)
          }
        }
        output.lines.push(`✔ ${options.message} ${value}`)
        return value
      }
      if (options.message === 'Username:') {
        const value = mockPromptResponses.username || 'testuser'
        if (options.validate) {
          const result = options.validate(value)
          if (result !== true) {
            throw new Error(result as string)
          }
        }
        output.lines.push(`✔ ${options.message} ${value}`)
        return value
      }
      return ''
    },
    password: async (options: {message: string; mask?: string; validate?: (value: string) => boolean | string}) => {
      const value = mockPromptResponses.password || 'testpass'
      if (options.validate) {
        const result = options.validate(value)
        if (result !== true) {
          throw new Error(result as string)
        }
      }
      output.lines.push(`✔ ${options.message} ${'*'.repeat(value.length)}`)
      return value
    },
    confirm: async (options: {message: string; default?: boolean}) => {
      const result = mockPromptResponses.setAsDefault ?? options.default ?? false
      output.lines.push(`✔ ${options.message} ${result ? 'Yes' : 'No'}`)
      return result
    },
  },
})

// Mock config module - must replicate log output so snapshots match
mock.module('../../../src/cli/utils/config.ts', {
  namedExports: {
    sanitizeServerUrl: (url: string) => {
      const parsed = new URL(url)
      return `${parsed.protocol}//${parsed.host}`
    },
    readServerConfig: async (
      _ctx: {cliId: string},
      cmdLog: {info: (msg: string) => void; fs: (msg: string) => void},
    ) => ({
      listServers: () => {
        if (mockServerList.length > 0) {
          cmdLog.fs('reading ~/.wondoc.json')
        }
        return mockServerList
      },
      storeCredentials: async (
        serverUrl: string,
        username: string,
        password: string,
        options: {setAsDefault?: boolean},
      ) => {
        const setAsDefault = options.setAsDefault ?? true
        storedCredentials.push({serverUrl, username, password, setAsDefault})
        const host = new URL(serverUrl).host
        const url = new URL(serverUrl)
        url.username = username
        const key = url.href.replace(/\/$/, '')
        cmdLog.info(`saving credentials for ${username}@${host}`)
        cmdLog.fs(`updating ~/.wondoc.json#servers.${key} to {}`)
        if (setAsDefault) {
          cmdLog.fs(`updating ~/.wondoc.json#active to ${key}`)
        }
      },
      getCredentialBackendName: () => 'test-backend',
    }),
  },
})

// Mock cliName module
mock.module('../../../src/cli/utils/cliName.ts', {
  namedExports: {
    getCliName: () => 'wondoc',
    getCliId: () => 'wondoc',
  },
})

// Mock global fetch
const originalFetch = globalThis.fetch
globalThis.fetch = async () => {
  if (mockFetchError) {
    throw mockFetchError
  }
  return {
    ok: mockFetchResponse.ok,
    status: mockFetchResponse.status,
  } as Response
}

// Import after mocking
const {login} = await import('../../../src/cli/commands/login.ts')
import {mockCliContext} from '../test-context.ts'

describe('login', () => {
  beforeEach(() => {
    output.lines = []
    storedCredentials = []
    mockPromptResponses = {}
    mockServerList = []
    mockFetchResponse = {ok: true, status: 200}
    mockFetchError = null
    process.on('log', logHandler)
  })

  afterEach(() => {
    process.removeListener('log', logHandler)
  })

  // Restore mocks after all tests
  after(() => {
    globalThis.fetch = originalFetch
  })

  describe('successful login', () => {
    it('stores credentials with default values when no existing servers', async t => {
      mockPromptResponses = {
        serverUrl: 'https://my-server.com',
        username: 'myuser',
        password: 'mypassword',
      }
      mockServerList = []

      await login(mockCliContext)

      assert.equal(storedCredentials.length, 1)
      assert.equal(storedCredentials[0].serverUrl, 'https://my-server.com')
      assert.equal(storedCredentials[0].username, 'myuser')
      assert.equal(storedCredentials[0].password, 'mypassword')
      assert.equal(storedCredentials[0].setAsDefault, true)
      t.assert.snapshot(output.lines.map(stripAnsi))
    })

    it('prompts for default when existing servers exist', async () => {
      mockPromptResponses = {
        serverUrl: 'https://new-server.com',
        username: 'newuser',
        password: 'newpass',
        setAsDefault: true,
      }
      mockServerList = ['https://existing-server.com']

      await login(mockCliContext)

      assert.equal(storedCredentials.length, 1)
      assert.equal(storedCredentials[0].setAsDefault, true)
    })

    it('respects user choice not to set as default', async () => {
      mockPromptResponses = {
        serverUrl: 'https://new-server.com',
        username: 'newuser',
        password: 'newpass',
        setAsDefault: false,
      }
      mockServerList = ['https://existing-server.com']

      await login(mockCliContext)

      assert.equal(storedCredentials.length, 1)
      assert.equal(storedCredentials[0].setAsDefault, false)
    })

    it('completes login flow successfully', async t => {
      mockPromptResponses = {
        serverUrl: 'https://example.com',
        username: 'testuser',
        password: 'testpass',
      }

      // Should not throw
      await login(mockCliContext)

      // Credentials should be stored
      assert.equal(storedCredentials.length, 1)
      t.assert.snapshot(output.lines.map(stripAnsi))
    })
  })

  describe('server connection', () => {
    it('throws error when server is unreachable', async () => {
      mockPromptResponses = {
        serverUrl: 'https://unreachable.com',
        username: 'testuser',
        password: 'testpass',
      }
      mockFetchError = new Error('ECONNREFUSED')

      await assert.rejects(async () => login(mockCliContext), /Failed to connect to server/)

      // Credentials should not be stored
      assert.equal(storedCredentials.length, 0)
    })

    it('throws error when server returns non-OK status', async () => {
      mockPromptResponses = {
        serverUrl: 'https://example.com',
        username: 'testuser',
        password: 'testpass',
      }
      mockFetchResponse = {ok: false, status: 500}

      await assert.rejects(async () => login(mockCliContext), /Server returned status 500/)

      // Credentials should not be stored
      assert.equal(storedCredentials.length, 0)
    })

    it('throws error when server returns 401 status (invalid credentials)', async () => {
      mockPromptResponses = {
        serverUrl: 'https://example.com',
        username: 'testuser',
        password: 'testpass',
      }
      mockFetchResponse = {ok: false, status: 401}

      await assert.rejects(async () => login(mockCliContext), /Invalid username or password/)

      // Credentials should not be stored
      assert.equal(storedCredentials.length, 0)
    })
  })

  describe('URL sanitization', () => {
    it('sanitizes server URL before storing', async () => {
      mockPromptResponses = {
        serverUrl: 'https://example.com/',
        username: 'testuser',
        password: 'testpass',
      }

      await login(mockCliContext)

      assert.equal(storedCredentials.length, 1)
      // URL should be sanitized (trailing slash removed by sanitizeServerUrl)
      assert.equal(storedCredentials[0].serverUrl, 'https://example.com')
    })

    it('sanitizes URL with path before storing', async () => {
      mockPromptResponses = {
        serverUrl: 'https://example.com/some/path?query=1',
        username: 'testuser',
        password: 'testpass',
      }

      await login(mockCliContext)

      assert.equal(storedCredentials.length, 1)
      // URL should be sanitized to just protocol and host
      assert.equal(storedCredentials[0].serverUrl, 'https://example.com')
    })
  })

  describe('validation', () => {
    it('rejects invalid server URL', async () => {
      mockPromptResponses = {
        serverUrl: 'not-a-url',
        username: 'testuser',
        password: 'testpass',
      }

      await assert.rejects(async () => login(mockCliContext), /valid URL/)
    })

    it('rejects empty username', async () => {
      mockPromptResponses = {
        serverUrl: 'https://example.com',
        username: '   ',
        password: 'testpass',
      }

      await assert.rejects(async () => login(mockCliContext), /Username is required/)
    })

    it('rejects empty password', async () => {
      mockPromptResponses = {
        serverUrl: 'https://example.com',
        username: 'testuser',
        password: '   ',
      }

      await assert.rejects(async () => login(mockCliContext), /Password is required/)
    })

    it('rejects login when server returns error status', async () => {
      mockFetchResponse = {ok: false, status: 500}
      mockPromptResponses = {
        serverUrl: 'https://example.com',
        username: 'testuser',
        password: 'testpass',
      }

      await assert.rejects(async () => login(mockCliContext), /Server returned status 500/)

      assert.equal(storedCredentials.length, 0)
    })
  })

  describe('URL argument', () => {
    it('skywriter login https://reggi@example.com', async t => {
      mockPromptResponses = {password: 'mypass'}

      await login(mockCliContext, {url: 'https://reggi@example.com'})

      assert.equal(storedCredentials.length, 1)
      assert.equal(storedCredentials[0].serverUrl, 'https://example.com')
      assert.equal(storedCredentials[0].username, 'reggi')
      assert.equal(storedCredentials[0].password, 'mypass')
      t.assert.snapshot(output.lines.map(stripAnsi))
    })

    it('skywriter login https://example.com (prompts username)', async t => {
      mockPromptResponses = {username: 'reggi', password: 'mypass'}

      await login(mockCliContext, {url: 'https://example.com'})

      assert.equal(storedCredentials.length, 1)
      assert.equal(storedCredentials[0].serverUrl, 'https://example.com')
      assert.equal(storedCredentials[0].username, 'reggi')
      t.assert.snapshot(output.lines.map(stripAnsi))
    })

    it('skywriter login https://reggi:pass@example.com (warns about password in URL)', async t => {
      await login(mockCliContext, {url: 'https://reggi:pass@example.com'})

      assert.equal(storedCredentials.length, 1)
      assert.equal(storedCredentials[0].username, 'reggi')
      assert.equal(storedCredentials[0].password, 'pass')
      t.assert.snapshot(output.lines.map(stripAnsi))
    })

    it('skywriter login https://reggi@example.com --yes', async t => {
      mockPromptResponses = {password: 'mypass'}
      mockServerList = ['existing']

      await login(mockCliContext, {url: 'https://reggi@example.com', yes: true})

      assert.equal(storedCredentials.length, 1)
      assert.equal(storedCredentials[0].setAsDefault, true)
      t.assert.snapshot(output.lines.map(stripAnsi))
    })
  })

  describe('--use-env', () => {
    const envKey = 'WONDOC_SECRET'
    let originalEnv: string | undefined

    beforeEach(() => {
      originalEnv = process.env[envKey]
    })

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env[envKey]
      } else {
        process.env[envKey] = originalEnv
      }
    })

    it('skywriter login --use-env (WONDOC_SECRET=password, with url arg)', async t => {
      process.env[envKey] = 'mypass'

      await login(mockCliContext, {url: 'https://reggi@example.com', useEnv: true})

      assert.equal(storedCredentials.length, 1)
      assert.equal(storedCredentials[0].password, 'mypass')
      assert.equal(storedCredentials[0].username, 'reggi')
      t.assert.snapshot(output.lines.map(stripAnsi))
    })

    it('skywriter login --use-env -y (WONDOC_SECRET=full URL)', async t => {
      process.env[envKey] = 'https://reggi:secret@example.com'

      await login(mockCliContext, {useEnv: true, yes: true})

      assert.equal(storedCredentials.length, 1)
      assert.equal(storedCredentials[0].serverUrl, 'https://example.com')
      assert.equal(storedCredentials[0].username, 'reggi')
      assert.equal(storedCredentials[0].password, 'secret')
      assert.equal(storedCredentials[0].setAsDefault, true)
      t.assert.snapshot(output.lines.map(stripAnsi))
    })

    it('skywriter login --use-env (WONDOC_SECRET=url with user only)', async t => {
      process.env[envKey] = 'https://reggi@example.com'
      mockPromptResponses = {password: 'prompted'}

      await login(mockCliContext, {useEnv: true})

      assert.equal(storedCredentials.length, 1)
      assert.equal(storedCredentials[0].username, 'reggi')
      assert.equal(storedCredentials[0].password, 'prompted')
      t.assert.snapshot(output.lines.map(stripAnsi))
    })

    it('skywriter login --use-env (WONDOC_SECRET not set, errors)', async t => {
      delete process.env[envKey]

      let error: string | undefined
      try {
        await login(mockCliContext, {useEnv: true})
        assert.fail('Expected error')
      } catch (err) {
        error = (err as Error).message
      }
      t.assert.snapshot([...output.lines.map(stripAnsi), error])
    })

    it('skywriter login https://reggi@example.com --use-env (WONDOC_SECRET=URL, collision errors)', async t => {
      process.env[envKey] = 'https://other@other.com'

      let error: string | undefined
      try {
        await login(mockCliContext, {url: 'https://reggi@example.com', useEnv: true})
        assert.fail('Expected error')
      } catch (err) {
        error = (err as Error).message
      }
      t.assert.snapshot([...output.lines.map(stripAnsi), error])
    })
  })
})
