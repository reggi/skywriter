import {describe, it, mock, beforeEach, afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {stripAnsi} from '../../helpers/stripAnsi.ts'
import type {PrefixLog} from '../../../src/cli/utils/prefixLog.ts'
import type {ServerInfo} from '../../../src/cli/utils/types.ts'

// Shared output array - mocks and tests both push here
const output: {lines: string[]} = {lines: []}
const logHandler = (...args: unknown[]) => {
  const messageParts = args.slice(1)
  output.lines.push(messageParts.map(String).join(' '))
}

// Track stdout output (for non-log writes like `process.stdout.write`)
let stdoutOutput: string[] = []
const originalStdoutWrite = process.stdout.write

// Mock data
let mockServers: ServerInfo[] = []
let mockCredentials: {serverUrl: string; username: string; password: string} | null = null
let mockFetchResponse: {ok: boolean; status: number; statusText: string} = {ok: true, status: 200, statusText: 'OK'}

// Mock config module
mock.module('../../../src/cli/utils/config.ts', {
  namedExports: {
    readServerConfig: async (_ctx: unknown, cmdLog: {info: (msg: string) => void; fs: (msg: string) => void}) => ({
      listServers: () => {
        if (mockServers.length > 0) {
          cmdLog.fs('reading ~/.wondoc.json')
        }
        return mockServers
      },
      retrieveCredentials: async (serverUrl: string, username: string) => {
        cmdLog.info(`accessing credentials for ${username}@${new URL(serverUrl).host}`)
        return mockCredentials
      },
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

// Mock loggedFetch
mock.module('../../../src/cli/utils/loggedFetch.ts', {
  namedExports: {
    createLoggedFetch: (cmdLog: PrefixLog) => async (url: string, init?: RequestInit) => {
      const method = (init?.method || 'GET').toUpperCase()
      cmdLog.http(`${method} ${url} ${mockFetchResponse.status}`)
      return mockFetchResponse
    },
  },
})

// Import after mocking
const {whoami} = await import('../../../src/cli/commands/whoami.ts')
import {createMockCliContext} from '../test-context.ts'

describe('whoami', () => {
  beforeEach(() => {
    output.lines = []
    stdoutOutput = []
    mockServers = []
    mockCredentials = null
    mockFetchResponse = {ok: true, status: 200, statusText: 'OK'}
    process.stdout.write = (chunk: string | Uint8Array) => {
      stdoutOutput.push(String(chunk))
      return true
    }
    process.on('log', logHandler)
  })

  afterEach(() => {
    process.stdout.write = originalStdoutWrite
    process.removeListener('log', logHandler)
  })

  it('displays username@host when logged in', async t => {
    mockServers = [{serverUrl: 'https://my-server.com', username: 'myuser', active: true}]
    mockCredentials = {serverUrl: 'https://my-server.com', username: 'myuser', password: 'pass'}

    await whoami(createMockCliContext())

    t.assert.snapshot([...output.lines.map(stripAnsi), ...stdoutOutput.map(s => stripAnsi(s.trim())).filter(Boolean)])
  })

  it('outputs JSON when --json flag is set', async t => {
    mockServers = [{serverUrl: 'https://example.com', username: 'testuser', active: true}]
    mockCredentials = {serverUrl: 'https://example.com', username: 'testuser', password: 'pass'}

    await whoami(createMockCliContext({json: true}))

    t.assert.snapshot([...output.lines.map(stripAnsi), ...stdoutOutput.map(s => stripAnsi(s.trim())).filter(Boolean)])
  })

  it('throws when no servers exist', async t => {
    mockServers = []

    let error = ''
    try {
      await whoami(createMockCliContext())
    } catch (e) {
      error = (e as Error).message
    }

    t.assert.snapshot([...output.lines.map(stripAnsi), error])
  })

  it('throws when servers exist but no default', async t => {
    mockServers = [
      {serverUrl: 'https://server1.com', username: 'user1', active: false},
      {serverUrl: 'https://server2.com', username: 'user2', active: false},
    ]

    let error = ''
    try {
      await whoami(createMockCliContext())
    } catch (e) {
      error = (e as Error).message
    }

    t.assert.snapshot([...output.lines.map(stripAnsi), error])
  })

  it('throws when credentials are expired', async t => {
    mockServers = [{serverUrl: 'https://my-server.com', username: 'myuser', active: true}]
    mockCredentials = null

    let error = ''
    try {
      await whoami(createMockCliContext())
    } catch (e) {
      error = (e as Error).message
    }

    t.assert.snapshot([...output.lines.map(stripAnsi), error])
  })

  it('throws on verification failure', async t => {
    mockServers = [{serverUrl: 'https://my-server.com', username: 'myuser', active: true}]
    mockCredentials = {serverUrl: 'https://my-server.com', username: 'myuser', password: 'pass'}
    mockFetchResponse = {ok: false, status: 401, statusText: 'Unauthorized'}

    let error = ''
    try {
      await whoami(createMockCliContext())
    } catch (e) {
      error = (e as Error).message
    }

    t.assert.snapshot([...output.lines.map(stripAnsi), error])
  })

  it('outputs JSON error when no servers with --json', async t => {
    mockServers = []

    await whoami(createMockCliContext({json: true}))

    assert.equal(process.exitCode, 1)
    t.assert.snapshot([...output.lines.map(stripAnsi), ...stdoutOutput.map(s => stripAnsi(s.trim())).filter(Boolean)])
    process.exitCode = undefined as unknown as number
  })

  it('outputs JSON error when credentials expired with --json', async t => {
    mockServers = [{serverUrl: 'https://my-server.com', username: 'myuser', active: true}]
    mockCredentials = null

    await whoami(createMockCliContext({json: true}))

    assert.equal(process.exitCode, 1)
    t.assert.snapshot([...output.lines.map(stripAnsi), ...stdoutOutput.map(s => stripAnsi(s.trim())).filter(Boolean)])
    process.exitCode = undefined as unknown as number
  })
})
