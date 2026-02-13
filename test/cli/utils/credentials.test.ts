import {describe, it, afterEach, beforeEach, mock} from 'node:test'
import assert from 'node:assert/strict'
import {rm, readFile, mkdir, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {CliContext} from '../../../src/cli/utils/types.ts'
import type {PrefixLog} from '../../../src/cli/utils/prefixLog.ts'

// Create unique temp directory for each test run
const testTmpDir = join(tmpdir(), `credentials-file-test-${Date.now()}`)

// Mock CliContext for testing
const mockCtx: CliContext = {
  cliName: 'wondoc',
  cliId: 'wondoc',
  cwd: process.cwd(),
}

const mockLog: PrefixLog = {
  info: () => {},
  warn: (msg: string) => {
    consoleWarnings.push(msg)
  },
  error: () => {},
  verbose: () => {},
  exec: () => {},
  http: () => {},
  fs: () => {},
  prefix: () => mockLog,
}

// Track executed commands
let executedCommands: string[] = []

// Mock child_process to intercept exec calls
mock.module('node:child_process', {
  namedExports: {
    exec: (command: string, callback: (error: Error | null, result: {stdout: string; stderr: string}) => void) => {
      executedCommands.push(command)
      callback(null, {stdout: '', stderr: ''})
    },
  },
})

// Mock os.platform to simulate unknown OS (falls back to file storage)
mock.module('node:os', {
  namedExports: {
    platform: () => 'freebsd', // Unknown platform - falls back to file storage
    homedir: () => testTmpDir,
  },
})

// Import after mocking
const {getCredentialBackendName} = await import('../../../src/cli/utils/credentials.ts')
const {readServerConfig} = await import('../../../src/cli/utils/config.ts')

// Helper: read config and call methods (re-reads each time since tests write to disk)
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

async function getDefaultServer(ctx: CliContext, log: PrefixLog) {
  const config = await readServerConfig(ctx, log)
  return config.getDefaultServer()
}

async function setDefaultServer(ctx: CliContext, log: PrefixLog, serverUrl: string, username: string) {
  const config = await readServerConfig(ctx, log)
  await config.setDefaultServer(serverUrl, username)
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

describe('credentials (File-based storage)', () => {
  beforeEach(async () => {
    consoleOutput = []
    consoleWarnings = []
    executedCommands = []
    process.on('log', logHandler)
    // Ensure temp directory exists
    await mkdir(testTmpDir, {recursive: true})
  })

  afterEach(async () => {
    process.removeListener('log', logHandler)
    // Clean up temp directory
    await rm(testTmpDir, {recursive: true, force: true})
  })

  describe('getCredentialBackendName', () => {
    it('returns File backend name for unknown platform', () => {
      const name = getCredentialBackendName()
      assert.equal(name, 'File (plaintext - not recommended)')
    })
  })

  describe('storeCredentials', () => {
    it('stores credentials in config file and shows warning', async () => {
      await storeCredentials(mockCtx, mockLog, 'https://fileserver.com', 'fileuser', 'filepass')

      // Should have shown warning about plaintext storage
      assert.ok(consoleWarnings.some(w => w.includes('plain text')))

      // Verify credentials were stored in config file
      const configFile = join(testTmpDir, '.wondoc.json')
      const content = await readFile(configFile, 'utf-8')
      const config = JSON.parse(content)

      assert.ok(config.servers['https://fileuser@fileserver.com'])
      assert.equal(config.servers['https://fileuser@fileserver.com'].password, 'filepass')
    })

    it('sets server as default', async () => {
      await storeCredentials(mockCtx, mockLog, 'https://filedefault.com', 'user', 'pass', true)

      const servers = await listServers(mockCtx, mockLog)
      const server = servers.find(s => s.serverUrl === 'https://filedefault.com')
      assert.ok(server)
      assert.equal(server.active, true)
    })

    it('does not set as default when setAsDefault is false', async () => {
      // First add a default server
      await storeCredentials(mockCtx, mockLog, 'https://first.com', 'user1', 'pass1', true)
      // Then add another without setting as default
      await storeCredentials(mockCtx, mockLog, 'https://second.com', 'user2', 'pass2', false)

      const servers = await listServers(mockCtx, mockLog)
      const first = servers.find(s => s.serverUrl === 'https://first.com')
      const second = servers.find(s => s.serverUrl === 'https://second.com')

      assert.equal(first?.active, true)
      assert.equal(second?.active, false)
    })

    it('updates existing credential for same server/username', async () => {
      await storeCredentials(mockCtx, mockLog, 'https://update.com', 'updateuser', 'oldpass')
      await storeCredentials(mockCtx, mockLog, 'https://update.com', 'updateuser', 'newpass')

      const creds = await retrieveCredentials(mockCtx, mockLog, 'https://update.com', 'updateuser')
      assert.equal(creds?.password, 'newpass')
    })
  })

  describe('retrieveCredentials', () => {
    it('retrieves stored credentials from file', async () => {
      await storeCredentials(mockCtx, mockLog, 'https://retrieve.com', 'retrieveuser', 'retrievepass')

      const creds = await retrieveCredentials(mockCtx, mockLog, 'https://retrieve.com', 'retrieveuser')

      assert.equal(creds?.serverUrl, 'https://retrieve.com')
      assert.equal(creds?.username, 'retrieveuser')
      assert.equal(creds?.password, 'retrievepass')
    })

    it('returns null when credentials not found', async () => {
      const creds = await retrieveCredentials(mockCtx, mockLog, 'https://notfound.com', 'nobody')

      assert.equal(creds, null)
    })

    it('returns null when credentials file does not exist', async () => {
      // Don't create any credentials - file won't exist
      const creds = await retrieveCredentials(mockCtx, mockLog, 'https://nofile.com', 'nouser')

      assert.equal(creds, null)
    })
  })

  describe('deleteCredentials', () => {
    it('removes credentials from file', async () => {
      await storeCredentials(mockCtx, mockLog, 'https://delete.com', 'deleteuser', 'deletepass')

      // Verify it exists
      let creds = await retrieveCredentials(mockCtx, mockLog, 'https://delete.com', 'deleteuser')
      assert.ok(creds)

      // Delete it
      await deleteCredentials(mockCtx, mockLog, 'https://delete.com', 'deleteuser')

      // Verify it's gone
      creds = await retrieveCredentials(mockCtx, mockLog, 'https://delete.com', 'deleteuser')
      assert.equal(creds, null)
    })

    it('removes server from list', async () => {
      await storeCredentials(mockCtx, mockLog, 'https://removelist.com', 'removeuser', 'pass')
      let servers = await listServers(mockCtx, mockLog)
      assert.ok(servers.some(s => s.serverUrl === 'https://removelist.com'))

      await deleteCredentials(mockCtx, mockLog, 'https://removelist.com', 'removeuser')

      servers = await listServers(mockCtx, mockLog)
      assert.ok(!servers.some(s => s.serverUrl === 'https://removelist.com'))
    })

    it('clears active when deleting default server', async () => {
      await storeCredentials(mockCtx, mockLog, 'https://default1.com', 'user1', 'pass1', true)
      await storeCredentials(mockCtx, mockLog, 'https://default2.com', 'user2', 'pass2', false)

      // Delete the default
      await deleteCredentials(mockCtx, mockLog, 'https://default1.com', 'user1')

      const servers = await listServers(mockCtx, mockLog)
      // No server should be active
      const remaining = servers.find(s => s.serverUrl === 'https://default2.com')
      assert.equal(remaining?.active, false)
    })

    it('handles deletion when no credentials exist', async () => {
      // Should not throw
      await deleteCredentials(mockCtx, mockLog, 'https://nonexistent.com', 'nobody')
    })

    it('removes password from config when credential is deleted', async () => {
      await storeCredentials(mockCtx, mockLog, 'https://onlyone.com', 'onlyuser', 'pass')
      await deleteCredentials(mockCtx, mockLog, 'https://onlyone.com', 'onlyuser')

      // Verify password was removed from config
      const configFile = join(testTmpDir, '.wondoc.json')
      const content = await readFile(configFile, 'utf-8')
      const config = JSON.parse(content)
      assert.equal(config.servers?.['https://onlyuser@onlyone.com']?.password, undefined)
    })
  })

  describe('listServers', () => {
    it('returns empty array when no servers configured', async () => {
      const servers = await listServers(mockCtx, mockLog)
      assert.deepEqual(servers, [])
    })

    it('returns all configured servers', async () => {
      await storeCredentials(mockCtx, mockLog, 'https://list1.com', 'user1', 'pass1', true)
      await storeCredentials(mockCtx, mockLog, 'https://list2.com', 'user2', 'pass2', false)
      await storeCredentials(mockCtx, mockLog, 'https://list3.com', 'user3', 'pass3', false)

      const servers = await listServers(mockCtx, mockLog)

      assert.equal(servers.length, 3)
      assert.ok(servers.some(s => s.serverUrl === 'https://list1.com'))
      assert.ok(servers.some(s => s.serverUrl === 'https://list2.com'))
      assert.ok(servers.some(s => s.serverUrl === 'https://list3.com'))
    })
  })

  describe('getDefaultServer', () => {
    it('returns null when no servers configured', async () => {
      const server = await getDefaultServer(mockCtx, mockLog)
      assert.equal(server, null)
    })

    it('returns null when servers exist but none is default', async () => {
      // Create server list file manually without any default
      const serverListFile = join(testTmpDir, '.wondoc.json')
      await writeFile(
        serverListFile,
        JSON.stringify([
          {serverUrl: 'https://nodefault1.com', username: 'user1', active: false},
          {serverUrl: 'https://nodefault2.com', username: 'user2', active: false},
        ]),
      )

      const server = await getDefaultServer(mockCtx, mockLog)
      assert.equal(server, null)
    })

    it('retrieves credentials for default server', async () => {
      await storeCredentials(mockCtx, mockLog, 'https://getdefault.com', 'defaultuser', 'defaultpass', true)

      const server = await getDefaultServer(mockCtx, mockLog)

      assert.equal(server?.serverUrl, 'https://getdefault.com')
      assert.equal(server?.username, 'defaultuser')
      assert.equal(server?.password, 'defaultpass')
    })
  })

  describe('setDefaultServer', () => {
    it('updates which server is default', async () => {
      await storeCredentials(mockCtx, mockLog, 'https://setdef1.com', 'user1', 'pass1', true)
      await storeCredentials(mockCtx, mockLog, 'https://setdef2.com', 'user2', 'pass2', false)

      // Verify initial state
      let servers = await listServers(mockCtx, mockLog)
      assert.equal(servers.find(s => s.serverUrl === 'https://setdef1.com')?.active, true)
      assert.equal(servers.find(s => s.serverUrl === 'https://setdef2.com')?.active, false)

      // Change default
      await setDefaultServer(mockCtx, mockLog, 'https://setdef2.com', 'user2')

      // Verify new state
      servers = await listServers(mockCtx, mockLog)
      assert.equal(servers.find(s => s.serverUrl === 'https://setdef1.com')?.active, false)
      assert.equal(servers.find(s => s.serverUrl === 'https://setdef2.com')?.active, true)
    })

    it('handles setDefaultServer when server list is empty', async () => {
      // Should not throw even if server doesn't exist
      await setDefaultServer(mockCtx, mockLog, 'https://nonexistent.com', 'nobody')

      const servers = await listServers(mockCtx, mockLog)
      assert.deepEqual(servers, [])
    })
  })

  describe('FileCredentialStore list method', () => {
    it('returns list of stored credentials from file', async () => {
      await storeCredentials(mockCtx, mockLog, 'https://filelist1.com', 'user1', 'pass1')
      await storeCredentials(mockCtx, mockLog, 'https://filelist2.com', 'user2', 'pass2')

      // The file store list should return credentials (verify via servers)
      const servers = await listServers(mockCtx, mockLog)
      assert.ok(servers.length >= 2)
    })
  })
})
