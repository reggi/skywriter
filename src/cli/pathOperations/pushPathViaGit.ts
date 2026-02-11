import {exec} from 'node:child_process'
import {promisify} from 'node:util'
import {access} from 'node:fs/promises'
import {hasRemote} from '../utils/git.ts'
import {buildAuthUrl, sanitizeError} from '../utils/gitUrl.ts'
import type {PathOperation} from '../utils/pageContext.ts'
import {approveExec, loggedExec} from '../utils/promptExec.ts'
import {pushPathViaTar} from './pushPathViaTar.ts'

const execAsync = promisify(exec)

/**
 * Push a single path's git repo.
 * Falls back to tar if directory has no .git or no remote.
 * Uses --set-upstream for the first push, regular push otherwise.
 * Temporarily sets auth credentials on the remote URL for the push.
 */
export const pushPathViaGit: PathOperation = async ctx => {
  // Fall back to tar if no .git or no remote
  try {
    await access(`${ctx.dir}/.git`)
  } catch {
    return pushPathViaTar(ctx)
  }
  if (!(await hasRemote(ctx.dir))) {
    return pushPathViaTar(ctx)
  }

  const log = ctx.log.prefix('push')

  const gitUrl = `${ctx.serverUrl}${ctx.path}.git`
  const {authUrl, cleanUrl} = buildAuthUrl(gitUrl, ctx.auth)

  const displayDir = ctx.dir === '.' ? '' : ` -C "${ctx.dir}"`
  await approveExec(`git${displayDir} push`, {autoApprove: !ctx.prompt, log: ctx.log})

  try {
    await execAsync(`git remote set-url origin "${authUrl}"`, {cwd: ctx.dir})

    try {
      await execAsync('git rev-parse --abbrev-ref --symbolic-full-name @{u}', {cwd: ctx.dir})
      await loggedExec('git push', {cwd: ctx.dir, log})
    } catch {
      const {stdout: branchName} = await execAsync('git rev-parse --abbrev-ref HEAD', {cwd: ctx.dir})
      await loggedExec(`git push -u origin ${branchName.trim()}`, {cwd: ctx.dir, log})
    }
  } catch (error) {
    throw sanitizeError(error, authUrl, cleanUrl)
  } finally {
    await execAsync(`git remote set-url origin "${cleanUrl}"`, {cwd: ctx.dir}).catch(() => {})
  }
}
