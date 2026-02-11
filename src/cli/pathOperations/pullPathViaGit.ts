import {exec} from 'node:child_process'
import {promisify} from 'node:util'
import {access} from 'node:fs/promises'
import {formatWarning} from '../utils/formatPlan.ts'
import {buildAuthUrl, sanitizeUrl, sanitizeError} from '../utils/gitUrl.ts'
import type {PathOperation} from '../utils/pageContext.ts'
import {approveExec, loggedExec} from '../utils/promptExec.ts'

const execAsync = promisify(exec)

async function isGitDir(dir: string): Promise<boolean> {
  try {
    await access(`${dir}/.git`)
    return true
  } catch {
    return false
  }
}

async function hasUncommittedChanges(repoDir: string): Promise<boolean> {
  try {
    const {stdout} = await execAsync('git status --porcelain', {cwd: repoDir})
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

async function getRemoteUrl(dir: string): Promise<string | null> {
  try {
    const {stdout} = await execAsync('git remote get-url origin', {cwd: dir})
    return stdout.trim()
  } catch {
    return null
  }
}

/**
 * Clone or pull a single path via git.
 * - If dir has .git and remote matches → pull (update)
 * - If dir has .git but remote doesn't match → warn and skip
 * - Otherwise → git clone
 */
export const pullPathViaGit: PathOperation = async ctx => {
  const gitUrl = `${ctx.serverUrl}${ctx.path}.git`
  const {authUrl, cleanUrl} = buildAuthUrl(gitUrl, ctx.auth)
  const dir = ctx.absoluteDir

  if (await isGitDir(dir)) {
    // Verify remote matches expected source
    const remoteUrl = await getRemoteUrl(dir)
    if (!remoteUrl) {
      throw new Error(`Git repo at "${ctx.dir}" has no remote origin URL`)
    }
    if (sanitizeUrl(remoteUrl) !== cleanUrl) {
      throw new Error(`Remote URL mismatch at "${ctx.dir}": expected ${cleanUrl}, got ${sanitizeUrl(remoteUrl)}`)
    }

    // Update existing repo
    if (await hasUncommittedChanges(dir)) {
      ctx.log.prefix('pull').warn(formatWarning('Has uncommitted changes, skipping'))
      return
    }
    const log = ctx.log.prefix('pull')
    const displayDir = ctx.dir === '.' ? '' : ` -C "${ctx.dir}"`
    await approveExec(`git${displayDir} pull`, {autoApprove: !ctx.prompt, log: ctx.log})
    try {
      await execAsync(`git remote set-url origin "${authUrl}"`, {cwd: dir})
      await loggedExec('git pull', {cwd: dir, log})
    } catch (error) {
      throw sanitizeError(error, authUrl, cleanUrl)
    } finally {
      await execAsync(`git remote set-url origin "${cleanUrl}"`, {cwd: dir}).catch(() => {})
    }
  } else {
    // Fresh clone
    const log = ctx.log.prefix('clone')
    await approveExec(`git clone ${cleanUrl} "${ctx.dir}"`, {autoApprove: !ctx.prompt, log: ctx.log})
    try {
      await loggedExec(`git clone "${authUrl}" "${dir}"`, {log})
      await execAsync(`git remote set-url origin "${cleanUrl}"`, {cwd: dir})
    } catch (error) {
      throw sanitizeError(error, authUrl, cleanUrl)
    }
  }
}
