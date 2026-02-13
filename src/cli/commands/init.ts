import {join, resolve} from 'node:path'
import {readdir} from 'node:fs/promises'
import type {CliCommand} from '../utils/types.ts'
import {createPrefixLog} from '../utils/prefixLog.ts'
import {createLoggedFs} from '../utils/createLoggedFs.ts'
import {parseDocumentPath} from '../utils/parseDocumentPath.ts'
import {normalizePath} from '../utils/pageContext.ts'
import type {Settings, PathContext} from '../utils/pageContext.ts'
import {validatePathSettings} from '../pathOperations/validatePathSettings.ts'

interface InitOptions {
  path?: string
  extension?: string
  draft?: boolean
  published?: boolean
  template?: boolean | string
  slot?: boolean | string
}

async function initDirectory(
  cwd: string,
  options: Omit<InitOptions, 'cwd' | 'template' | 'slot'>,
  fs: ReturnType<typeof createLoggedFs>,
  {skipEmptyCheck}: {skipEmptyCheck?: boolean} = {},
): Promise<void> {
  const {path, extension = '.eta', draft = false, published = false} = options

  // Check if directory is empty
  if (!skipEmptyCheck && !(await fs.isDirectoryEmpty(cwd))) {
    throw new Error('Directory must be empty to initialize a new document')
  }

  // Create settings.json
  const settings: Record<string, string | boolean> = {}
  if (path) {
    settings.path = parseDocumentPath(path)
  }
  if (draft !== undefined) {
    settings.draft = draft
  }
  if (published !== undefined) {
    settings.published = published
  }

  await fs.writeFile(join(cwd, 'settings.json'), JSON.stringify(settings, null, 2) + '\n', 'utf-8')

  // Create content file with appropriate extension
  const contentFile = `content${extension}`
  await fs.writeFile(join(cwd, contentFile), '', 'utf-8')

  // Create style.css
  await fs.writeFile(join(cwd, 'style.css'), '/* Custom styles for your document */\n\n', 'utf-8')

  // Create server.js
  await fs.writeFile(join(cwd, 'server.js'), '// Server-side JavaScript\n\n', 'utf-8')

  // Create script.js
  await fs.writeFile(join(cwd, 'script.js'), '// Client-side JavaScript\n\n', 'utf-8')

  // Create .gitignore (inclusive pattern - ignore everything except specific files)
  const gitignoreContent = '*\n!.gitignore\n!settings.json\n!content.*\n!data.*\n!server.js\n!style.css\n!script.js\n'
  await fs.writeFile(join(cwd, '.gitignore'), gitignoreContent, 'utf-8')
}

/**
 * Resolve the path for a nested directory (template or slot).
 * - string value: use as explicit path via parseDocumentPath
 * - true (boolean): derive from basePath + suffix, error if no basePath
 */
function resolveNestedPath(flag: boolean | string, basePath: string | undefined, suffix: string): string {
  if (typeof flag === 'string') {
    return parseDocumentPath(flag)
  }
  if (!basePath) {
    throw new Error(`Cannot derive ${suffix} path: root has no path. Use --${suffix}=<name> to provide one.`)
  }
  return `${basePath}-${suffix}`
}

/**
 * Validate that all resolved paths are unique across root, template, and slot.
 * Includes both paths already on disk and newly computed paths.
 */
function validatePathsUnique(paths: {
  root?: string
  template?: string
  slot?: string
  existingTemplate?: string
  existingSlot?: string
}): void {
  const entries: [string, string][] = []
  if (paths.root) entries.push(['root', paths.root])
  if (paths.template) entries.push(['template', paths.template])
  if (paths.slot) entries.push(['slot', paths.slot])
  if (paths.existingTemplate) entries.push(['existing template_path', paths.existingTemplate])
  if (paths.existingSlot) entries.push(['existing slot_path', paths.existingSlot])

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[i][1] === entries[j][1]) {
        throw new Error(`Path collision: ${entries[i][0]} and ${entries[j][0]} both resolve to "${entries[i][1]}"`)
      }
    }
  }
}

/**
 * Initialize a new document with default files
 */
