import {describe, it, afterEach, beforeEach, mock} from 'node:test'
import assert from 'node:assert/strict'
import {rm, mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {CliContext} from '../../../src/cli/utils/types.ts'
import type {PrefixLog} from '../../../src/cli/utils/prefixLog.ts'

const testTmpDir = join(tmpdir(), `credentials-windows-test-${Date.now()}`)

// Mock CliContext for testing
const mockCtx: CliContext = {
  cliName: 'wondoc',
  cliId: 'wondoc',
  cwd: process.cwd(),
}

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

// Track executed commands
let executedCommands: {file: string; args: string[]}[] = []
let mockCommandResults: Map<string, {stdout: string; stderr: string; error?: Error}> = new Map()

// Helper to build a lookup key from file + args for mock results
function commandKey(file: string, args: string[]): string {
  return [file, ...args].join(' ')
}

// Mock child_process to intercept execFile calls
mock.module('node:child_process', {
  namedExports: {
    execFile: (
      file: string,
      args: string[],
      callback: (error: Error | null, result: {stdout: string; stderr: string}) => void,
    ) => {
      executedCommands.push({file, args})
      const key = commandKey(file, args)
      const result = mockCommandResults.get(key)
      if (result?.error) {
        callback(result.error, {stdout: result.stdout || '', stderr: result.stderr || ''})
      } else if (result) {
        callback(null, {stdout: result.stdout, stderr: result.stderr})
      } else {
        // Default: command succeeds with empty output
        callback(null, {stdout: '', stderr: ''})
      }
    },
  },
})

// Mock os.platform to simulate Windows
mock.module('node:os', {
  namedExports: {
    platform: () => 'win32',
    homedir: () => testTmpDir,
  },
})

// Import after mocking
const {getCredentialBackendName} = await import('../../../src/cli/utils/credentials.ts')
const {readServerConfig} = await import('../../../src/cli/utils/config.ts')

// Helper: read config and call methods
async function storeCredentials(
  ctx: CliContext,
  log: PrefixLog,
  serverUrl: string,
  username: string,
  password: string,
  setAsDefault = true,
) {
  const config = await readServerConfig(ctx, log)
  await config.storeCredentials(serverUrl, username, password, {setAsDefault})
}

async function retrieveCredentials(ctx: CliContext, log: PrefixLog, serverUrl: string, username: string) {
  const config = await readServerConfig(ctx, log)
  return config.retrieveCredentials(serverUrl, username)
}

async function deleteCredentials(ctx: CliContext, log: PrefixLog, serverUrl: string, username: string) {
  const config = await readServerConfig(ctx, log)
  await config.deleteCredentials(serverUrl, username)
}

async function listServers(ctx: CliContext, log: PrefixLog) {
  const config = await readServerConfig(ctx, log)
  return config.listServers()
}

// Capture proc-log output
let consoleOutput: string[] = []
let consoleWarnings: string[] = []

// Handler for proc-log events
const logHandler = (...args: unknown[]) => {
  const level = args[0] as string
  const messageParts = args.slice(1)
  const message = messageParts.map(String).join(' ')
  if (level === 'warn') {
    consoleWarnings.push(message)
  } else {
    consoleOutput.push(message)
  }
}

describe('credentials (Windows Credential Manager)', () => {
  beforeEach(async () => {
    consoleOutput = []
    consoleWarnings = []
    executedCommands = []
    mockCommandResults = new Map()
    process.on('log', logHandler)
    await mkdir(testTmpDir, {recursive: true})
  })

  afterEach(async () => {
    process.removeListener('log', logHandler)
    await rm(testTmpDir, {recursive: true, force: true})
  })

  describe('getCredentialBackendName', () => {
    it('returns Windows Credential Manager on win32', () => {
      const name = getCredentialBackendName()
      assert.equal(name, 'Windows Credential Manager')
    })
  })

  describe('storeCredentials', () => {
    it('calls cmdkey command to store credentials', async () => {
      // Mock the delete command (may fail if doesn't exist)
      mockCommandResults.set(commandKey('cmdkey', ['/delete', 'com.wondoc.cli:https://example.com:testuser']), {
        stdout: '',
        stderr: '',
        error: new Error('not found'),
      })

      await storeCredentials(mockCtx, mockLog, 'https://example.com', 'testuser', 'testpass')

      // Should have tried to delete existing credential first
      assert.ok(executedCommands.some(cmd => cmd.file === 'cmdkey' && cmd.args.includes('/delete')))
      // Should have added new credential
      assert.ok(executedCommands.some(cmd => cmd.file === 'cmdkey' && cmd.args.includes('/generic')))
      assert.ok(executedCommands.some(cmd => cmd.args.includes('testuser')))
      assert.ok(executedCommands.some(cmd => cmd.args.includes('testpass')))
    })

    it('adds server to list with default flag', async () => {
      await storeCredentials(mockCtx, mockLog, 'https://winserver.com', 'winuser', 'winpass', true)

      const servers = await listServers(mockCtx, mockLog)
      const server = servers.find(s => s.serverUrl === 'https://winserver.com')
      assert.ok(server)
      assert.equal(server.active, true)
    })
  })

  describe('retrieveCredentials', () => {
    it('returns null since Windows credential retrieval falls back', async () => {
      // Windows cmdkey doesn't support password retrieval via command line
      // The implementation throws an error which results in null
      const creds = await retrieveCredentials(mockCtx, mockLog, 'https://example.com', 'testuser')

      assert.equal(creds, null)
    })
  })

  describe('deleteCredentials', () => {
    it('calls cmdkey /delete command', async () => {
      // First store a credential
      await storeCredentials(mockCtx, mockLog, 'https://todelete.com', 'deleteuser', 'pass')
      executedCommands = []

      await deleteCredentials(mockCtx, mockLog, 'https://todelete.com', 'deleteuser')

      assert.ok(executedCommands.some(cmd => cmd.file === 'cmdkey' && cmd.args.includes('/delete')))
      assert.ok(executedCommands.some(cmd => cmd.args.some(a => a.includes('https://todelete.com'))))
      assert.ok(executedCommands.some(cmd => cmd.args.some(a => a.includes('deleteuser'))))
    })

    it('removes server from list', async () => {
      await storeCredentials(mockCtx, mockLog, 'https://winremove.com', 'removeuser', 'pass')
      let servers = await listServers(mockCtx, mockLog)
      assert.ok(servers.some(s => s.serverUrl === 'https://winremove.com'))

      await deleteCredentials(mockCtx, mockLog, 'https://winremove.com', 'removeuser')

      servers = await listServers(mockCtx, mockLog)
      assert.ok(!servers.some(s => s.serverUrl === 'https://winremove.com'))
    })
  })

  describe('listServers', () => {
    it('returns servers from config file', async () => {
      await storeCredentials(mockCtx, mockLog, 'https://winlist.com', 'listuser', 'pass', true)

      const servers = await listServers(mockCtx, mockLog)

      assert.ok(servers.some(s => s.serverUrl === 'https://winlist.com'))
    })
  })
})
