import {describe, it, afterEach, beforeEach, mock} from 'node:test'
import assert from 'node:assert/strict'
import type {CliContext} from '../../../src/cli/utils/types.ts'
import type {PrefixLog} from '../../../src/cli/utils/prefixLog.ts'
import {stripAnsi} from '../../helpers/stripAnsi.ts'

// Mock CliContext for testing
const mockCtx: CliContext = {
  cliName: 'wondoc',
  cliId: 'wondoc',
  cwd: process.cwd(),
}

// Shared output array - mocks and tests both push here
const output: {lines: string[]} = {lines: []}

// Mock data
let mockServers: Array<{serverUrl: string; username: string; active: boolean}> = []
let deletedCredentials: Array<{serverUrl: string; username: string}> = []
let mockSelectResult: {serverUrl: string; username: string; active: boolean} | null = null
let mockConfirmResult = false

// Mock credentials module - emits same proc-log output as real functions
mock.module('../../../src/cli/utils/credentials.ts', {
  namedExports: {
    listServers: async (_ctx: CliContext, cmdLog: PrefixLog) => {
      if (mockServers.length > 0) {
        cmdLog.fs('reading ~/.wondoc.json')
      }
      return mockServers
    },
    deleteCredentials: async (_ctx: CliContext, cmdLog: PrefixLog, serverUrl: string, username: string) => {
      deletedCredentials.push({serverUrl, username})
      const host = new URL(serverUrl).host
      const url = new URL(serverUrl)
      url.username = username
      const key = url.href.replace(/\/$/, '')
      cmdLog.info(`deleting credentials for ${username}@${host}`)
      cmdLog.fs(`removing ~/.wondoc.json#servers.${key}`)
    },
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
    confirm: async (options: {message: string}) => {
      const result = mockConfirmResult
      output.lines.push(`✔ ${options.message} ${result ? 'Yes' : 'No'}`)
      return result
    },
  },
})

// Import after mocking
const {logout} = await import('../../../src/cli/commands/logout.ts')

// Handler for proc-log events
const logHandler = (...args: unknown[]) => {
  const messageParts = args.slice(1)
  output.lines.push(messageParts.map(String).join(' '))
}

