import {join} from 'node:path'
import {confirm} from '@inquirer/prompts'
import {getUploadsDir} from './pageContext.ts'
import type {Settings, PathContext} from './pageContext.ts'
import {validateAndGetFilesFromDir} from './validateAndGetFilesFromDir.ts'
import {formatDocumentPlan, type DocumentPlan, type FileItem} from './formatPlan.ts'
import {createLoggedFetch} from './loggedFetch.ts'
import type {FetchFn} from './loggedFetch.ts'
import type {PrefixLog} from './prefixLog.ts'
import {createLoggedFs} from './createLoggedFs.ts'
import log from './log.ts'

type LoggedFs = ReturnType<typeof createLoggedFs>

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

interface ServerSettings {
  path: string
  draft?: boolean
  published?: string
  slot_path?: string | null
  template_path?: string | null
  uploads?: string[]
  title?: string
}

async function fetchServerSettings(
  fetchFn: FetchFn,
  serverUrl: string,
  auth: string,
  path: string,
): Promise<ServerSettings | null> {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  const settingsUrl = normalizedPath ? `${serverUrl}/${normalizedPath}/settings.json` : `${serverUrl}/settings.json`

  try {
    const response = await fetchFn(settingsUrl, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    })

    if (!response.ok) {
      return null
    }

    return (await response.json()) as ServerSettings
  } catch {
    return null
  }
}

// --- Dir validation (used by pushHarness) ---

/**
 * Validate that template/slot directories match settings.json.
 * Throws if a directory exists but its path is not set in settings.
 */
export async function validateDirSettings(settings: Settings, cliName: string, fs: LoggedFs): Promise<void> {
  const templateExists = await fs.directoryExists('template')
  if (templateExists && !settings.template_path) {
    throw new Error(
      'Template directory exists but template_path is not set in settings.json.\n' +
        `Run \`${cliName} settings --fix\` to fix this automatically.`,
    )
  }

  const slotExists = await fs.directoryExists('slot')
  if (slotExists && !settings.slot_path) {
    throw new Error(
      'Slot directory exists but slot_path is not set in settings.json.\n' +
        `Run \`${cliName} settings --fix\` to fix this automatically.`,
    )
  }
}

// --- Upload plan display (used by tar push) ---

/**
 * Validate files, fetch server settings, display upload plan, and confirm.
 * Returns true to proceed, false if cancelled.
 */
export async function displayUploadPlan(options: {
  contexts: PathContext[]
  settings: Settings
  serverUrl: string
  auth: string
  log: PrefixLog
  prompt?: boolean
}): Promise<boolean> {
  const {contexts, settings, serverUrl, auth, log: cmdLog} = options
  const fs = createLoggedFs(cmdLog, process.cwd())

  cmdLog.info('Building upload plan...')

  // Fetch server settings for all contexts in parallel
  const fetchFn = createLoggedFetch(cmdLog)
  const serverSettingsMap = new Map<string, ServerSettings | null>()
  await Promise.all(
    contexts.map(async pathCtx => {
      const ss = await fetchServerSettings(fetchFn, serverUrl, auth, pathCtx.path)
      serverSettingsMap.set(pathCtx.reference, ss)
    }),
  )

  // Build document info
  interface DocumentInfo {
    ctx: PathContext
    serverSettings: ServerSettings | null
    isCreate: boolean
    files: string[]
    excluded: string[]
    localUploads: string[]
    serverUploads: string[]
    uploadsToAdd: string[]
    uploadsToRemove: string[]
    uploadsSynced: string[]
  }

  const documents: DocumentInfo[] = []

  for (const pathCtx of contexts) {
    const {files, excluded} = await validateAndGetFilesFromDir(pathCtx.dir === '.' ? '.' : pathCtx.dir)
    const uploadsDir = getUploadsDir(pathCtx)
    const uploadsExist = await fs.directoryExists(uploadsDir)
    const localUploads = uploadsExist
      ? await getUploadsFromDir(uploadsDir, fs)
      : pathCtx.reference === 'main'
        ? settings.uploads || []
        : []
    const ss = serverSettingsMap.get(pathCtx.reference) ?? null
    const serverUploads = ss?.uploads || []

    documents.push({
      ctx: pathCtx,
      serverSettings: ss,
      isCreate: !ss,
      files,
      excluded,
      localUploads,
      serverUploads,
      uploadsToAdd: localUploads.filter(f => !serverUploads.includes(f)),
      uploadsToRemove: serverUploads.filter(f => !localUploads.includes(f)),
      uploadsSynced: localUploads.filter(f => serverUploads.includes(f)),
    })
  }

  // Display plan
  cmdLog.info('Upload plan:')

  const excludedDenylist = [
    '.gitignore',
    '.github',
    'uploads',
    'doc.code-workspace',
    '.git',
    'slot',
    'template',
    '.DS_Store',
  ]

  for (const doc of documents) {
    const fullUrl = `${serverUrl}${doc.ctx.path}`
    const actionLabel = doc.isCreate ? 'Create' : 'Update'
    const label = doc.ctx.reference.charAt(0).toUpperCase() + doc.ctx.reference.slice(1)

    const fileItems: FileItem[] = []

    doc.files.forEach(file => {
      fileItems.push({file, status: 'included'})
    })

    const visibleExcluded = doc.excluded.filter(file => !excludedDenylist.includes(file))
    visibleExcluded.forEach(file => {
      fileItems.push({file, status: 'ignored'})
    })

    doc.uploadsSynced.forEach(file => {
      fileItems.push({file: `uploads/${file}`, status: 'synced'})
    })
    doc.uploadsToAdd.forEach(file => {
      fileItems.push({file: `uploads/${file}`, status: 'add'})
    })
    doc.uploadsToRemove.forEach(file => {
      fileItems.push({file: `uploads/${file}`, status: 'remove'})
    })

    const plan: DocumentPlan = {
      label: `${actionLabel} ${label}`,
      url: fullUrl,
      files: fileItems,
    }

    log.info(formatDocumentPlan(plan, {showAllFiles: true}))
  }
  log.info()

  // Confirm
  if (options.prompt) {
    let uploadCount = 0
    let removeCount = 0
    for (const doc of documents) {
      uploadCount += doc.files.length + doc.uploadsToAdd.length
      removeCount += doc.uploadsToRemove.length
    }

    const parts: string[] = []
    if (uploadCount > 0) parts.push(`upload ${uploadCount} item${uploadCount === 1 ? '' : 's'}`)
    if (removeCount > 0) parts.push(`remove ${removeCount}`)
    const confirmMessage =
      parts.length > 0 ? `Would you like to ${parts.join(', and ')}?` : 'Would you like to proceed?'

    const proceed = await confirm({
      message: confirmMessage,
      default: true,
      theme: {prefix: ''},
    })

    if (!proceed) {
      cmdLog.info('Update cancelled.')
      return false
    }
  }

  return true
}
