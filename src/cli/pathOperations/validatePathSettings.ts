import {join, resolve} from 'node:path'
import type {PathContext, PathOperation, Settings} from '../utils/pageContext.ts'
import {readSettings, normalizePath} from '../utils/pageContext.ts'
import {createLoggedFs} from '../utils/createLoggedFs.ts'

type LoggedFs = ReturnType<typeof createLoggedFs>

interface SettingsIssue {
  message: string
  fix?: string
  apply?: () => Promise<void>
}

// --- Helpers ---

async function getUploadsFromDir(dir: string, fs: LoggedFs): Promise<string[]> {
  try {
    await fs.access(dir)
    const stats = await fs.stat(dir)
    if (!stats.isDirectory()) return []
    const files = await fs.readdir(dir)
    const results: string[] = []
    for (const file of files) {
      if (file.startsWith('.')) continue
      const filePath = join(dir, file)
      const fileStat = await fs.stat(filePath)
      if (fileStat.isFile()) {
        results.push(file)
      }
    }
    return results
  } catch {
    return []
  }
}

function dirLabel(dir: string): string {
  return dir === '.' ? '' : `${dir}/`
}

// --- Uploads sync check ---

async function checkUploadsSync(absDir: string, settings: Settings, fs: LoggedFs): Promise<SettingsIssue[]> {
  const issues: SettingsIssue[] = []
  const uploadsDir = join(absDir, 'uploads')
  const uploadsExist = await fs.directoryExists(uploadsDir)
  if (!uploadsExist) return issues

  const localUploads = await getUploadsFromDir(uploadsDir, fs)
  const currentUploads = settings.uploads || []
  const newUploads = localUploads.filter(f => !currentUploads.includes(f))
  const removedUploads = currentUploads.filter(f => !localUploads.includes(f))

  if (newUploads.length > 0 || removedUploads.length > 0) {
    const parts: string[] = []
    if (newUploads.length > 0) parts.push(`add ${newUploads.join(', ')}`)
    if (removedUploads.length > 0) parts.push(`remove ${removedUploads.join(', ')}`)

    issues.push({
      message: `settings.json uploads out of sync: ${parts.join('; ')}`,
      fix: `Sync settings.json uploads array`,
      apply: async () => {
        await fs.updateJsonProperty(join(absDir, 'settings.json'), ['uploads'], localUploads)
      },
    })
  }

  return issues
}

// --- Build child PathContext ---

function buildChildCtx(
  parentCtx: PathContext,
  childName: 'template' | 'slot',
  childSettings: Settings,
  forbiddenPaths: string[],
): PathContext {
  const childDir = parentCtx.dir === '.' ? childName : join(parentCtx.dir, childName)
  return {
    ...parentCtx,
    reference: childName,
    path: childSettings.path,
    normalizedPath: normalizePath(childSettings.path),
    settings: childSettings,
    dir: childDir,
    absoluteDir: resolve(parentCtx.absoluteDir, childName),
    log: parentCtx.log.prefix(childName),
    forbiddenPaths,
  }
}

// --- Main PathOperation ---

/**
 * Validate settings.json for a path and its children (template/slot).
 * Fractal: applies the same validation at each level.
 * Returns a list of issues, each optionally with a fix.
 */
