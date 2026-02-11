#!/usr/bin/env node
import {exec} from 'node:child_process'
import {promisify} from 'node:util'
import {platform} from 'node:os'
import {readFile, writeFile, chmod} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'
import type {CliContext, ServerInfo} from './types.ts'
import type {PrefixLog} from './prefixLog.ts'
import {createLoggedFs} from './createLoggedFs.ts'
import log from './log.ts'

const execAsync = promisify(exec)

interface ServerCredentials {
  serverUrl: string
  username: string
  password: string
}

function getKeychainService(cliId: string): string {
  return `com.${cliId}.cli`
}

function getConfigFilePath(cliId: string): string {
  return join(homedir(), `.${cliId}.json`)
}

/**
 * Build a server key like "https://reggi@domain.com" from serverUrl and username
 */
function serverKey(serverUrl: string, username: string): string {
  const url = new URL(serverUrl)
  url.username = username
  return url.href.replace(/\/$/, '')
}

/**
 * Parse a server key like "https://reggi@domain.com" into serverUrl and username
 */
function parseServerKey(key: string): {serverUrl: string; username: string} {
  const url = new URL(key)
  const username = url.username
  url.username = ''
  return {serverUrl: url.origin, username}
}

/**
 * Internal config format: {active, servers} object
 */
interface ServerConfig {
  active: string | null
  servers: Record<string, Record<string, unknown>>
}

/**
 * Validate the shape of the config file JSON.
 * Returns a valid ServerConfig or throws with a descriptive message.
 */
function validateConfigJson(data: unknown): ServerConfig {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Config file must contain a JSON object')
  }
  const obj = data as Record<string, unknown>
  if (obj.active !== undefined && obj.active !== null && typeof obj.active !== 'string') {
    throw new Error('Config "active" field must be a string or null')
  }
  if (
    obj.servers !== undefined &&
    (typeof obj.servers !== 'object' || obj.servers === null || Array.isArray(obj.servers))
  ) {
    throw new Error('Config "servers" field must be an object')
  }
  const servers = (obj.servers || {}) as Record<string, unknown>
  for (const key of Object.keys(servers)) {
    if (typeof servers[key] !== 'object' || servers[key] === null || Array.isArray(servers[key])) {
      throw new Error(`Config "servers.${key}" must be an object`)
    }
    try {
      const url = new URL(key)
      if (!url.username) {
        throw new Error(`Config server key "${key}" must include a username (e.g. https://user@host.com)`)
      }
    } catch (err) {
      if (err instanceof TypeError) {
        throw new Error(`Config server key "${key}" is not a valid URL`)
      }
      throw err
    }
  }
  if (obj.active != null) {
    const activeKey = obj.active as string
    if (!servers[activeKey]) {
      throw new Error(`Config "active" value "${activeKey}" does not match any server key`)
    }
  }
  return {active: (obj.active as string) || null, servers: servers as Record<string, Record<string, unknown>>}
}

/**
 * Read server config with logging and validation
 */
async function readServerConfigLogged(cliId: string, cmdLog: PrefixLog): Promise<ServerConfig> {
  const configFilePath = getConfigFilePath(cliId)
  const fs = createLoggedFs(cmdLog)
  try {
    const content = await fs.readFile(configFilePath)
    return validateConfigJson(JSON.parse(content))
  } catch {
    return {active: null, servers: {}}
  }
}

/**
 * Detect which credential storage backend to use
 * Can be overridden to 'file' via --auth-type=file flag
 * Only 'file' override is allowed - other backends are auto-detected based on OS
 */
function getCredentialBackend(authType?: 'file'): 'keychain' | 'keyring' | 'wincred' | 'file' {
  // Allow override to file-based storage via --auth-type=file flag
  if (authType === 'file') {
    return 'file'
  }

  const os = platform()

  if (os === 'darwin') {
    return 'keychain'
  } else if (os === 'linux') {
    // TODO: Could check for secret-tool availability
    return 'keyring'
  } else if (os === 'win32') {
    return 'wincred'
  }

  return 'file'
}

/**
 * macOS Keychain operations
 */
class KeychainCredentialStore {
  private cliName: string

  constructor(cliName: string) {
    this.cliName = cliName
  }

  async store(serverUrl: string, username: string, password: string): Promise<void> {
    // Delete existing credential if it exists (to update it)
    try {
      await execAsync(`security delete-internet-password -s "${serverUrl}" -a "${username}" 2>/dev/null`)
    } catch {
      // Ignore errors if credential doesn't exist
    }

    // Add new credential
    const cmd = `security add-internet-password -s "${serverUrl}" -a "${username}" -w "${password}" -l "${this.cliName} (${serverUrl})" -U`
    await execAsync(cmd)
  }

