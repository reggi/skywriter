import {pullViaGit} from '../utils/pullViaGit.ts'
import {pullViaTar} from '../utils/pullViaTar.ts'
import {hasRemote} from '../utils/git.ts'
import {resolveTarget} from '../utils/resolveTarget.ts'
import {createPrefixLog} from '../utils/prefixLog.ts'
import {resolve} from 'node:path'
import {access} from 'node:fs/promises'
import type {CliCommand} from '../utils/types.ts'

/**
 * Pull command - clone or update a document from server
 *
 * Clone:
 *   skywriter pull /meow              → clone into ./meow using default server
 *   skywriter pull http://host/meow   → clone into ./meow using that server
 *   skywriter pull meow               → clone into ./meow using default server
 *   skywriter pull /meow my-folder    → clone into ./my-folder
 *
 * Update (inside existing repo):
 *   skywriter pull                    → pull updates using settings.json
 *   skywriter pull /meow              → pull if settings.json#path matches
 */
export const pull: CliCommand<[string?, string?, {via?: string; git?: boolean}?]> = async (
  ctx,
  source,
  destination,
  options,
) => {
  if (options?.via) {
    if (options.via !== 'git' && options.via !== 'tar') {
      throw new Error(`Invalid --via value: "${options.via}". Must be "git" or "tar".`)
    }
    if (options.via === 'tar') {
      await pullViaTar(ctx, source, destination, {git: options.git})
      return
    }
  }

  // When no --via is specified, check if the target is a git repo with a remote
  if (!options?.via) {
    const cmdLog = createPrefixLog(ctx.cliName, 'pull')
    const {dest} = await resolveTarget(ctx, cmdLog, source, destination)
    const targetDir = resolve(dest)
    const isGitDir = await access(`${targetDir}/.git`).then(
      () => true,
      () => false,
    )
    if (isGitDir && !(await hasRemote(targetDir))) {
      await pullViaTar(ctx, source, destination, {git: options?.git})
      return
    }
  }

  await pullViaGit(ctx, source, destination)
}