export const validatePathSettings: PathOperation<SettingsIssue[]> = async ctx => {
  const issues: SettingsIssue[] = []
  const fs = createLoggedFs(ctx.log, ctx.absoluteDir)
  const {settings, dir} = ctx
  // Resolve file paths against absoluteDir so operations work regardless of process.cwd()
  const absDir = ctx.absoluteDir

  // 1. Validate path field
  if (!settings.path) {
    issues.push({message: `${dirLabel(dir)}settings.json is missing the "path" field`})
    return issues
  }

  // 2. Check path doesn't collide with forbidden (parent/sibling) paths
  const forbidden = ctx.forbiddenPaths || []
  if (forbidden.includes(settings.path)) {
    issues.push({
      message: `${dirLabel(dir)}settings.json path "${settings.path}" collides with a parent or sibling path`,
    })
  }

  // 3. Discover children
  const templateDir = join(absDir, 'template')
  const slotDir = join(absDir, 'slot')
  const templateLabel = `${dirLabel(dir)}template/`
  const slotLabel = `${dirLabel(dir)}slot/`

  const templateExists = await fs.directoryExists(templateDir)
  const slotExists = await fs.directoryExists(slotDir)

  const templateSettings = templateExists ? await readSettings(templateDir, fs) : null
  const slotSettings = slotExists ? await readSettings(slotDir, fs) : null

  // 4. Check child settings.json existence — create if missing
  if (templateExists && !templateSettings) {
    const templatePath = settings.template_path || `${settings.path}/template`
    issues.push({
      message: `${templateLabel}settings.json is missing`,
      fix: `Create ${templateLabel}settings.json with path "${templatePath}"`,
      apply: async () => {
        await fs.writeFile(join(templateDir, 'settings.json'), JSON.stringify({path: templatePath}, null, 2) + '\n')
      },
    })
  }

  if (slotExists && !slotSettings) {
    const slotPath = settings.slot_path || `${settings.path}/slot`
    issues.push({
      message: `${slotLabel}settings.json is missing`,
      fix: `Create ${slotLabel}settings.json with path "${slotPath}"`,
      apply: async () => {
        await fs.writeFile(join(slotDir, 'settings.json'), JSON.stringify({path: slotPath}, null, 2) + '\n')
      },
    })
  }

  // 5. Template dir exists but template_path not set in parent
  if (templateExists && !settings.template_path) {
    const templatePath = templateSettings?.path || `${settings.path}/template`
    issues.push({
      message: `${dirLabel(dir)}Template directory exists but template_path is not set in settings.json`,
      fix: `Set template_path to "${templatePath}"`,
      apply: async () => {
        await fs.updateJsonProperty(join(absDir, 'settings.json'), ['template_path'], templatePath)
      },
    })
  }

  // 6. Slot dir exists but slot_path not set in parent
  if (slotExists && !settings.slot_path) {
    const slotPath = slotSettings?.path || `${settings.path}/slot`
    issues.push({
      message: `${dirLabel(dir)}Slot directory exists but slot_path is not set in settings.json`,
      fix: `Set slot_path to "${slotPath}"`,
      apply: async () => {
        await fs.updateJsonProperty(join(absDir, 'settings.json'), ['slot_path'], slotPath)
      },
    })
  }

  // 7. Template path mismatch between parent's template_path and template/settings.json
  if (templateExists && settings.template_path && templateSettings) {
    if (templateSettings.path !== settings.template_path) {
      issues.push({
        message: `template_path "${settings.template_path}" differs from ${templateLabel}settings.json path "${templateSettings.path}"`,
        fix: `Update template_path to "${templateSettings.path}"`,
        apply: async () => {
          await fs.updateJsonProperty(join(absDir, 'settings.json'), ['template_path'], templateSettings.path)
        },
      })
    }
  }

  // 8. Slot path mismatch between parent's slot_path and slot/settings.json
  if (slotExists && settings.slot_path && slotSettings) {
    if (slotSettings.path !== settings.slot_path) {
      issues.push({
        message: `slot_path "${settings.slot_path}" differs from ${slotLabel}settings.json path "${slotSettings.path}"`,
        fix: `Update slot_path to "${slotSettings.path}"`,
        apply: async () => {
          await fs.updateJsonProperty(join(absDir, 'settings.json'), ['slot_path'], slotSettings.path)
        },
      })
    }
  }

  // 9. Uploads sync for this level
  issues.push(...(await checkUploadsSync(absDir, settings, fs)))

  // 10. Build forbidden paths for children (no child should reuse parent or sibling paths)
  const childForbidden = [settings.path, ...forbidden]

  // 11. Fractally validate template
  if (templateExists && templateSettings) {
    const templateForbidden = [...childForbidden, ...(slotSettings?.path ? [slotSettings.path] : [])]
    const templateCtx = buildChildCtx(ctx, 'template', templateSettings, templateForbidden)
    issues.push(...(await validatePathSettings(templateCtx)))
  }

  // 12. Fractally validate slot
  if (slotExists && slotSettings) {
    const slotForbidden = [...childForbidden, ...(templateSettings?.path ? [templateSettings.path] : [])]
    const slotCtx = buildChildCtx(ctx, 'slot', slotSettings, slotForbidden)
    issues.push(...(await validatePathSettings(slotCtx)))
  }

  return issues
}
