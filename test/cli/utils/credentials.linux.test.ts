import {describe, it, afterEach, beforeEach, mock} from 'node:test'
import assert from 'node:assert/strict'
import {rm, mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {CliContext} from '../../../src/cli/utils/types.ts'
import type {PrefixLog} from '../../../src/cli/utils/prefixLog.ts'

const testTmpDir = join(tmpdir(), `credentials-linux-test-${Date.now()}`)

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
      callback?: (error: Error | null, result: {stdout: string; stderr: string}) => void,
    ) => {
      executedCommands.push({file, args})
      const key = commandKey(file, args)
      const result = mockCommandResults.get(key)
      if (callback) {
        if (result?.error) {
          callback(result.error, {stdout: result.stdout || '', stderr: result.stderr || ''})
        } else if (result) {
          callback(null, {stdout: result.stdout, stderr: result.stderr})
        } else {
          callback(null, {stdout: '', stderr: ''})
        }
      }
      // For the store method which uses the non-promisified form with stdin piping,
      // return a mock child process object
      const handlers: Record<string, ((...args: unknown[]) => void)[]> = {}
      const child = {
        stdin: {
          write: () => {},
          end: () => {},
        },
        on: (event: string, handler: (...args: unknown[]) => void) => {
          if (!handlers[event]) handlers[event] = []
          handlers[event].push(handler)
          // Auto-resolve close event
          if (event === 'close') {
            if (result?.error) {
              setTimeout(() => handler(1), 0)
            } else {
              setTimeout(() => handler(0), 0)
            }
          }
          return child
        },
      }
      return child
    },
  },
})

// Mock os.platform to simulate Linux
mock.module('node:os', {
  namedExports: {
    platform: () => 'linux',
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

describe('credentials (Linux Secret Service)', () => {
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
    it('returns Linux Secret Service on linux', () => {
      const name = getCredentialBackendName()
      assert.equal(name, 'Linux Secret Service')
    })
  })

  describe('storeCredentials', () => {
    it('calls secret-tool store command', async () => {
      await storeCredentials(mockCtx, mockLog, 'https://example.com', 'testuser', 'testpass')

      // Should have called secret-tool store
      assert.ok(executedCommands.some(cmd => cmd.file === 'secret-tool' && cmd.args.includes('store')))
      assert.ok(executedCommands.some(cmd => cmd.args.includes('https://example.com')))
      assert.ok(executedCommands.some(cmd => cmd.args.includes('testuser')))
    })

    it('throws error when secret-tool is not available', async () => {
      // Mock secret-tool to fail
      mockCommandResults.set(
        commandKey('secret-tool', [
          'store',
          '--label',
          'wondoc (https://nosecret.com)',
          'service',
          'com.wondoc.cli',
          'server',
          'https://nosecret.com',
          'username',
          'failuser',
        ]),
        {stdout: '', stderr: 'secret-tool not found', error: new Error('command not found')},
      )

      await assert.rejects(async () => {
        await storeCredentials(mockCtx, mockLog, 'https://nosecret.com', 'failuser', 'testpass')
      }, /Linux keyring not available/)
    })
  })

  describe('retrieveCredentials', () => {
    it('calls secret-tool lookup command', async () => {
      // First store so server is in list
      await storeCredentials(mockCtx, mockLog, 'https://lookup.com', 'lookupuser', 'lookuppass')
      executedCommands = []

      mockCommandResults.set(
        commandKey('secret-tool', [
          'lookup',
          'service',
          'com.wondoc.cli',
          'server',
          'https://lookup.com',
          'username',
          'lookupuser',
        ]),
        {stdout: 'lookuppass\n', stderr: ''},
      )

      const creds = await retrieveCredentials(mockCtx, mockLog, 'https://lookup.com', 'lookupuser')

      assert.ok(executedCommands.some(cmd => cmd.file === 'secret-tool' && cmd.args.includes('lookup')))
      assert.equal(creds?.password, 'lookuppass')
    })

    it('returns null when credential not found', async () => {
      mockCommandResults.set(
        commandKey('secret-tool', [
          'lookup',
          'service',
          'com.wondoc.cli',
          'server',
          'https://notfound.com',
          'username',
          'nobody',
        ]),
        {stdout: '', stderr: '', error: new Error('not found')},
      )

      const creds = await retrieveCredentials(mockCtx, mockLog, 'https://notfound.com', 'nobody')

      assert.equal(creds, null)
    })
  })

  describe('deleteCredentials', () => {
    it('calls secret-tool clear command', async () => {
      // First store a credential
      await storeCredentials(mockCtx, mockLog, 'https://todelete.com', 'deleteuser', 'pass')
      executedCommands = []

      await deleteCredentials(mockCtx, mockLog, 'https://todelete.com', 'deleteuser')

      assert.ok(executedCommands.some(cmd => cmd.file === 'secret-tool' && cmd.args.includes('clear')))
      assert.ok(executedCommands.some(cmd => cmd.args.includes('https://todelete.com')))
      assert.ok(executedCommands.some(cmd => cmd.args.includes('deleteuser')))
    })
  })

  describe('listServers', () => {
    it('returns stored servers from config file', async () => {
      await storeCredentials(mockCtx, mockLog, 'https://list1.com', 'user1', 'pass1', true)
      await storeCredentials(mockCtx, mockLog, 'https://list2.com', 'user2', 'pass2', false)

      const servers = await listServers(mockCtx, mockLog)

      assert.ok(servers.some(s => s.serverUrl === 'https://list1.com'))
      assert.ok(servers.some(s => s.serverUrl === 'https://list2.com'))
    })
  })
})
