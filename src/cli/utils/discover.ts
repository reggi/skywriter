import {readdir, readFile, stat} from 'node:fs/promises'
import {join} from 'node:path'
import type {DiscoveredDocument, DiscoveryResult} from '../middleware/types.ts'
import log from './log.ts'

/**
 * Folders to skip when scanning for settings.json files
 */
const IGNORED_FOLDERS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  '__pycache__',
  '.pytest_cache',
  '.vscode',
  '.idea',
  'vendor',
  'bower_components',
])

/**
 * Read and parse settings.json from a directory
 */
async function readSettings(dir: string): Promise<{
  path?: string
  template_path?: string | null
  slot_path?: string | null
} | null> {
  try {
    const content = await readFile(join(dir, 'settings.json'), 'utf-8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

/**
 * Check if a directory contains a valid document (has settings.json and content file)
 */
async function isValidDocumentDir(dir: string): Promise<boolean> {
  try {
    const files = await readdir(dir)
    const hasSettings = files.includes('settings.json')
    const hasContent = files.some(f => f.startsWith('content.') || f === 'index.html')
    return hasSettings && hasContent
  } catch {
    return false
  }
}

/**
 * Recursively scan a directory for settings.json files
 */
async function scanDirectory(
  rootDir: string,
  currentDir: string,
  results: DiscoveredDocument[],
  errors: Array<{fsPath: string; error: string}>,
  visited: Set<string>,
): Promise<void> {
  // Avoid infinite loops with symlinks
  const realPath = await stat(currentDir).catch(() => null)
  if (!realPath?.isDirectory()) return

  const dirKey = `${realPath.dev}:${realPath.ino}`
  if (visited.has(dirKey)) return
  visited.add(dirKey)

  try {
    const entries = await readdir(currentDir, {withFileTypes: true})

    // Check if this directory is a valid document
    const settings = await readSettings(currentDir)
    if (settings?.path !== undefined) {
      const isValid = await isValidDocumentDir(currentDir)
      if (isValid) {
        const hasTemplate = entries.some(e => e.isDirectory() && e.name === 'template')
        const hasSlot = entries.some(e => e.isDirectory() && e.name === 'slot')

        results.push({
          path: settings.path,
          fsPath: currentDir,
          hasTemplate,
          hasSlot,
          templatePath: settings.template_path ?? null,
          slotPath: settings.slot_path ?? null,
        })
      }
    }

    // Recurse into subdirectories
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (IGNORED_FOLDERS.has(entry.name)) continue
      // Include template and slot directories - they can be served as standalone pages too
      // Skip hidden directories
      if (entry.name.startsWith('.')) continue
      // Skip uploads directories
      if (entry.name === 'uploads') continue

      const subDir = join(currentDir, entry.name)
      await scanDirectory(rootDir, subDir, results, errors, visited)
    }
  } catch (error) {
    errors.push({
      fsPath: currentDir,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

interface DiscoverOptions {
  /** If true, throw an error when no documents are found. Default: false */
  throwOnEmpty?: boolean
}

/**
 * Discover all documents in a directory tree
 *
 * Scans the given root directory recursively for all folders containing
 * a valid settings.json file. Skips common non-document folders like
 * node_modules, .git, etc.
 *
 * @param rootDir - The root directory to scan (defaults to cwd)
 * @param options - Discovery options
 * @returns Discovery result with all found documents and any errors
 */
export async function discoverDocuments(
  rootDir: string = process.cwd(),
  options: DiscoverOptions = {},
): Promise<DiscoveryResult> {
  const results: DiscoveredDocument[] = []
  const errors: Array<{fsPath: string; error: string}> = []
  const visited = new Set<string>()

  await scanDirectory(rootDir, rootDir, results, errors, visited)

  // Build the documents map and detect duplicates
  const documents = new Map<string, DiscoveredDocument>()
  const duplicates = new Map<string, string[]>()

  for (const doc of results) {
    const existing = documents.get(doc.path)
    if (existing) {
      // Track duplicates
      const paths = duplicates.get(doc.path) || [existing.fsPath]
      paths.push(doc.fsPath)
      duplicates.set(doc.path, paths)
    } else {
      documents.set(doc.path, doc)
    }
  }

  // Sort paths alphabetically
  const sortedPaths = Array.from(documents.keys()).sort()

  const result: DiscoveryResult = {
    documents,
    sortedPaths,
    errors,
    duplicates,
  }

  reportDiscovery(result, options.throwOnEmpty ?? false)

  return result
}

/**
 * Report discovery results to console
 * Optionally throws if no documents found
 */
function reportDiscovery(discovery: DiscoveryResult, throwOnEmpty: boolean): void {
  if (discovery.errors.length > 0) {
    log.info('⚠️  Errors during discovery:')
    for (const err of discovery.errors) {
      log.info(`   ${err.fsPath}: ${err.error}`)
    }
  }

  if (discovery.documents.size === 0) {
    if (throwOnEmpty) {
      throw new Error('No documents found. Make sure there is at least one folder with settings.json and content file.')
    }
    return
  }

  log.info(`📄 Discovered ${discovery.documents.size} document(s):`)
  for (const path of discovery.sortedPaths) {
    const doc = discovery.documents.get(path)!
    const extras: string[] = []
    if (doc.hasTemplate) extras.push('has template')
    if (doc.hasSlot) extras.push('has slot')
    const extraInfo = extras.length > 0 ? ` (${extras.join(', ')})` : ''
    log.info(`   ${path}${extraInfo}`)
  }

  if (discovery.duplicates.size > 0) {
    log.info('\n⚠️  Duplicate paths detected (will error if accessed directly):')
    for (const [path, locations] of discovery.duplicates) {
      log.info(`   ${path}:`)
      for (const loc of locations) {
        log.info(`     - ${loc}`)
      }
    }
  }
}

/**
 * Find the best redirect path when root doesn't exist
 *
 * Returns the first path alphabetically that is a top-level path
 * (e.g., /about, /blog rather than /blog/post-1)
 */
export function findDefaultRedirect(sortedPaths: string[]): string | null {
  if (sortedPaths.length === 0) return null

  // First try to find a top-level path (single segment after /)
  const topLevelPaths = sortedPaths.filter(p => {
    if (p === '/') return false
    const segments = p.split('/').filter(Boolean)
    return segments.length === 1
  })

  if (topLevelPaths.length > 0) {
    return topLevelPaths[0]
  }

  // If no top-level paths, return the first path that isn't root
  const nonRoot = sortedPaths.filter(p => p !== '/')
  return nonRoot[0] || null
}
