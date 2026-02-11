import {isGitInstalled} from './git.ts'
import {pullPathViaGit} from '../pathOperations/pullPathViaGit.ts'
import {pullHarness} from './pullHarness.ts'
import type {CliCommand} from './types.ts'

/**
 * Pull via git — checks git is installed, then delegates to pullHarness.
 */
export const pullViaGit: CliCommand<[string?, string?]> = async (ctx, source, destination) => {
  if (!(await isGitInstalled())) {
    throw new Error('Git is not installed. Please install git to use pull command.')
  }

  await pullHarness(pullPathViaGit)(ctx, source, destination)
}
