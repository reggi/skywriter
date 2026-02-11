import {listServers} from '../utils/credentials.ts'
import type {CliCommand} from '../utils/types.ts'
import {createPrefixLog} from '../utils/prefixLog.ts'
import {logData} from '../utils/logData.ts'

/**
 * List all configured sessions
 */
export const sessions: CliCommand = async ctx => {
  const json = ctx.json
  const cmdLog = createPrefixLog(ctx.cliName, 'remote list')
  const servers = await listServers(ctx, cmdLog)

  if (servers.length === 0) {
    const message = `No remotes configured. Run "${ctx.cliName} login" to add one.`
    if (json) {
      logData({error: 'no_servers', message}, true)
      process.exitCode = 1
      return
    }
    throw new Error(message)
  }

  const sorted = servers.sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1))
  const data = sorted.map(s => ({serverUrl: s.serverUrl, username: s.username, active: s.active}))
  logData(data, json)
}
