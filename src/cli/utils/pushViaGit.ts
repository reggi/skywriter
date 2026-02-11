import {isGitInstalled, isGitRepo} from './git.ts'
import {pushPathViaGit} from '../pathOperations/pushPathViaGit.ts'
import {pushHarness} from './pushHarness.ts'
import type {CliCommand} from './types.ts'

/**
 * Push via git — checks git is installed and dir is a repo, then delegates to pushHarness.
 */
export const pushViaGit: CliCommand<[string?]> = async (ctx, source) => {
  if (!(await isGitInstalled())) {
    throw new Error('Git is not installed. Please install git to use push command.')
  }

  if (!(await isGitRepo())) {
    throw new Error('Current directory is not a git repository. Initialize with: git init')
  }

  await pushHarness(pushPathViaGit)(ctx, source)
}
