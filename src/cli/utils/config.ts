#!/usr/bin/env node
import {chmod} from 'node:fs/promises'
import {parseDocumentPath} from './parseDocumentPath.ts'
import type {CliContext, ServerInfo} from './types.ts'
import type {PrefixLog} from './prefixLog.ts'
import {createLoggedFs} from './createLoggedFs.ts'
import {
  type ServerConfig,
  validateConfigJson,
  getConfigFilePath,
  serverKey,
  parseServerKey,
  getOsCredentialBackend,
  createCredentialStore,
  getCredentialBackendName,
} from './credentials.ts'

interface ServerCredentials {
  serverUrl: string
  username: string
  password: string
}

/**
 * Sanitize server URL by removing trailing slashes, paths, queries, etc.
 */
export function sanitizeServerUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    throw new Error(`Invalid server URL`)
  }
}

/**
 * Server config class — reads config once, all methods operate on the cached data.
 */
export class CliServerConfig {
  private config: ServerConfig
  private ctx: CliContext
  private cmdLog: PrefixLog
  private fs: ReturnType<typeof createLoggedFs>

  constructor(ctx: CliContext, cmdLog: PrefixLog, config: ServerConfig) {
    this.config = config
    this.ctx = ctx
    this.cmdLog = cmdLog
    this.fs = createLoggedFs(cmdLog)
  }

  listServers(): ServerInfo[] {
    return Object.keys(this.config.servers).map(key => {
      const {serverUrl, username} = parseServerKey(key)
      return {serverUrl, username, active: this.config.active === key}
    })
  }

  async storeCredentials(
    serverUrl: string,
    username: string,
    password: string,
    options: {setAsDefault?: boolean; authStore?: 'file'} = {},
  ): Promise<void> {
    const {setAsDefault = true, authStore} = options
    const configPath = getConfigFilePath(this.ctx.cliId)
    const key = serverKey(serverUrl, username)

    // Add server entry first (so file-based store can nest password inside it)
    await this.fs.updateJsonProperty(configPath, ['servers', key], {})
    await chmod(configPath, 0o600)

    // Determine backend: explicit file override, or auto-detect based on OS
    const backend = authStore === 'file' ? 'file' : getOsCredentialBackend()
    const store = createCredentialStore(backend, this.ctx, this.cmdLog, this.config)
    await store.store(serverUrl, username, password)
    this.cmdLog.info(`saving credentials for ${username}@${new URL(serverUrl).host}`)

    // Set as active if requested
    if (setAsDefault) {
      await this.fs.updateJsonProperty(configPath, ['active'], key)
      await chmod(configPath, 0o600)
    }
  }

  async retrieveCredentials(serverUrl: string, username: string): Promise<ServerCredentials | null> {
    const key = serverKey(serverUrl, username)
    const hasPassword = !!this.config.servers[key]?.password
    const backend = hasPassword ? 'file' : getOsCredentialBackend()
    const store = createCredentialStore(backend, this.ctx, this.cmdLog, this.config)
    this.cmdLog.info(`accessing credentials for ${username}@${new URL(serverUrl).host}`)
    const password = await store.retrieve(serverUrl, username)

    if (!password) {
      return null
    }

    return {serverUrl, username, password}
  }

  async deleteCredentials(serverUrl: string, username: string): Promise<void> {
    const key = serverKey(serverUrl, username)
    const hasPassword = !!this.config.servers[key]?.password
    const backend = hasPassword ? 'file' : getOsCredentialBackend()
    const store = createCredentialStore(backend, this.ctx, this.cmdLog, this.config)
    await store.delete(serverUrl, username)
    this.cmdLog.info(`deleting credentials for ${username}@${new URL(serverUrl).host}`)

    const configPath = getConfigFilePath(this.ctx.cliId)

    // Nothing to remove if config file has no servers
    if (Object.keys(this.config.servers).length === 0) return

    // Remove server entry
    await this.fs.removeJsonProperty(configPath, ['servers', key])
    await chmod(configPath, 0o600)

    // If this was the active server, clear active
    if (this.config.active === key) {
      await this.fs.updateJsonProperty(configPath, ['active'], null)
      await chmod(configPath, 0o600)
    }
  }

