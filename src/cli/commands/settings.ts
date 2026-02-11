import {resolve} from 'node:path'
import {readSettings, normalizePath} from '../utils/pageContext.ts'
import type {PathContext} from '../utils/pageContext.ts'
import {validatePathSettings} from '../pathOperations/validatePathSettings.ts'
import {logData} from '../utils/logData.ts'
import type {CliCommand} from '../utils/types.ts'
import {createPrefixLog} from '../utils/prefixLog.ts'
import {createLoggedFs} from '../utils/createLoggedFs.ts'

interface SettingsOptions {
  fix?: boolean
}

/**
 * Display local settings.json and validation issues.
 */
export const settings: CliCommand<[SettingsOptions?]> = async (ctx, options) => {
  const json = ctx.json
  const fix = options?.fix ?? false
  const cmdLog = createPrefixLog(ctx.cliName, 'settings')
  const fs = createLoggedFs(cmdLog, ctx.cwd)
  const data = await readSettings('.', fs)

  if (!data) {
    const message = 'No settings.json found in the current directory'
    if (json) {
      logData({error: 'not_found', message}, true)
      process.exitCode = 1
      return
    }
    throw new Error(message)
  }

  const rootCtx: PathContext = {
    reference: 'main',
    path: data.path,
    normalizedPath: normalizePath(data.path),
    serverUrl: '',
    auth: '',
    settings: data,
    dir: '.',
    absoluteDir: resolve(ctx.cwd),
    log: cmdLog,
    prompt: ctx.prompt,
    forbiddenPaths: [],
  }

  const violations = await validatePathSettings(rootCtx)

  if (violations.length === 0) {
    logData({valid: true}, json)
    return
  }

  if (fix) {
    let fixedCount = 0
    const unfixed: typeof violations = []
    for (const v of violations) {
      if (v.apply) {
        await v.apply()
        fixedCount++
      } else {
        unfixed.push(v)
      }
    }
    logData({fixed: `${fixedCount}/${violations.length}`, valid: unfixed.length === 0, violations: unfixed}, json)
    if (unfixed.length > 0) {
      process.exitCode = 1
    }
    return
  }

  if (json) {
    logData({valid: false, violations}, true)
  } else {
    logData({violations})
  }
  process.exitCode = 1
}
