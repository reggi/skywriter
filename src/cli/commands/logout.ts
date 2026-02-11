import {select, confirm} from '@inquirer/prompts'
import {listServers, deleteCredentials} from '../utils/credentials.ts'
import type {CliCommand} from '../utils/types.ts'
import {createPrefixLog} from '../utils/prefixLog.ts'

interface LogoutOptions {
  url?: string
  yes?: boolean
}

/**
 * Remove a server and its credentials
 * Supports: skywriter logout [url] [--yes]
 *   - skywriter logout                          (interactive select)
 *   - skywriter logout http://user@host.com     (direct removal with confirmation)
 *   - skywriter logout http://user@host.com -y  (skip confirmation)
 */
export const logout: CliCommand<[LogoutOptions?]> = async (ctx, options = {}) => {
  const {url, yes} = options
  const cmdLog = createPrefixLog(ctx.cliName, 'logout')

  // Validate URL and warn early, before any other I/O
  let parsedUrl: URL | undefined
  if (url) {
    parsedUrl = new URL(url)
    if (!parsedUrl.username) {
      throw new Error('URL must include a username (e.g. http://user@host.com)')
    }
    if (parsedUrl.password) {
      cmdLog.warn('Password in URL is saved in shell history. Do not include the url when logging out.')
    }
  }

  const servers = await listServers(ctx, cmdLog)

  if (servers.length === 0) {
    cmdLog.info('No servers configured.')
    return
  }

  const removeFn = async (server: (typeof servers)[number]) => {
    if (!yes) {
      const confirmed = await confirm({
        message: `Remove credentials for ${server.serverUrl} (${server.username})?`,
        default: false,
      })
      if (!confirmed) return
    }

    await deleteCredentials(ctx, cmdLog, server.serverUrl, server.username)
    cmdLog.info(`✓ Logged out from: ${server.serverUrl} (${server.username})`)
  }

  if (parsedUrl) {
    const username = parsedUrl.username
    const serverUrl = parsedUrl.origin
    const server = servers.find(s => s.serverUrl === serverUrl && s.username === username)
    if (!server) {
      throw new Error(`No server found for ${username}@${parsedUrl.host}`)
    }
    await removeFn(server)
    return
  }

  const choices = servers.map(server => ({
    name: `${server.serverUrl} (${server.username})${server.active ? ' (default)' : ''}`,
    value: server,
  }))

  const selected = await select({
    message: 'Select server to logout:',
    choices,
  })

  await removeFn(selected)
}
