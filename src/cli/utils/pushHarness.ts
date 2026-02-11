import {readSettings, getPageData} from './pageContext.ts'
import type {PathOperation} from './pageContext.ts'
import {uploadPathUploads} from '../pathOperations/uploadPathUploads.ts'
import {deletePathUploads} from '../pathOperations/deletePathUploads.ts'
import {validateDirSettings, displayUploadPlan} from './settingsValidation.ts'
import {validateAndGetFilesFromDir} from './validateAndGetFilesFromDir.ts'
import {populateCache} from './populateCache.ts'
import {createPrefixLog} from './prefixLog.ts'
import {createLoggedFs} from './createLoggedFs.ts'
import {resolveTarget} from './resolveTarget.ts'
import {logData} from './logData.ts'
import type {CliCommand} from './types.ts'

interface PushHarnessOptions {
  /** Show upload plan and confirm before pushing (tar flow) */
  showPlan?: boolean
  /** Prompt before confirmation */
  prompt?: boolean
}

/**
 * Create a push command from a push primitive (e.g. pushPathViaGit).
 *
 * The harness handles:
 *   1. Resolving target (server, credentials)
 *   2. Reading settings.json
 *   3. Validating template/slot directories vs settings
 *   4. Building page contexts via getPageData
 *   5. Optionally displaying upload plan + confirmation (tar flow)
 *   6. Pushing each context via the primitive
 *   7. Uploading/deleting uploads for each context
 *   8. Populating cache
 */
export function pushHarness(pushPrimitive: PathOperation, options?: PushHarnessOptions): CliCommand<[string?]> {
  return async (ctx, source) => {
    const log = createPrefixLog(ctx.cliName, 'push')
    const target = await resolveTarget(ctx, log, source)
    const {serverUrl, documentPath} = target

    const settings = await readSettings()
    if (!settings) {
      throw new Error('Could not determine document path from settings.json')
    }
    settings.path = documentPath

    // Validate dirs
    await validateDirSettings(settings, ctx.cliName, createLoggedFs(log, ctx.cwd))

    // Build contexts
    const contexts = await getPageData(settings, serverUrl, target.auth, log, {
      prompt: ctx.prompt,
    })

    // Validate files for each context
    for (const pathCtx of contexts) {
      await validateAndGetFilesFromDir(pathCtx.dir)
    }

    // Show upload plan + confirm (tar flow)
    if (options?.showPlan) {
      const proceed = await displayUploadPlan({
        contexts,
        settings,
        serverUrl,
        auth: target.auth,
        log,
        prompt: options.prompt,
      })
      if (!proceed) return
    }

    try {
      // Push each context
      for (const pathCtx of contexts) {
        await pushPrimitive(pathCtx)
      }

      // Upload/delete for each context
      for (const pathCtx of contexts) {
        await uploadPathUploads(pathCtx)
        await deletePathUploads(pathCtx)
      }
    } catch (error) {
      throw new Error(`Push failed: ${(error as Error).message}`)
    }

    await populateCache(target, log)

    const normalizedPath = documentPath.startsWith('/') ? documentPath.slice(1) : documentPath
    const url = normalizedPath ? `${serverUrl}/${normalizedPath}` : serverUrl
    if (ctx.json) {
      logData({url}, true)
    } else {
      log.info(`url: ${url}`)
    }
  }
}
