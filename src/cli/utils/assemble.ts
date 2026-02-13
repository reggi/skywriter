import {readFile, readdir} from 'node:fs/promises'
import {extname, join} from 'node:path'
import type {DocumentId, RenderDocument} from '../../operations/types.ts'

interface LocalFiles {
  content?: string
  data?: string
  style?: string
  script?: string
  server?: string
  path?: string
  title?: string
  template_path?: string | null
  slot_path?: string | null
  mime_type?: string
  extension?: string
}

/**
 * Read all local document files from the specified directory
 */
async function readLocalFiles(dir: string = '.'): Promise<LocalFiles> {
  const files = await readdir(dir)
  const result: LocalFiles = {}

  // Find content file (content.* or index.html)
  const contentFiles = files.filter(f => f.startsWith('content.'))
  const hasIndexHtml = files.includes('index.html')
  const totalContentFiles = contentFiles.length + (hasIndexHtml ? 1 : 0)

  if (totalContentFiles > 1) {
    const foundFiles = [...contentFiles, ...(hasIndexHtml ? ['index.html'] : [])]
    throw new Error(
      `Multiple content files found: ${foundFiles.join(', ')}. Only one content file (content.* or index.html) is allowed per directory.`,
    )
  }

  if (contentFiles.length === 1) {
    result.content = await readFile(join(dir, contentFiles[0]), 'utf-8')
  } else if (hasIndexHtml) {
    result.content = await readFile(join(dir, 'index.html'), 'utf-8')
  }

  // Find data file (data.*)
  const dataFiles = files.filter(f => f.startsWith('data.'))
  if (dataFiles.length === 1) {
    result.data = await readFile(join(dir, dataFiles[0]), 'utf-8')
  }

  // Read optional files
  try {
    result.style = await readFile(join(dir, 'style.css'), 'utf-8')
  } catch {}

  try {
    result.script = await readFile(join(dir, 'script.js'), 'utf-8')
  } catch {}

  try {
    result.server = await readFile(join(dir, 'server.js'), 'utf-8')
  } catch {}

  // Read settings.json
  try {
    const settingsContent = await readFile(join(dir, 'settings.json'), 'utf-8')
    const settings = JSON.parse(settingsContent)
    result.path = settings.path
    result.title = settings.title
    result.template_path = settings.template_path
    result.slot_path = settings.slot_path
    result.mime_type = settings.mime_type
    result.extension = settings.extension
  } catch {}

  return result
}

/**
 * Determine content type based on file extension
 */
function getContentType(filename: string): string {
  const ext = extname(filename).toLowerCase()
  const typeMap: Record<string, string> = {
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.eta': 'text/html', // ETA templates render to HTML
    '.txt': 'text/plain',
  }
  return typeMap[ext] || 'text/plain'
}

/**
 * Determine data type based on file extension
 */
function getDataType(filename: string): string | null {
  const ext = extname(filename).toLowerCase()
  const typeMap: Record<string, string> = {
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.json': 'json',
    '.toml': 'toml',
  }
  return typeMap[ext] || null
}

/**
 * Check if content has ETA templates
 */
function hasEtaTemplates(content: string): boolean {
  // Strip <%raw%>...<%endraw%> blocks — these are escape directives,
  // not actual eta template usage.
  const stripped = content.replace(/<%\s*raw\s*%>[\s\S]*?<%\s*endraw\s*%>/g, '')
  return /<%[\s\S]*?%>/.test(stripped)
}

/**
 * Options for assembleDocument
 */
interface AssembleOptions {
  /** Whether this is a nested template/slot (prevents recursive template/slot loading) */
  isNested?: boolean
  /** Optional resolver to find template/slot by path from a document graph */
  resolveDocumentPath?: (path: string) => Promise<string | null>
}

/**
 * Assemble a RenderDocument from local files in the specified directory
 * This creates an in-memory representation of the document without touching the database
 *
 * @param dir - Directory path to read files from (defaults to current working directory)
 * @param options - Assembly options including isNested flag and optional path resolver
 * @returns RenderDocument assembled from local files
 * @throws Error if required files are missing
 */
