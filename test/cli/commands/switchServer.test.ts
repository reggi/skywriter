import {describe, it, afterEach, beforeEach, mock} from 'node:test'
import assert from 'node:assert/strict'
import {stripAnsi} from '../../helpers/stripAnsi.ts'

// Shared output array - mocks and tests both push here
const output: {lines: string[]} = {lines: []}

// Mock data
let mockServers: Array<{serverUrl: string; username: string; active: boolean}> = []
let lastSetDefault: {serverUrl: string; username: string} | null = null
let mockSelectResult: {serverUrl: string; username: string; active: boolean} | null = null

// Mock config module - emits same proc-log output as real functions
mock.module('../../../src/cli/utils/config.ts', {
  namedExports: {
    readServerConfig: async (
      _ctx: {cliId: string},
      cmdLog: {info: (msg: string) => void; fs: (msg: string) => void},
    ) => ({
      listServers: () => {
        if (mockServers.length > 0) {
          cmdLog.fs('reading ~/.wondoc.json')
        }
        return mockServers
      },
      setDefaultServer: async (serverUrl: string, username: string) => {
        lastSetDefault = {serverUrl, username}
        const url = new URL(serverUrl)
        url.username = username
        const key = url.href.replace(/\/$/, '')
        cmdLog.fs(`updating ~/.wondoc.json#active to ${key}`)
      },
    }),
  },
})

// Mock @inquirer/prompts - pushes to output so prompts appear in snapshots
mock.module('@inquirer/prompts', {
  namedExports: {
    select: async (options: {
      message: string
      choices: Array<{name: string; value: {serverUrl: string; username: string}}>
    }) => {
      const result = mockSelectResult
      const choice = options.choices?.find(
        c => c.value?.serverUrl === result?.serverUrl && c.value?.username === result?.username,
      )
      output.lines.push(`✔ ${options.message} ${choice?.name || ''}`)
      return result
    },
  },
})

// Import after mocking
const {switchServer} = await import('../../../src/cli/commands/switchServer.ts')
import {mockCliContext} from '../test-context.ts'

// Handler for proc-log events
const logHandler = (...args: unknown[]) => {
  const messageParts = args.slice(1)
  output.lines.push(messageParts.map(String).join(' '))
}

describe('switchServer', () => {
  beforeEach(() => {
    output.lines = []
    mockServers = []
    lastSetDefault = null
    mockSelectResult = null
    process.on('log', logHandler)
  })

  afterEach(() => {
    process.removeListener('log', logHandler)
  })

  describe('with no servers', () => {
    it('shows message to login when no servers exist', async t => {
      mockServers = []

      let error: string | undefined
      try {
        await switchServer(mockCliContext)
        assert.fail('Expected error')
      } catch (err) {
        error = (err as Error).message
      }
      t.assert.snapshot([...output.lines.map(stripAnsi), error])
    })
  })

  describe('with one server', () => {
    it('shows message that only one server is configured', async t => {
      mockServers = [{serverUrl: 'https://example.com', username: 'testuser', active: true}]

      await switchServer(mockCliContext)

      assert.ok(output.lines.some(line => line.includes('Only one server is configured')))
      assert.equal(lastSetDefault, null)
      t.assert.snapshot(output.lines.map(stripAnsi))
    })
  })

  describe('with multiple servers', () => {
    it('sets selected server as default', async t => {
      mockServers = [
        {serverUrl: 'https://server1.com', username: 'user1', active: true},
        {serverUrl: 'https://server2.com', username: 'user2', active: false},
      ]
      mockSelectResult = {serverUrl: 'https://server2.com', username: 'user2', active: false}

      await switchServer(mockCliContext)

      assert.deepEqual(lastSetDefault, {serverUrl: 'https://server2.com', username: 'user2'})
      t.assert.snapshot(output.lines.map(stripAnsi))
    })

    it('switches to a different server from three', async t => {
      mockServers = [
        {serverUrl: 'https://server1.com', username: 'user1', active: true},
        {serverUrl: 'https://server2.com', username: 'user2', active: false},
        {serverUrl: 'https://server3.com', username: 'user3', active: false},
      ]
      mockSelectResult = {serverUrl: 'https://server3.com', username: 'user3', active: false}

      await switchServer(mockCliContext)

      assert.deepEqual(lastSetDefault, {serverUrl: 'https://server3.com', username: 'user3'})
      t.assert.snapshot(output.lines.map(stripAnsi))
    })

    it('allows selecting the current default server (no-op switch)', async t => {
      mockServers = [
        {serverUrl: 'https://server1.com', username: 'user1', active: true},
        {serverUrl: 'https://server2.com', username: 'user2', active: false},
      ]
      mockSelectResult = {serverUrl: 'https://server1.com', username: 'user1', active: true}

      await switchServer(mockCliContext)

      assert.equal(lastSetDefault, null)
      t.assert.snapshot(output.lines.map(stripAnsi))
    })
  })

  describe('URL argument', () => {
    it('switches directly when URL with username provided', async t => {
      mockServers = [
        {serverUrl: 'https://server1.com', username: 'user1', active: true},
        {serverUrl: 'https://server2.com', username: 'user2', active: false},
      ]

      await switchServer(mockCliContext, 'https://user2@server2.com')

      assert.deepEqual(lastSetDefault, {serverUrl: 'https://server2.com', username: 'user2'})
      t.assert.snapshot(output.lines.map(stripAnsi))
    })

    it('errors when URL has no username', async t => {
      mockServers = [{serverUrl: 'https://server1.com', username: 'user1', active: true}]

      let error: string | undefined
      try {
        await switchServer(mockCliContext, 'https://server1.com')
        assert.fail('Expected error')
      } catch (err) {
        error = (err as Error).message
      }
      assert.equal(lastSetDefault, null)
      t.assert.snapshot([...output.lines.map(stripAnsi), error])
    })

    it('errors when server not found', async t => {
      mockServers = [{serverUrl: 'https://server1.com', username: 'user1', active: true}]

      let error: string | undefined
      try {
        await switchServer(mockCliContext, 'https://reggi@other.com')
        assert.fail('Expected error')
      } catch (err) {
        error = (err as Error).message
      }
      assert.equal(lastSetDefault, null)
      t.assert.snapshot([...output.lines.map(stripAnsi), error])
    })
  })
})
