import {select} from '@inquirer/prompts'
import {readServerConfig} from '../utils/config.ts'
import type {CliCommand} from '../utils/types.ts'
import {createPrefixLog} from '../utils/prefixLog.ts'

/**
 * Switch the default server
 * Supports: skywriter remote switch [url]
 *   - skywriter remote switch                          (interactive select)
 *   - skywriter remote switch http://user@host.com     (direct switch)
 */
export const switchServer: CliCommand<[string?]> = async (ctx, url?) => {
  const cmdLog = createPrefixLog(ctx.cliName, 'remote switch')
  const serverConfig = await readServerConfig(ctx, cmdLog)
  const servers = serverConfig.listServers()

  if (servers.length === 0) {
    throw new Error(`No servers configured. Run "${ctx.cliName} login" to add one.`)
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
    if (server.active) {
      cmdLog.info(`${username}@${parsed.host} is already the active server.`)
      return
    }
    await serverConfig.setDefaultServer(server.serverUrl, server.username)
    return
  }

  if (servers.length === 1) {
    cmdLog.info('Only one server is configured.')
    return
  }

  const choices = servers.map(server => ({
    name: `${server.serverUrl} (${server.username})${server.active ? ' (current default)' : ''}`,
    value: server,
  }))

  const selected = await select({
    message: 'Select default server:',
    choices,
  })

  if (selected.active) {
    cmdLog.info(`${selected.username}@${new URL(selected.serverUrl).host} is already the active server.`)
    return
  }

  await serverConfig.setDefaultServer(selected.serverUrl, selected.username)
}
