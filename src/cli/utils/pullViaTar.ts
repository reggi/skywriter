import {pullPathViaTar} from '../pathOperations/pullPathViaTar.ts'
import {isGitInstalled} from './git.ts'
import {pullHarness} from './pullHarness.ts'
import type {CliCommand} from './types.ts'

interface PullViaTarOptions {
  git?: boolean
}

/**
 * Pull via tar — delegates to pullHarness with a tar primitive.
 */
export const pullViaTar: CliCommand<[string?, string?, PullViaTarOptions?]> = async (
  ctx,
  source,
  destination,
  options,
) => {
  if (options?.git) {
    if (!(await isGitInstalled())) {
      throw new Error('Git is not installed. Please install git to use pull command.')
    }
  }

  await pullHarness(ctx => pullPathViaTar(ctx, {git: options?.git}))(ctx, source, destination)
}
