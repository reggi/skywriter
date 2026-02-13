import {describe, it, afterEach, beforeEach, mock} from 'node:test'
import assert from 'node:assert/strict'
import {stripAnsi} from '../../helpers/stripAnsi.ts'

// Mock data
let mockServers: Array<{serverUrl: string; username: string; active: boolean}> = []

// Mock config module
mock.module('../../../src/cli/utils/config.ts', {
  namedExports: {
    readServerConfig: async () => ({
      listServers: () => mockServers,
      getCredentialBackendName: () => 'Test Backend',
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

// Import after mocking
const {sessions} = await import('../../../src/cli/commands/sessions.ts')
import {mockCliContext} from '../test-context.ts'

// Capture proc-log output
let consoleOutput: string[] = []
const logHandler = (...args: unknown[]) => {
  const messageParts = args.slice(1)
  consoleOutput.push(messageParts.map(String).join(' '))
}

// Capture stdout output
let stdoutOutput: string[] = []
const originalStdoutWrite = process.stdout.write

describe('sessions', () => {
  beforeEach(() => {
    consoleOutput = []
    stdoutOutput = []
    mockServers = []
    process.on('log', logHandler)
    process.stdout.write = (chunk: string | Uint8Array) => {
      stdoutOutput.push(String(chunk))
      return true
    }
  })

  afterEach(() => {
    process.removeListener('log', logHandler)
    process.stdout.write = originalStdoutWrite
  })

  it('wondoc sessions (no sessions)', async t => {
    mockServers = []

    let error: string | undefined
    try {
      await sessions(mockCliContext)
      assert.fail('Expected error')
    } catch (err) {
      error = (err as Error).message
    }
    t.assert.snapshot([...consoleOutput.map(stripAnsi), error])
  })

  it('wondoc sessions --json (no sessions)', async t => {
    mockServers = []

    await sessions({...mockCliContext, json: true})

    assert.equal(process.exitCode, 1)
    t.assert.snapshot([...consoleOutput.map(stripAnsi), ...stripAnsi(stdoutOutput.join('')).split('\n').slice(0, -1)])
    process.exitCode = undefined as unknown as number
  })

  it('wondoc sessions (one session)', async t => {
    mockServers = [{serverUrl: 'https://example.com', username: 'testuser', active: true}]

    await sessions(mockCliContext)

    t.assert.snapshot([...consoleOutput.map(stripAnsi), ...stripAnsi(stdoutOutput.join('')).split('\n').slice(0, -1)])
  })

  it('wondoc sessions (multiple sessions)', async t => {
    mockServers = [
      {serverUrl: 'https://server1.com', username: 'user1', active: true},
      {serverUrl: 'https://server2.com', username: 'user2', active: false},
      {serverUrl: 'https://server3.com', username: 'user3', active: false},
    ]

    await sessions(mockCliContext)

    t.assert.snapshot([...consoleOutput.map(stripAnsi), ...stripAnsi(stdoutOutput.join('')).split('\n').slice(0, -1)])
  })

  it('wondoc sessions --json (multiple sessions)', async t => {
    mockServers = [
      {serverUrl: 'https://server1.com', username: 'user1', active: true},
      {serverUrl: 'https://server2.com', username: 'user2', active: false},
    ]

    await sessions({...mockCliContext, json: true})

    t.assert.snapshot([...consoleOutput.map(stripAnsi), ...stripAnsi(stdoutOutput.join('')).split('\n').slice(0, -1)])
  })
})