  async retrieve(serverUrl: string, username: string): Promise<string | null> {
    try {
      const {stdout} = await execAsync(`security find-internet-password -s "${serverUrl}" -a "${username}" -w`)
      return stdout.trim()
    } catch {
      return null
    }
  }

  async delete(serverUrl: string, username: string): Promise<void> {
    try {
      await execAsync(`security delete-internet-password -s "${serverUrl}" -a "${username}"`)
    } catch {
      // Ignore errors if credential doesn't exist
    }
  }
}

/**
 * Linux Secret Service / keyring operations
 */
class KeyringCredentialStore {
  private keychainService: string
  private cliId: string
  private cliName: string

  constructor(cliId: string, cliName: string) {
    this.cliId = cliId
    this.cliName = cliName
    this.keychainService = getKeychainService(cliId)
  }

  async store(serverUrl: string, username: string, password: string): Promise<void> {
    try {
      // Try using secret-tool if available
      const cmd = `echo "${password}" | secret-tool store --label="${this.cliName} (${serverUrl})" service ${this.keychainService} server "${serverUrl}" username "${username}"`
      await execAsync(cmd)
    } catch {
      throw new Error('Linux keyring not available. Please install libsecret-tools or use file-based storage.')
    }
  }

  async retrieve(serverUrl: string, username: string): Promise<string | null> {
    try {
      const {stdout} = await execAsync(
        `secret-tool lookup service ${this.keychainService} server "${serverUrl}" username "${username}"`,
      )
      return stdout.trim()
    } catch {
      return null
    }
  }

  async delete(serverUrl: string, username: string): Promise<void> {
    try {
      await execAsync(`secret-tool clear service ${this.keychainService} server "${serverUrl}" username "${username}"`)
    } catch {
      // Ignore errors
    }
  }
}

/**
 * Windows Credential Manager operations
 */
class WinCredentialStore {
  private keychainService: string

  constructor(cliId: string) {
    this.keychainService = getKeychainService(cliId)
  }

  async store(serverUrl: string, username: string, password: string): Promise<void> {
    // Windows cmdkey command
    const target = `${this.keychainService}:${serverUrl}:${username}`
    try {
      await execAsync(`cmdkey /delete:${target}`)
    } catch {
      // Ignore if doesn't exist
    }
    await execAsync(`cmdkey /generic:${target} /user:${username} /pass:${password}`)
  }

  async retrieve(serverUrl: string, username: string): Promise<string | null> {
    try {
      const target = `${this.keychainService}:${serverUrl}:${username}`
      await execAsync(`cmdkey /list:${target}`)
      // This doesn't actually retrieve the password, just lists it
      // Windows doesn't expose credential retrieval easily from command line
      // Would need to use Node.js native bindings or fall back to file
      throw new Error('Windows credential retrieval not implemented - falling back to file storage')
    } catch {
      return null
    }
  }

  async delete(serverUrl: string, username: string): Promise<void> {
    try {
      const target = `${this.keychainService}:${serverUrl}:${username}`
      await execAsync(`cmdkey /delete:${target}`)
    } catch {
      // Ignore errors
    }
  }
}

/**
 * File-based credential storage (fallback with encryption warning)
 */
class FileCredentialStore {
  private filePath: string

  constructor(cliId: string) {
    this.filePath = join(homedir(), `.${cliId}-cli-credentials.json`)
  }

  async store(serverUrl: string, username: string, password: string): Promise<void> {
    const credentials = await this.readAll()
    const key = `${serverUrl}:${username}`
    credentials[key] = {serverUrl, username, password}

    await writeFile(this.filePath, JSON.stringify(credentials, null, 2), 'utf-8')
    await chmod(this.filePath, 0o600)

    log.warn('⚠️  Warning: Credentials stored in plain text file. Consider using a secure credential store.')
  }

  async retrieve(serverUrl: string, username: string): Promise<string | null> {
    const credentials = await this.readAll()
    const key = `${serverUrl}:${username}`
    return credentials[key]?.password || null
  }

  async delete(serverUrl: string, username: string): Promise<void> {
    const credentials = await this.readAll()
    const key = `${serverUrl}:${username}`
    delete credentials[key]

    if (Object.keys(credentials).length === 0) {
      // If no credentials left, just write empty object
      await writeFile(this.filePath, '{}', 'utf-8')
    } else {
      await writeFile(this.filePath, JSON.stringify(credentials, null, 2), 'utf-8')
    }
  }

