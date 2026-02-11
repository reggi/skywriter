import {basename} from 'node:path'
import {readConfig, resolveSource} from './config.ts'
import {readSettings} from './pageContext.ts'
import type {CliContext} from './types.ts'
import type {PrefixLog} from './prefixLog.ts'

interface ResolvedTarget {
  serverUrl: string
  documentPath: string
  username: string
  password: string
  auth: string
  /** Local directory for the main document */
  dest: string
}

/**
 * Resolve the target server, document path, credentials, and local dest directory.
 *
 * If source is provided → resolveSource for serverUrl, credentials.
 * Otherwise → read settings.json for documentPath, readConfig for credentials.
 * dest: explicit destination → basename of path → server hostname → '.'
 *
 * Shared across all push/pull utilities.
 */
export async function resolveTarget(
  ctx: CliContext,
  log: PrefixLog,
  source?: string,
  destination?: string,
): Promise<ResolvedTarget> {
  let serverUrl: string
  let documentPath: string
  let username: string
  let password: string
  let auth: string

  if (source) {
    const resolved = await resolveSource(ctx, log, source)
    serverUrl = resolved.serverUrl
    documentPath = resolved.documentPath
    username = resolved.username
    password = resolved.password
    auth = resolved.auth
  } else {
    const existingSettings = await readSettings()
    if (!existingSettings?.path) {
      throw new Error('No source argument and no settings.json found in current directory')
    }
    documentPath = existingSettings.path
    const config = await readConfig(ctx, log)
    serverUrl = config.serverUrl
    username = config.username
    password = config.password
    auth = Buffer.from(`${username}:${password}`).toString('base64')
  }

  const pathBase = basename(documentPath)
  const dest = destination ?? (source ? pathBase || new URL(serverUrl).hostname : '.')

  return {serverUrl, documentPath, username, password, auth, dest}
}