  async setDefaultServer(serverUrl: string, username: string): Promise<void> {
    const configPath = getConfigFilePath(this.ctx.cliId)
    const key = serverKey(serverUrl, username)
    await this.fs.updateJsonProperty(configPath, ['active'], key)
    await chmod(configPath, 0o600)
  }

  async getDefaultServer(): Promise<ServerCredentials | null> {
    if (!this.config.active) {
      return null
    }

    const {serverUrl, username} = parseServerKey(this.config.active)
    return await this.retrieveCredentials(serverUrl, username)
  }

  getCredentialBackendName(): string {
    return getCredentialBackendName()
  }
}

/**
 * Read server config and return a CliServerConfig instance.
 * All methods on the returned object operate on the single read.
 */
export async function readServerConfig(ctx: CliContext, cmdLog: PrefixLog): Promise<CliServerConfig> {
  const configFilePath = getConfigFilePath(ctx.cliId)
  const fs = createLoggedFs(cmdLog)
  let config: ServerConfig
  try {
    const content = await fs.readFile(configFilePath)
    config = validateConfigJson(JSON.parse(content))
  } catch {
    config = {active: null, servers: {}}
  }
  return new CliServerConfig(ctx, cmdLog, config)
}

// --- Source resolution helpers (unchanged) ---

/**
 * Parse a pull/clone source argument into serverUrl + document path.
 */
function parseSource(source: string, defaultServerUrl?: string): {serverUrl: string; path: string} {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const serverUrl = sanitizeServerUrl(source)
    const path = parseDocumentPath(source)
    return {serverUrl, path}
  }

  if (!defaultServerUrl) {
    throw new Error('No default server configured. Please run: login')
  }

  return {serverUrl: defaultServerUrl, path: parseDocumentPath(source)}
}

interface ResolvedSource {
  serverUrl: string
  documentPath: string
  username: string
  password: string
  auth: string
}

/**
 * Parse a source argument and resolve credentials for the target server.
 */
export async function resolveSource(ctx: CliContext, log: PrefixLog, source: string): Promise<ResolvedSource> {
  const defaultConfig = await readConfig(ctx, log).catch(() => null)
  const {serverUrl, path: documentPath} = parseSource(source, defaultConfig?.serverUrl)

  let config: ServerCredentials
  if (defaultConfig && serverUrl === defaultConfig.serverUrl) {
    config = defaultConfig
  } else {
    config = await getCredentialsForServer(ctx, log, serverUrl)
  }

  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64')
  return {serverUrl, documentPath, username: config.username, password: config.password, auth}
}

async function getCredentialsForServer(ctx: CliContext, log: PrefixLog, serverUrl: string): Promise<ServerCredentials> {
  const serverConfig = await readServerConfig(ctx, log)
  const servers = serverConfig.listServers()
  const match = servers.find(s => s.serverUrl === serverUrl)

  if (!match) {
    throw new Error(`No credentials for ${new URL(serverUrl).host}. Run: ${ctx.cliName} login`)
  }

  const credentials = await serverConfig.retrieveCredentials(match.serverUrl, match.username)
  if (!credentials) {
    throw new Error(
      `Credentials expired or missing for ${match.username}@${new URL(serverUrl).host}. Run: ${ctx.cliName} login`,
    )
  }

  return credentials
}

/**
 * Read the CLI configuration file (uses default server or specified server)
 */
export async function readConfig(
  ctx: CliContext,
  log: PrefixLog,
  serverUrl?: string,
  username?: string,
): Promise<ServerCredentials> {
  const serverConfig = await readServerConfig(ctx, log)
  let credentials

  if (serverUrl && username) {
    credentials = await serverConfig.retrieveCredentials(serverUrl, username)
    if (!credentials) {
      throw new Error(`No credentials found for ${username}@${new URL(serverUrl).host}`)
    }
  } else {
    credentials = await serverConfig.getDefaultServer()
    if (!credentials) {
      const servers = serverConfig.listServers()
      if (servers.length === 0) {
        throw new Error(`Not logged in. Please run: ${ctx.cliName} login`)
      } else {
        throw new Error(`No default server set. Please run: ${ctx.cliName} login --set-default`)
      }
    }
  }

  return credentials
}