describe('logout', () => {
  beforeEach(() => {
    output.lines = []
    mockServers = []
    deletedCredentials = []
    mockSelectResult = null
    mockConfirmResult = false
    process.on('log', logHandler)
  })

  afterEach(() => {
    process.removeListener('log', logHandler)
  })

  describe('with no servers', () => {
    it('shows message when no servers are configured', async t => {
      mockServers = []

      await logout(mockCtx)

      assert.ok(output.lines.some(line => line.includes('No servers configured')))
      assert.equal(deletedCredentials.length, 0)
      t.assert.snapshot(output.lines.map(stripAnsi))
    })
  })

  describe('with servers configured', () => {
    it('deletes credentials when user confirms', async t => {
      mockServers = [{serverUrl: 'https://example.com', username: 'testuser', active: true}]
      mockSelectResult = {serverUrl: 'https://example.com', username: 'testuser', active: true}
      mockConfirmResult = true

      await logout(mockCtx)

      assert.equal(deletedCredentials.length, 1)
      assert.deepEqual(deletedCredentials[0], {serverUrl: 'https://example.com', username: 'testuser'})
      assert.ok(output.lines.some(line => line.includes('✓')))
      assert.ok(output.lines.some(line => line.includes('Logged out from')))
      assert.ok(output.lines.some(line => line.includes('https://example.com')))
      t.assert.snapshot(output.lines.map(stripAnsi))
    })

    it('does not delete credentials when user declines', async t => {
      mockServers = [{serverUrl: 'https://example.com', username: 'testuser', active: true}]
      mockSelectResult = {serverUrl: 'https://example.com', username: 'testuser', active: true}
      mockConfirmResult = false

      await logout(mockCtx)

      assert.equal(deletedCredentials.length, 0)
      assert.ok(!output.lines.some(line => line.includes('Logged out from')))
      t.assert.snapshot(output.lines.map(stripAnsi))
    })

    it('allows selecting from multiple servers', async t => {
      mockServers = [
        {serverUrl: 'https://server1.com', username: 'user1', active: true},
        {serverUrl: 'https://server2.com', username: 'user2', active: false},
      ]
      mockSelectResult = {serverUrl: 'https://server2.com', username: 'user2', active: false}
      mockConfirmResult = true

      await logout(mockCtx)

      assert.equal(deletedCredentials.length, 1)
      assert.deepEqual(deletedCredentials[0], {serverUrl: 'https://server2.com', username: 'user2'})
      t.assert.snapshot(output.lines.map(stripAnsi))
    })

    it('can logout from non-default server', async t => {
      mockServers = [
        {serverUrl: 'https://server1.com', username: 'user1', active: true},
        {serverUrl: 'https://server2.com', username: 'user2', active: false},
        {serverUrl: 'https://server3.com', username: 'user3', active: false},
      ]
      mockSelectResult = {serverUrl: 'https://server3.com', username: 'user3', active: false}
      mockConfirmResult = true

      await logout(mockCtx)

      assert.deepEqual(deletedCredentials[0], {serverUrl: 'https://server3.com', username: 'user3'})
      assert.ok(output.lines.some(line => line.includes('https://server3.com')))
      assert.ok(output.lines.some(line => line.includes('user3')))
      t.assert.snapshot(output.lines.map(stripAnsi))
    })
  })

  describe('URL argument', () => {
    it('logs out directly when URL with username provided', async t => {
      mockServers = [{serverUrl: 'https://example.com', username: 'reggi', active: true}]
      mockConfirmResult = true

      await logout(mockCtx, {url: 'https://reggi@example.com'})

      assert.equal(deletedCredentials.length, 1)
      assert.deepEqual(deletedCredentials[0], {serverUrl: 'https://example.com', username: 'reggi'})
      t.assert.snapshot(output.lines.map(stripAnsi))
    })

    it('errors when URL has no username', async t => {
      mockServers = [{serverUrl: 'https://example.com', username: 'reggi', active: true}]

      let error: string | undefined
      try {
        await logout(mockCtx, {url: 'https://example.com'})
        assert.fail('Expected error')
      } catch (err) {
        error = (err as Error).message
      }
      assert.equal(deletedCredentials.length, 0)
      t.assert.snapshot([...output.lines.map(stripAnsi), error])
    })

    it('errors when server not found', async t => {
      mockServers = [{serverUrl: 'https://other.com', username: 'other', active: true}]

      let error: string | undefined
      try {
        await logout(mockCtx, {url: 'https://reggi@example.com'})
        assert.fail('Expected error')
      } catch (err) {
        error = (err as Error).message
      }
      assert.equal(deletedCredentials.length, 0)
      t.assert.snapshot([...output.lines.map(stripAnsi), error])
    })

    it('respects user declining confirmation', async t => {
      mockServers = [{serverUrl: 'https://example.com', username: 'reggi', active: true}]
      mockConfirmResult = false

      await logout(mockCtx, {url: 'https://reggi@example.com'})

      assert.equal(deletedCredentials.length, 0)
      t.assert.snapshot(output.lines.map(stripAnsi))
    })

    it('skips confirmation with --yes', async t => {
      mockServers = [{serverUrl: 'https://example.com', username: 'reggi', active: true}]

      await logout(mockCtx, {url: 'https://reggi@example.com', yes: true})

      assert.equal(deletedCredentials.length, 1)
      assert.deepEqual(deletedCredentials[0], {serverUrl: 'https://example.com', username: 'reggi'})
      t.assert.snapshot(output.lines.map(stripAnsi))
    })

    it('warns when password is in URL', async t => {
      mockServers = [{serverUrl: 'https://example.com', username: 'reggi', active: true}]
      mockConfirmResult = true

      await logout(mockCtx, {url: 'https://reggi:secret@example.com'})

      assert.equal(deletedCredentials.length, 1)
      assert.ok(output.lines.some(line => line.includes('Password in URL')))
      t.assert.snapshot(output.lines.map(stripAnsi))
    })
  })
})
