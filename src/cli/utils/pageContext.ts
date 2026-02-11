import {readFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import type {PrefixLog} from './prefixLog.ts'

export interface Settings {
  path: string
  slot_path?: string | null
  template_path?: string | null
  uploads?: string[]
}

type PageReference = 'main' | 'template' | 'slot'

export interface PathContext {
  reference: PageReference
  path: string
  normalizedPath: string
  serverUrl: string
  auth: string
  settings: Settings
  /** Relative dir for display / logging */
  dir: string
  /** Absolute dir for fs / git operations */
  absoluteDir: string
  log: PrefixLog
  /** Prompt before exec operations */
  prompt?: boolean
  /** Paths that this context's path must not collide with (parent/sibling) */
  forbiddenPaths?: string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PathOperation<T = void> = (ctx: PathContext, ...args: any[]) => Promise<T>

/**
 * Read settings.json from a directory
 */
export async function readSettings(
  dir: string = '.',
  fs?: {readFile: (path: string, encoding?: BufferEncoding) => Promise<string>},
): Promise<Settings | null> {
  try {
    const settingsPath = dir === '.' ? 'settings.json' : join(dir, 'settings.json')
    const settingsContent = fs ? await fs.readFile(settingsPath) : await readFile(settingsPath, 'utf-8')
    return JSON.parse(settingsContent) as Settings
  } catch {
    return null
  }
}

/**
 * Get the uploads directory for a PathContext
 */
export function getUploadsDir(ctx: PathContext): string {
  return ctx.dir === '.' ? 'uploads' : join(ctx.dir, 'uploads')
}

/**
 * Normalize a path by removing the leading slash
 */
export function normalizePath(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path
}

/**
 * Build an array of PathContext objects from main settings.
 * Always includes main, conditionally adds template and slot.
 * Returns in execution order for push (template → slot → main).
 */
export async function getPageData(
  mainSettings: Settings,
  serverUrl: string,
  auth: string,
  log: PrefixLog,
  options?: {prompt?: boolean},
): Promise<PathContext[]> {
  const contexts: PathContext[] = []

  // Template (first, so main can reference it)
  if (mainSettings.template_path) {
    const templateSettings = await readSettings('template')
    if (templateSettings) {
      contexts.push({
        reference: 'template',
        path: mainSettings.template_path,
        normalizedPath: normalizePath(mainSettings.template_path),
        serverUrl,
        auth,
        settings: templateSettings,
        dir: 'template',
        absoluteDir: resolve('template'),
        log: log.prefix(mainSettings.template_path),
        prompt: options?.prompt,
      })
    }
  }

  // Slot (second, so main can reference it)
  if (mainSettings.slot_path) {
    const slotSettings = await readSettings('slot')
    if (slotSettings) {
      contexts.push({
        reference: 'slot',
        path: mainSettings.slot_path,
        normalizedPath: normalizePath(mainSettings.slot_path),
        serverUrl,
        auth,
        settings: slotSettings,
        dir: 'slot',
        absoluteDir: resolve('slot'),
        log: log.prefix(mainSettings.slot_path),
        prompt: options?.prompt,
      })
    }
  }

  // Main (last)
  contexts.push({
    reference: 'main',
    path: mainSettings.path,
    normalizedPath: normalizePath(mainSettings.path),
    serverUrl,
    auth,
    settings: mainSettings,
    dir: '.',
    absoluteDir: resolve('.'),
    log: log.prefix(mainSettings.path),
    prompt: options?.prompt,
  })

  return contexts
}
