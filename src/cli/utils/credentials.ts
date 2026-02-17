#!/usr/bin/env node
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {platform} from 'node:os'
import {chmod} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'
import type {CliContext} from './types.ts'
import type {PrefixLog} from './prefixLog.ts'
import {createLoggedFs} from './createLoggedFs.ts'

const execFileAsync = promisify(execFile)

function getKeychainService(cliId: string): string {
  return `com.${cliId}.cli`
}

export function getConfigFilePath(cliId: string): string {
  return join(homedir(), `.${cliId}.json`)
}

/**
 * Build a server key like "https://reggi@domain.com" from serverUrl and username
 */
export function serverKey(serverUrl: string, username: string): string {
  const url = new URL(serverUrl)
  url.username = username
  return url.href.replace(/\/$/, '')
}

/**
 * Parse a server key like "https://reggi@domain.com" into serverUrl and username
 */
export function parseServerKey(key: string): {serverUrl: string; username: string} {
  const url = new URL(key)
  const username = url.username
  url.username = ''
  return {serverUrl: url.origin, username}
}

/**
 * Internal config format: {active, servers} object
 */
export interface ServerConfig {
  active: string | null
  servers: Record<string, Record<string, unknown>>
}

/**
 * Validate the shape of the config file JSON.
 * Returns a valid ServerConfig or throws with a descriptive message.
 */
export function validateConfigJson(data: unknown): ServerConfig {
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
 * Detect which credential storage backend to use based on OS
 */
export function getOsCredentialBackend(): 'keychain' | 'keyring' | 'wincred' | 'file' {
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

  constructor(cliName: string, _config: ServerConfig) {
    this.cliName = cliName
  }

  async store(serverUrl: string, username: string, password: string): Promise<void> {
    // Delete existing credential if it exists (to update it)
    try {
      await execFileAsync('security', ['delete-internet-password', '-s', serverUrl, '-a', username])
    } catch {
      // Ignore errors if credential doesn't exist
    }

    // Add new credential
    await execFileAsync('security', [
      'add-internet-password',
      '-s',
      serverUrl,
      '-a',
      username,
      '-w',
      password,
      '-l',
      `${this.cliName} (${serverUrl})`,
      '-U',
    ])
  }

  async retrieve(serverUrl: string, username: string): Promise<string | null> {
    try {
      const {stdout} = await execFileAsync('security', [
        'find-internet-password',
        '-s',
        serverUrl,
        '-a',
        username,
        '-w',
      ])
      return stdout.trim()
    } catch {
      return null
    }
  }

  async delete(serverUrl: string, username: string): Promise<void> {
    try {
      await execFileAsync('security', ['delete-internet-password', '-s', serverUrl, '-a', username])
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

  constructor(cliId: string, cliName: string, _config: ServerConfig) {
    this.cliId = cliId
    this.cliName = cliName
    this.keychainService = getKeychainService(cliId)
  }

  async store(serverUrl: string, username: string, password: string): Promise<void> {
    try {
      // Use secret-tool with --label flag and attribute key-value pairs
      const child = execFile('secret-tool', [
        'store',
        '--label',
        `${this.cliName} (${serverUrl})`,
        'service',
        this.keychainService,
        'server',
        serverUrl,
        'username',
        username,
      ])
      // secret-tool reads the secret from stdin
      child.stdin?.write(password)
      child.stdin?.end()
      await new Promise<void>((resolve, reject) => {
        child.on('close', code => {
          if (code === 0) resolve()
          else reject(new Error(`secret-tool exited with code ${code}`))
        })
        child.on('error', reject)
      })
    } catch {
      throw new Error('Linux keyring not available. Please install libsecret-tools or use file-based storage.')
    }
  }

  async retrieve(serverUrl: string, username: string): Promise<string | null> {
    try {
      const {stdout} = await execFileAsync('secret-tool', [
        'lookup',
        'service',
        this.keychainService,
        'server',
        serverUrl,
        'username',
        username,
      ])
      return stdout.trim()
    } catch {
      return null
    }
  }

  async delete(serverUrl: string, username: string): Promise<void> {
    try {
      await execFileAsync('secret-tool', [
        'clear',
        'service',
        this.keychainService,
        'server',
        serverUrl,
        'username',
        username,
      ])
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

  constructor(cliId: string, _config: ServerConfig) {
    this.keychainService = getKeychainService(cliId)
  }

  async store(serverUrl: string, username: string, password: string): Promise<void> {
    // Windows cmdkey command
    const target = `${this.keychainService}:${serverUrl}:${username}`
    try {
      await execFileAsync('cmdkey', ['/delete', target])
    } catch {
      // Ignore if doesn't exist
    }
    await execFileAsync('cmdkey', ['/generic', target, '/user', username, '/pass', password])
  }

  async retrieve(serverUrl: string, username: string): Promise<string | null> {
    try {
      const target = `${this.keychainService}:${serverUrl}:${username}`
      await execFileAsync('cmdkey', ['/list', target])
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
      await execFileAsync('cmdkey', ['/delete', target])
    } catch {
      // Ignore errors
    }
  }
}

/**
 * File-based credential storage (fallback with encryption warning)
 * Stores passwords in the config file under servers.<key>.password
 */
class FileCredentialStore {
  private cliId: string
  private config: ServerConfig
  private fs: ReturnType<typeof createLoggedFs>
  private cmdLog: PrefixLog

  constructor(cliId: string, cmdLog: PrefixLog, config: ServerConfig) {
    this.cliId = cliId
    this.config = config
    this.fs = createLoggedFs(cmdLog)
    this.cmdLog = cmdLog
  }

  async store(serverUrl: string, username: string, password: string): Promise<void> {
    const configPath = getConfigFilePath(this.cliId)
    const key = serverKey(serverUrl, username)
    await this.fs.updateJsonPropertyRedacted(configPath, ['servers', key, 'password'], password)
    await chmod(configPath, 0o600)

    this.cmdLog.warn('Credentials stored in plain text file. Consider using a secure credential store.')
  }

  async retrieve(serverUrl: string, username: string): Promise<string | null> {
    const key = serverKey(serverUrl, username)
    const password = this.config.servers[key]?.password
    return typeof password === 'string' ? password : null
  }

  async delete(serverUrl: string, username: string): Promise<void> {
    const configPath = getConfigFilePath(this.cliId)
    const key = serverKey(serverUrl, username)
    try {
      await this.fs.removeJsonProperty(configPath, ['servers', key, 'password'])
    } catch {
      // Ignore errors if config file doesn't exist
    }
  }
}

/**
 * Create a credential store for the given backend
 */
export function createCredentialStore(
  backend: 'keychain' | 'keyring' | 'wincred' | 'file',
  ctx: CliContext,
  cmdLog: PrefixLog,
  config: ServerConfig,
) {
  switch (backend) {
    case 'keychain':
      return new KeychainCredentialStore(ctx.cliName, config)
    case 'keyring':
      return new KeyringCredentialStore(ctx.cliId, ctx.cliName, config)
    case 'wincred':
      return new WinCredentialStore(ctx.cliId, config)
    case 'file':
      return new FileCredentialStore(ctx.cliId, cmdLog, config)
  }
}

/**
 * Get credentials backend name for display
 */
export function getCredentialBackendName(): string {
  const backend = getOsCredentialBackend()
  const names = {
    keychain: 'macOS Keychain',
    keyring: 'Linux Secret Service',
    wincred: 'Windows Credential Manager',
    file: 'File (plaintext - not recommended)',
  }
  return names[backend]
}
