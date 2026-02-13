import {readSettings, normalizePath} from './pageContext.ts'
import type {PathContext, PathOperation} from './pageContext.ts'
import {resolve} from 'node:path'
import {populateCache} from './populateCache.ts'
import {downloadPathUploads} from '../pathOperations/downloadPathUploads.ts'
import {createPrefixLog} from './prefixLog.ts'
import {resolveTarget} from './resolveTarget.ts'
import {logData} from './logData.ts'
import type {CliCommand} from './types.ts'

/**
 * Create a pull command from a pull primitive (e.g. pullPathViaGit).
 *
 * The harness handles:
 *   1. Resolving target (server, credentials, dest)
 *   2. Pulling the main repo via the primitive
 *   3. Reading settings.json to discover template_path / slot_path
 *   4. Pulling template and slot sequentially via the primitive
 *   5. Downloading uploads for all repos
 *   6. Populating cache
 */
export function pullHarness(pullPrimitive: PathOperation): CliCommand<[string?, string?]> {
  return async (ctx, source, destination) => {
    const log = createPrefixLog(ctx.cliName, 'pull')
    const prompt = ctx.prompt

    const target = await resolveTarget(ctx, log, source, destination)
    const {serverUrl, documentPath, dest} = target

    try {
      // 1. Pull/clone main repository
      const mainCtx: PathContext = {
        ...target,
        reference: 'main',
        path: documentPath,
        normalizedPath: normalizePath(documentPath),
        settings: {path: documentPath},
        dir: dest,
        absoluteDir: resolve(dest),
        log: log.prefix(documentPath),
        prompt,
      }
      await pullPrimitive(mainCtx)

      // 2. Read settings.json from (possibly just-cloned) dest to discover template/slot
      const settings = await readSettings(dest)
      if (settings) {
        mainCtx.settings = settings

        // 3. Pull/clone template and slot sequentially for deterministic log output
        const subContexts: PathContext[] = []

        if (settings.template_path) {
          const templateDir = dest === '.' ? 'template' : `${dest}/template`
          subContexts.push({
            ...target,
            reference: 'template',
            path: settings.template_path,
            normalizedPath: normalizePath(settings.template_path),
            settings: {path: settings.template_path},
            dir: templateDir,
            absoluteDir: resolve(templateDir),
            log: log.prefix(settings.template_path),
            prompt,
          })
        }

        if (settings.slot_path) {
          const slotDir = dest === '.' ? 'slot' : `${dest}/slot`
          subContexts.push({
            ...target,
            reference: 'slot',
            path: settings.slot_path,
            normalizedPath: normalizePath(settings.slot_path),
            settings: {path: settings.slot_path},
            dir: slotDir,
            absoluteDir: resolve(slotDir),
            log: log.prefix(settings.slot_path),
            prompt,
          })
        }

        // this prevents tests snapshots from being non-deterministic due to parallel pulls logging in random order
        for (const subCtx of subContexts) {
          await pullPrimitive(subCtx)
        }

        // 4. Re-read settings for each sub-repo (now that they're cloned) and download uploads
        for (const subCtx of subContexts) {
          const subSettings = await readSettings(subCtx.dir)
          if (subSettings) {
            subCtx.settings = subSettings
          }
        }

        const allContexts: PathContext[] = [mainCtx, ...subContexts]
        for (const pathCtx of allContexts) {
          await downloadPathUploads(pathCtx)
        }
      }

      await populateCache(target, log, dest)

      const normalizedPath = documentPath.startsWith('/') ? documentPath.slice(1) : documentPath
      const url = normalizedPath ? `${serverUrl}/${normalizedPath}` : serverUrl
      if (ctx.json) {
        logData({url}, true)
      } else {
        log.info(`url: ${url}`)
      }
    } catch (error) {
      throw new Error(`pull failed: ${(error as Error).message}`)
    }
  }
}
