import {isDirectoryEmpty, isGitRepo, hasRemote} from '../utils/git.ts'
import {pushViaGit} from '../utils/pushViaGit.ts'
import {pushViaTar} from '../utils/pushViaTar.ts'
import type {CliCommand} from '../utils/types.ts'

type Via = 'git' | 'tar'

/**
 * Auto-detect transport based on directory state:
 * - Empty directory → git (default)
 * - Has .git with remote → git
 * - Has .git without remote → tar
 * - No .git → tar
 */
async function detectVia(): Promise<Via> {
  if (await isDirectoryEmpty()) return 'git'
  if (await isGitRepo()) {
    return (await hasRemote('.')) ? 'git' : 'tar'
  }
  return 'tar'
}

/**
 * Push command - unified push with --via transport selection
 */
export const push: CliCommand<[string?, {via?: string; git?: boolean}?]> = async (ctx, pathArg, options) => {
  let via: Via | undefined
  const noGit = options?.git === false

  if (options?.via) {
    if (options.via !== 'git' && options.via !== 'tar') {
      throw new Error(`Invalid --via value: "${options.via}". Must be "git" or "tar".`)
    }
    via = options.via
  }

  // --no-git implies --via=tar and errors if --via=git was explicit
  if (noGit) {
    if (via === 'git') {
      throw new Error('Cannot use --no-git with --via=git.')
    }
    via = 'tar'
  }

  // Auto-detect if not specified
  if (!via) {
    via = await detectVia()
  }

  if (via === 'git') {
    await pushViaGit(ctx, pathArg)
  } else {
    await pushViaTar(ctx, pathArg)
  }
}
