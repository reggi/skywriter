import {select, confirm} from '@inquirer/prompts'
import {listServers, deleteCredentials} from '../utils/credentials.ts'
import type {CliCommand, ServerInfo} from '../utils/types.ts'
import {createPrefixLog} from '../utils/prefixLog.ts'

/**
 * Remove a remote server connection
 * Supports: skywriter remote remove [url]
 *   - skywriter remote remove                          (interactive select)
 *   - skywriter remote remove http://user@host.com     (direct removal with confirmation)
 */
export const removeServer: CliCommand<[string?]> = async (ctx, url?) => {
  const log = createPrefixLog(ctx.cliName, 'remote remove')
  const servers = await listServers(ctx, log)

  if (servers.length === 0) {
    throw new Error(`No servers configured. Run "${ctx.cliName} login" to add one.`)
  }

  const removeFn = async (server: ServerInfo) => {
    const confirmed = await confirm({
      message: `Remove ${server.serverUrl} (${server.username})?`,
      default: false,
    })

    if (confirmed) {
      await deleteCredentials(ctx, log, server.serverUrl, server.username)
      log.info(`removed server: ${server.serverUrl} (${server.username})`)
    }
  }

  if (url) {
    const parsed = new URL(url)
    if (!parsed.username) {
      throw new Error('URL must include a username (e.g. http://user@host.com)')
    }
    const username = parsed.username
    const serverUrl = parsed.origin
    const server = servers.find(s => s.serverUrl === serverUrl && s.username === username)
    if (!server) {
      throw new Error(`No server found for ${username}@${parsed.host}`)
    }
    await removeFn(server)
    return
  }

  if (servers.length === 1) {
    const server = servers[0]
    await removeFn(server)
    return
  }

  const choices = servers.map(server => ({
    name: `${server.serverUrl} (${server.username})${server.active ? ' (current default)' : ''}`,
    value: server,
  }))

  const selected = await select({
    message: 'Select server to remove:',
    choices,
  })

  await removeFn(selected)
}
