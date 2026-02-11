import {pushPathViaTar} from '../pathOperations/pushPathViaTar.ts'
import {pushHarness} from './pushHarness.ts'
import type {CliCommand} from './types.ts'

/**
 * Push via tar — delegates to pushHarness with upload plan display.
 */
export const pushViaTar: CliCommand<[string?]> = async (ctx, pathArg) => {
  await pushHarness(pushPathViaTar, {showPlan: true, prompt: ctx.prompt})(ctx, pathArg)
}