  private async readAll(): Promise<Record<string, ServerCredentials>> {
    try {
      const content = await readFile(this.filePath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return {}
    }
  }
}

async function readServerList(cliId: string, log: PrefixLog): Promise<ServerInfo[]> {
  const config = await readServerConfigLogged(cliId, log)
  return Object.keys(config.servers).map(key => {
    const {serverUrl, username} = parseServerKey(key)
    return {serverUrl, username, active: config.active === key}
  })
}

async function _writeServerConfig(cliId: string, config: ServerConfig): Promise<void> {
  const configFilePath = getConfigFilePath(cliId)
  const {writeFile} = await import('node:fs/promises')
  await writeFile(configFilePath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  await chmod(configFilePath, 0o600)
}

/**
 * Get the appropriate credential store for the current platform
 */
function getCredentialStore(ctx: CliContext) {
  const backend = getCredentialBackend(ctx.authType)

  switch (backend) {
    case 'keychain':
      return new KeychainCredentialStore(ctx.cliName)
    case 'keyring':
      return new KeyringCredentialStore(ctx.cliId, ctx.cliName)
    case 'wincred':
      return new WinCredentialStore(ctx.cliId)
    case 'file':
      return new FileCredentialStore(ctx.cliId)
  }
}

/**
 * Store credentials for a server
 */
export async function storeCredentials(
  ctx: CliContext,
  cmdLog: PrefixLog,
  serverUrl: string,
  username: string,
  password: string,
  setAsDefault: boolean = true,
): Promise<void> {
  const store = getCredentialStore(ctx)
  await store.store(serverUrl, username, password)
  cmdLog.info(`saving credentials for ${username}@${new URL(serverUrl).host}`)

  const configPath = getConfigFilePath(ctx.cliId)
  const fs = createLoggedFs(cmdLog)
  const key = serverKey(serverUrl, username)

  // Add server entry
  await fs.updateJsonProperty(configPath, ['servers', key], {})
  await chmod(configPath, 0o600)

  // Set as active if requested
  if (setAsDefault) {
    await fs.updateJsonProperty(configPath, ['active'], key)
    await chmod(configPath, 0o600)
  }
}

/**
 * Retrieve credentials for a server
 */
export async function retrieveCredentials(
  ctx: CliContext,
  cmdLog: PrefixLog,
  serverUrl: string,
  username: string,
): Promise<ServerCredentials | null> {
  const store = getCredentialStore(ctx)
  cmdLog.info(`accessing credentials for ${username}@${new URL(serverUrl).host}`)
  const password = await store.retrieve(serverUrl, username)

  if (!password) {
    return null
  }

  return {serverUrl, username, password}
}

/**
 * Delete credentials for a server
 */
export async function deleteCredentials(
  ctx: CliContext,
  cmdLog: PrefixLog,
  serverUrl: string,
  username: string,
): Promise<void> {
  const store = getCredentialStore(ctx)
  await store.delete(serverUrl, username)
  cmdLog.info(`deleting credentials for ${username}@${new URL(serverUrl).host}`)

  const configPath = getConfigFilePath(ctx.cliId)
  const fs = createLoggedFs(cmdLog)
  const key = serverKey(serverUrl, username)

  // Read current config to check if this was active
  const config = await readServerConfigLogged(ctx.cliId, cmdLog)

  // Nothing to remove if config file has no servers
  if (Object.keys(config.servers).length === 0) return

  // Remove server entry
  await fs.removeJsonProperty(configPath, ['servers', key])
  await chmod(configPath, 0o600)

  // If this was the active server, clear active
  if (config.active === key) {
    await fs.updateJsonProperty(configPath, ['active'], null)
    await chmod(configPath, 0o600)
  }
}

/**
 * List all stored server configurations
 */
export async function listServers(ctx: CliContext, cmdLog: PrefixLog): Promise<ServerInfo[]> {
  return await readServerList(ctx.cliId, cmdLog)
}

/**
 * Get the default server configuration
 */
export async function getDefaultServer(ctx: CliContext, cmdLog: PrefixLog): Promise<ServerCredentials | null> {
  const config = await readServerConfigLogged(ctx.cliId, cmdLog)

  if (!config.active) {
    return null
  }

  const {serverUrl, username} = parseServerKey(config.active)
  return await retrieveCredentials(ctx, cmdLog, serverUrl, username)
}

/**
 * Set a server as the default
 */
export async function setDefaultServer(
  ctx: CliContext,
  cmdLog: PrefixLog,
  serverUrl: string,
  username: string,
): Promise<void> {
  const configPath = getConfigFilePath(ctx.cliId)
  const fs = createLoggedFs(cmdLog)
  const key = serverKey(serverUrl, username)
  await fs.updateJsonProperty(configPath, ['active'], key)
  await chmod(configPath, 0o600)
}

/**
 * Get credentials backend name for display
 */
export function getCredentialBackendName(): string {
  const backend = getCredentialBackend()
  const names = {
    keychain: 'macOS Keychain',
    keyring: 'Linux Secret Service',
    wincred: 'Windows Credential Manager',
    file: 'File (plaintext - not recommended)',
  }
  return names[backend]
}