export async function assemble(
  dir: string = process.cwd(),
  optionsOrIsNested: boolean | AssembleOptions = false,
): Promise<RenderDocument> {
  // Handle legacy boolean parameter
  const options: AssembleOptions =
    typeof optionsOrIsNested === 'boolean' ? {isNested: optionsOrIsNested} : optionsOrIsNested
  const {isNested = false, resolveDocumentPath} = options

  const files = await readLocalFiles(dir)

  // Validate required files
  if (files.content === undefined) {
    throw new Error('No content file found (e.g., content.md)')
  }

  // Default to root path if not specified (for local serve)
  const documentPath = files.path || '/'

  // Find content file for metadata
  const allFiles = await readdir(dir)
  const contentFile =
    allFiles.find(f => f.startsWith('content.')) || (allFiles.includes('index.html') ? 'index.html' : undefined)
  const dataFile = allFiles.find(f => f.startsWith('data.'))

  if (!contentFile) {
    throw new Error('Content file not found')
  }

  const content = files.content
  const contentTypeValue = getContentType(contentFile)
  const dataTypeValue = dataFile ? getDataType(dataFile) : null
  const hasEta = hasEtaTemplates(content)
  const mimeType = files.mime_type || 'text/html; charset=UTF-8'

  // Normalize extension: .md, .html, and .eta all become .html since they render to HTML
  // Settings extension takes priority when explicitly set
  const actualExtension = extname(contentFile).toLowerCase()
  const derivedExtension = ['.md', '.html', '.eta'].includes(actualExtension) ? '.html' : actualExtension
  const extension = files.extension || derivedExtension

  // Create a minimal RenderDocument structure
  const now = new Date()
  const document: RenderDocument = {
    // Core document fields
    id: 0 as DocumentId, // Placeholder ID for in-memory document
    path: documentPath,
    published: false,
    redirect: false,

    // Document instance fields
    title: files.title || 'Untitled',
    content: content,
    data: files.data || '',
    style: files.style || '',
    script: files.script || '',
    server: files.server || '',
    template_id: null,
    slot_id: null,
    content_type: contentTypeValue,
    data_type: dataTypeValue,
    has_eta: hasEta,
    mime_type: mimeType,
    extension: extension,
    created_at: now,
    updated_at: now,

    // Render document specific fields
    draft: true, // Local files are considered drafts
    redirects: [],
    uploads: [],
  }

  // Only load template/slot for top-level documents, not for nested templates/slots
  if (!isNested) {
    // Assemble slot if slot_path is present in settings
    if (files.slot_path) {
      let slotDoc: RenderDocument | null = null

      // First try local slot/ directory
      try {
        const slotDir = join(dir, 'slot')
        slotDoc = await assemble(slotDir, {isNested: true})

        // Validate slot path matches
        if (slotDoc.path !== files.slot_path) {
          throw new Error(
            `Slot path mismatch: settings.json specifies "${files.slot_path}" but slot/settings.json has "${slotDoc.path}"`,
          )
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
        // Local slot/ directory not found, try resolver
        if (resolveDocumentPath) {
          const resolvedPath = await resolveDocumentPath(files.slot_path)
          if (resolvedPath) {
            slotDoc = await assemble(resolvedPath, {isNested: true})
          }
        }
      }

      if (slotDoc) {
        document.slot = slotDoc
      } else if (!resolveDocumentPath) {
        // Only throw if there's no resolver (legacy single-document mode)
        throw new Error(
          `Slot directory not found: settings.json references slot_path "${files.slot_path}" but no slot/ directory exists`,
        )
      }
    }

    // Assemble template if template_path is present in settings
    if (files.template_path) {
      let templateDoc: RenderDocument | null = null

      // First try local template/ directory
      try {
        const templateDir = join(dir, 'template')
        templateDoc = await assemble(templateDir, {isNested: true})

        // Validate template path matches
        if (templateDoc.path !== files.template_path) {
          throw new Error(
            `Template path mismatch: settings.json specifies "${files.template_path}" but template/settings.json has "${templateDoc.path}"`,
          )
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
        // Local template/ directory not found, try resolver
        if (resolveDocumentPath) {
          const resolvedPath = await resolveDocumentPath(files.template_path)
          if (resolvedPath) {
            templateDoc = await assemble(resolvedPath, {isNested: true})
          }
        }
      }

      if (templateDoc) {
        document.template = templateDoc
      } else if (!resolveDocumentPath) {
        // Only throw if there's no resolver (legacy single-document mode)
        throw new Error(
          `Template directory not found: settings.json references template_path "${files.template_path}" but no template/ directory exists`,
        )
      }
    }
  }

  return document
}