export const init: CliCommand<[InitOptions?]> = async (ctx, options = {}) => {
  const {template = false, slot = false, ...initOptions} = options
  const cwd = ctx.cwd
  const cmdLog = createPrefixLog(ctx.cliName, 'init')
  const fs = createLoggedFs(cmdLog, cwd)

  const shouldInitNested = template || slot

  // Validate path collisions from CLI args before any fs operations
  if (shouldInitNested && initOptions.path) {
    const rootPath = parseDocumentPath(initOptions.path)
    const templatePath = template ? resolveNestedPath(template, rootPath, 'template') : undefined
    const slotPath = slot ? resolveNestedPath(slot, rootPath, 'slot') : undefined
    validatePathsUnique({root: rootPath, template: templatePath, slot: slotPath})
  }

  const cwdEmpty = await fs.isDirectoryEmpty(cwd)

  // Non-empty cwd: nested init only, derive paths from existing root settings
  if (!cwdEmpty && shouldInitNested) {
    // Check target nested directories are empty before doing anything
    if (template) {
      const templateDir = join(cwd, 'template')
      try {
        const files = (await readdir(templateDir)).filter(f => f !== '.DS_Store')
        if (files.length > 0) {
          throw new Error('Directory must be empty to initialize a new document')
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    }
    if (slot) {
      const slotDir = join(cwd, 'slot')
      try {
        const files = (await readdir(slotDir)).filter(f => f !== '.DS_Store')
        if (files.length > 0) {
          throw new Error('Directory must be empty to initialize a new document')
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    }

    const parentSettings: Settings = JSON.parse(await fs.readFile(join(cwd, 'settings.json')))
    const rootPath: string | undefined = parentSettings.path

    // Validate existing settings before making changes
    const rootCtx: PathContext = {
      reference: 'main',
      path: rootPath || '',
      normalizedPath: rootPath ? normalizePath(rootPath) : '',
      serverUrl: '',
      auth: '',
      settings: parentSettings,
      dir: '.',
      absoluteDir: resolve(cwd),
      log: cmdLog,
      forbiddenPaths: [],
    }
    const violations = await validatePathSettings(rootCtx)
    if (violations.length > 0) {
      const allFixable = violations.every(v => v.apply)
      const suffix = allFixable ? `\nRun \`${ctx.cliName} settings --fix\` before proceeding.` : ''
      throw new Error(`Settings validation failed:\n${violations.map(v => `  - ${v.message}`).join('\n')}` + suffix)
    }

    // If --path was provided, it must match the existing root path
    if (initOptions.path) {
      const normalizedPath = parseDocumentPath(initOptions.path)
      if (rootPath !== normalizedPath) {
        throw new Error(`Provided path "${normalizedPath}" does not match root path "${rootPath}"`)
      }
    }

    if (template && parentSettings.template_path) {
      throw new Error(`Root already has template_path set to "${parentSettings.template_path}"`)
    }
    if (slot && parentSettings.slot_path) {
      throw new Error(`Root already has slot_path set to "${parentSettings.slot_path}"`)
    }

    const templatePath = template ? resolveNestedPath(template, rootPath, 'template') : undefined
    const slotPath = slot ? resolveNestedPath(slot, rootPath, 'slot') : undefined

    validatePathsUnique({
      root: rootPath,
      template: templatePath,
      slot: slotPath,
      existingTemplate: parentSettings.template_path ?? undefined,
      existingSlot: parentSettings.slot_path ?? undefined,
    })

    if (template && templatePath) {
      const templateDir = join(cwd, 'template')
      await fs.mkdir(templateDir, {recursive: true})
      await initDirectory(templateDir, {...initOptions, path: templatePath}, fs, {skipEmptyCheck: true})
      await fs.updateJsonProperty(join(cwd, 'settings.json'), ['template_path'], templatePath)
    }

    if (slot && slotPath) {
      const slotDir = join(cwd, 'slot')
      await fs.mkdir(slotDir, {recursive: true})
      await initDirectory(slotDir, {...initOptions, path: slotPath}, fs, {skipEmptyCheck: true})
      await fs.updateJsonProperty(join(cwd, 'settings.json'), ['slot_path'], slotPath)
    }

    return
  }

  // If cwd is empty and nested init is requested, resolve paths.
  let rootPath: string | undefined
  let templatePath: string | undefined
  let slotPath: string | undefined
  if (shouldInitNested) {
    rootPath = initOptions.path ? parseDocumentPath(initOptions.path) : undefined
    templatePath = template ? resolveNestedPath(template, rootPath, 'template') : undefined
    slotPath = slot ? resolveNestedPath(slot, rootPath, 'slot') : undefined
  }

  // Otherwise, behave like normal init (already confirmed cwd is empty).
  await initDirectory(cwd, initOptions, fs, {skipEmptyCheck: true})

  // Initialize requested subdirs.
  if (shouldInitNested) {
    if (template && templatePath) {
      const templateDir = join(cwd, 'template')
      await fs.mkdir(templateDir, {recursive: true})
      await initDirectory(templateDir, {...initOptions, path: templatePath}, fs, {skipEmptyCheck: true})
      await fs.updateJsonProperty(join(cwd, 'settings.json'), ['template_path'], templatePath)
    }

    if (slot && slotPath) {
      const slotDir = join(cwd, 'slot')
      await fs.mkdir(slotDir, {recursive: true})
      await initDirectory(slotDir, {...initOptions, path: slotPath}, fs, {skipEmptyCheck: true})
      await fs.updateJsonProperty(join(cwd, 'settings.json'), ['slot_path'], slotPath)
    }
  }
}
