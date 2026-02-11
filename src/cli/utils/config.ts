#!/usr/bin/env node
import {getDefaultServer, retrieveCredentials, listServers} from './credentials.ts'
import {parseDocumentPath} from './parseDocumentPath.ts'
import type {CliContext} from './types.ts'
import type {PrefixLog} from './prefixLog.ts'

interface CliConfig {
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
    // Return only protocol and host (strips path, query, hash, trailing slashes)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    throw new Error(`Invalid server URL: ${url}`)
  }
}

/**
 * Parse a pull/clone source argument into serverUrl + document path.
 *
 * Accepts:
 *   /meow                          → uses defaultServerUrl + /meow
 *   http://localhost:3000/meow     → server http://localhost:3000, path /meow
 *   http://localhost:3000/meow.git → same, strips .git
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

/**
 * Parsed and resolved source: server URL, document path, and credentials.
 * Attached to CliContext by push/pull commands so downstream handlers
 * don't need to re-parse the positional argument.
 */
interface ResolvedSource {
  serverUrl: string
  documentPath: string
  username: string
  password: string
  auth: string
}

/**
 * Parse a source argument and resolve credentials for the target server.
 * Handles all source formats: full URL, /path, bare name.
 */
export async function resolveSource(ctx: CliContext, log: PrefixLog, source: string): Promise<ResolvedSource> {
  const defaultConfig = await readConfig(ctx, log).catch(() => null)
  const {serverUrl, path: documentPath} = parseSource(source, defaultConfig?.serverUrl)

  let config: CliConfig
  if (defaultConfig && serverUrl === defaultConfig.serverUrl) {
    config = defaultConfig
  } else {
    config = await getCredentialsForServer(ctx, log, serverUrl)
  }

  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64')
  return {serverUrl, documentPath, username: config.username, password: config.password, auth}
}

/**
 * Look up credentials for a specific server URL from the stored server list.
 */
async function getCredentialsForServer(ctx: CliContext, log: PrefixLog, serverUrl: string): Promise<CliConfig> {
  const servers = await listServers(ctx, log)
  const match = servers.find(s => s.serverUrl === serverUrl)

  if (!match) {
    throw new Error(`No credentials for ${serverUrl}. Run: ${ctx.cliName} login`)
  }

  const credentials = await retrieveCredentials(ctx, log, match.serverUrl, match.username)
  if (!credentials) {
    throw new Error(`Credentials expired or missing for ${serverUrl} (${match.username}). Run: ${ctx.cliName} login`)
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
): Promise<CliConfig> {
  let credentials

  if (serverUrl && username) {
    // Get specific server credentials
    credentials = await retrieveCredentials(ctx, log, serverUrl, username)
    if (!credentials) {
      throw new Error(`No credentials found for ${serverUrl} (${username})`)
    }
  } else {
    // Get default server credentials
    credentials = await getDefaultServer(ctx, log)
    if (!credentials) {
      const servers = await listServers(ctx, log)
      if (servers.length === 0) {
        throw new Error(`Not logged in. Please run: ${ctx.cliName} login`)
      } else {
        throw new Error(`No default server set. Please run: ${ctx.cliName} login --set-default`)
      }
    }
  }

  return credentials
}
