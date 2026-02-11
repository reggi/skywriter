import type {DocumentQuery, EditDocumentInput, DbOperation} from './types.ts'
import {upsert} from './upsert.ts'
import {findDocument} from './findDocument.ts'
import {extract as tarExtract} from 'tar-stream'
import {createGunzip} from 'zlib'
import {Readable} from 'stream'

// Allowed file patterns
const ALLOWED_FILES = ['settings.json', /^content\./, 'index.html', /^data\./, 'server.js', 'style.css', 'script.js']

// Size limits for archive processing
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB per file
const MAX_ARCHIVE_FILES = ALLOWED_FILES.length // Maximum number of files (excluding directories)
const MAX_TOTAL_SIZE = MAX_FILE_SIZE * MAX_ARCHIVE_FILES // Total archive size limit

interface ArchiveFiles {
  settings?: string
  content?: string
  data?: string
  server?: string
  style?: string
  script?: string
}

/**
 * Update a document from a tar.gz archive
 * Validates that the archive contains the expected files and no unexpected files
 *
 * Expected files:
 * - settings.json (base document, required)
 * - content.* (any extension, optional, but only one file) OR index.html (optional, mutually exclusive with content.*)
 * - data.* (any extension, optional, but only one file)
 * - server.js (optional)
 * - style.css (optional)
 * - script.js (optional)
 *
 * Size limits:
 * - Max 10 MB per file
 * - Max 50 MB total archive
 * - Max 10 files (excluding directories)
 *
 * @throws Error if archive contains multiple content/data files, both index.html and content.* files, unrecognized files, or exceeds size limits
 */
