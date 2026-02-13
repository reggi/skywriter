import {readServerConfig} from '../utils/config.ts'
import type {CliCommand} from '../utils/types.ts'
import {createPrefixLog} from '../utils/prefixLog.ts'
import {createLoggedFetch} from '../utils/loggedFetch.ts'
import {logData} from '../utils/logData.ts'

/**
 * Show current default server and user, and verify credentials against the server
 */
export const whoami: CliCommand = async ctx => {
  const json = ctx.json
  const cmdLog = createPrefixLog(ctx.cliName, 'whoami')
  const fetch = createLoggedFetch(cmdLog)
  const config = await readServerConfig(ctx, cmdLog)
  const servers = config.listServers()

  if (servers.length === 0) {
    const message = `Not logged in. Run "${ctx.cliName} login" to authenticate.`
    if (json) {
      logData({error: 'not_logged_in', message}, true)
      process.exitCode = 1
      return
    }
    throw new Error(message)
  }

  const active = servers.find(s => s.active)
  if (!active) {
    const message = `No default server set. Run "${ctx.cliName} remote switch" to select one.`
    if (json) {
      logData({error: 'no_default_server', message}, true)
      process.exitCode = 1
      return
    }
    throw new Error(message)
  }

  const defaultServer = await config.retrieveCredentials(active.serverUrl, active.username)
  if (!defaultServer) {
    const message = `Credentials expired for ${active.username}@${new URL(active.serverUrl).host}. Run "${ctx.cliName} login" to re-authenticate.`
    if (json) {
      logData({error: 'credentials_expired', message}, true)
      process.exitCode = 1
      return
    }
    throw new Error(message)
  }

  const url = `${defaultServer.serverUrl}/edit?whoami`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${defaultServer.username}:${defaultServer.password}`).toString('base64')}`,
    },
  })

  if (!response.ok) {
    const message = `Failed to verify credentials: ${response.status} ${response.statusText}`
    if (json) {
      logData({error: 'verification_failed', message}, true)
      process.exitCode = 1
      return
    }
    throw new Error(message)
  }

  const host = new URL(defaultServer.serverUrl).host
  const username = defaultServer.username

  if (json) {
    logData({username, host, serverUrl: defaultServer.serverUrl}, true)
  } else {
    process.stdout.write(`${username}@${host}\n`)
  }
}