export const updateViaArchive: DbOperation<[DocumentQuery, Readable], void> = async (client, query, stream) => {
  // Create streams for decompression and extraction
  const gunzip = createGunzip()
  const extract = tarExtract()

  // Track total bytes received for size validation
  let totalBytesReceived = 0
  const MAX_BYTES_TO_TRACK = MAX_TOTAL_SIZE + 1 // Track one byte over limit to detect overflow

  const archiveFiles: ArchiveFiles = {}
  const contentFiles: string[] = []
  const dataFiles: string[] = []
  const unrecognizedFiles: string[] = []
  let fileCount = 0
  let validationError: Error | null = null

  // Helper to check if a filename matches allowed patterns
  const isAllowedFile = (fileName: string): boolean => {
    return ALLOWED_FILES.some(pattern => {
      if (typeof pattern === 'string') {
        return fileName === pattern
      }
      return pattern.test(fileName)
    })
  }

  // Track total archive size as it streams through
  gunzip.on('data', (chunk: Buffer) => {
    if (totalBytesReceived <= MAX_BYTES_TO_TRACK) {
      totalBytesReceived += chunk.length
    }
  })

  // Set up tar extraction handlers
  extract.on('entry', (header, stream, next) => {
    const fileName = header.name
    const fileSize = header.size || 0

    // Skip directories
    if (header.type === 'directory') {
      stream.resume()
      next()
      return
    }

    // Increment file count
    fileCount++

    // Check file count limit
    if (fileCount > MAX_ARCHIVE_FILES) {
      validationError = validationError || new Error(`Archive contains too many files (max ${MAX_ARCHIVE_FILES})`)
      stream.resume() // Drain the stream
      next()
      return
    }

    // Check individual file size
    if (fileSize > MAX_FILE_SIZE) {
      validationError =
        validationError ||
        new Error(`File '${fileName}' size (${fileSize} bytes) exceeds maximum allowed size (${MAX_FILE_SIZE} bytes)`)
      stream.resume() // Drain the stream
      next()
      return
    }

    // Check if file is allowed
    if (!isAllowedFile(fileName)) {
      unrecognizedFiles.push(fileName)
      stream.resume()
      next()
      return
    }

    // Collect file contents
    const chunks: Buffer[] = []

    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    stream.on('end', () => {
      const content = Buffer.concat(chunks).toString('utf-8')

      // Identify file types
      if (fileName === 'settings.json') {
        archiveFiles.settings = content
      } else if (fileName === 'index.html' || fileName.startsWith('content.')) {
        contentFiles.push(fileName)
        archiveFiles.content = content
      } else if (fileName.startsWith('data.')) {
        dataFiles.push(fileName)
        archiveFiles.data = content
      } else if (fileName === 'server.js') {
        archiveFiles.server = content
      } else if (fileName === 'style.css') {
        archiveFiles.style = content
      } else if (fileName === 'script.js') {
        archiveFiles.script = content
      }

      next()
    })

    stream.resume()
  })

  // Process the archive
  await new Promise<void>((resolve, reject) => {
    extract.on('finish', () => {
      // Check if archive exceeded size limit
      if (totalBytesReceived > MAX_TOTAL_SIZE) {
        reject(new Error(`Archive size exceeds maximum allowed size (${MAX_TOTAL_SIZE} bytes)`))
        return
      }

      if (validationError) {
        reject(validationError)
      } else {
        resolve()
      }
    })

    extract.on('error', reject)
    gunzip.on('error', reject)

    stream.pipe(gunzip).pipe(extract)
  })

  // Validation
  if (!archiveFiles.settings) {
    throw new Error('Archive must contain settings.json')
  }

  if (contentFiles.length > 1) {
    throw new Error(
      `Archive contains multiple content files: ${contentFiles.join(', ')}. Only one content file is allowed (either index.html or a content.* file).`,
    )
  }

  // Additional validation: if index.html exists, ensure no content.* files exist
  const hasIndexHtml = contentFiles.includes('index.html')
  const hasContentFiles = contentFiles.some(f => f.startsWith('content.'))
  if (hasIndexHtml && hasContentFiles) {
    throw new Error('Archive cannot contain both index.html and content.* files. Use only one format.')
  }

  if (dataFiles.length > 1) {
    throw new Error(`Archive contains multiple data files: ${dataFiles.join(', ')}`)
  }

  if (unrecognizedFiles.length > 0) {
    const allowedList = [
      'settings.json',
      'content.* (any extension)',
      'index.html',
      'data.* (any extension)',
      'server.js',
      'style.css',
      'script.js',
    ]
    throw new Error(
      `Archive contains unrecognized files: ${unrecognizedFiles.join(', ')}\n` +
        `Allowed files: ${allowedList.join(', ')}`,
    )
  }

  // Parse settings.json
  let settings: EditDocumentInput & {slot_path?: string | null; template_path?: string | null}
  try {
    settings = JSON.parse(archiveFiles.settings)
  } catch (error) {
    /* c8 ignore next */ // JSON.parse always throws Error objects, 'Unknown error' branch is unreachable
    throw new Error('Failed to parse settings.json: ' + (error instanceof Error ? error.message : 'Unknown error'))
  }

  // Resolve slot_path to slot_id if provided
  if (settings.slot_path && !settings.slot_id) {
    const slotDoc = await findDocument(client, {path: settings.slot_path})
    if (slotDoc) {
      settings.slot_id = slotDoc.id
    }
    // Remove the path field as it's not part of EditDocumentInput
    delete settings.slot_path
  }

  // Resolve template_path to template_id if provided
  if (settings.template_path && !settings.template_id) {
    const templateDoc = await findDocument(client, {path: settings.template_path})
    if (templateDoc) {
      settings.template_id = templateDoc.id
    }
    // Remove the path field as it's not part of EditDocumentInput
    delete settings.template_path
  }

  // Convert query to object form for merging
  const queryObj = typeof query === 'string' ? {path: query} : typeof query === 'number' ? {id: query} : query

  // Extract path from query object if it exists
  const queryPath =
    typeof query === 'string'
      ? query
      : typeof query === 'object' && query !== null && 'path' in query
        ? query.path
        : undefined

  const docPath = settings.path ?? queryPath

  if (!docPath) {
    throw new Error('Document path must be specified in either query or settings.json')
  }

  // Merge settings with file contents and query
  // Using the single-parameter form of upsert which combines query and input
  // Force published mode for archive uploads (not draft) - archive upload is a "publish" action
  const documentInput: EditDocumentInput & DocumentQuery = {
    path: docPath,
    ...settings,
    draft: false, // Override any draft setting - archive upload publishes directly
    published: true, // Ensure published is true
    content: archiveFiles.content ?? settings.content,
    data: archiveFiles.data ?? settings.data,
    server: archiveFiles.server ?? settings.server,
    style: archiveFiles.style ?? settings.style,
    script: archiveFiles.script ?? settings.script,
  }

  // Upsert the document using combined form
  await upsert(client, queryObj, documentInput)
}
