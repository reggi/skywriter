import type {DocumentId, DbOperation} from './types.ts'
import type {EditDocumentInput, DocumentQuery, DualDocument} from './types.ts'
import type {DocumentClientState} from '../utils/types.ts'
import type {SavedUpload} from './types.ts'
import {clearDraft} from './clearDraft.ts'
import {upsert} from './upsert.ts'
import {getDualDocument} from './getDualDocument.ts'
import {getRenderDocument} from './getRenderDocument.ts'
import {render} from '../render/index.ts'
import {stringifyData} from '../utils/stringifyData.ts'
import {getContent, getTabFilenames} from '../responder/index.ts'
import {functionContext} from '../utils/functionContext.ts'
import {addUploadsFromContent} from './addUploadsFromContent.ts'

/**
 * Options for getDocumentClientState
 */
interface GetDocumentClientStateOptions {
  /** Path to uploads directory. If provided, foreign images will be downloaded and saved. */
  uploadsPath?: string
  /** Whether to add uploads from content (download foreign images). Default: true when uploadsPath is provided */
  addUploadsFromContent?: boolean
}

/**
 * Validates and parses document body into EditDocumentInput
 * @param body - The request body to validate
 * @returns EditDocumentInput object if body is provided, undefined otherwise
 * @throws Error if validation fails
 */
function validateDocumentBody(body?: unknown): EditDocumentInput | undefined {
  if (!body) {
    return undefined
  }

  if (typeof body !== 'object') {
    throw new Error('Document must be an object')
  }

  const {
    path,
    published,
    content,
    data,
    style,
    script,
    server,
    title,
    template_id,
    slot_id,
    mime_type,
    extension,
    draft,
    ...rest
  } = body as Record<string, unknown>

  // Check for unexpected fields
  const unexpectedFields = Object.keys(rest)
  if (unexpectedFields.length > 0) {
    throw new Error(`Unexpected fields: ${unexpectedFields.join(', ')}`)
  }

  if (path !== undefined && typeof path !== 'string') {
    throw new Error('Cannot specify path in document body')
  }
  if (published !== undefined && typeof published !== 'boolean') {
    throw new Error('Cannot specify published in document body')
  }
  // Validate field types
  if (content !== undefined && typeof content !== 'string') {
    throw new Error('content must be a string')
  }
  if (data !== undefined && typeof data !== 'string') {
    throw new Error('data must be a string')
  }
  if (style !== undefined && typeof style !== 'string') {
    throw new Error('style must be a string')
  }
  if (script !== undefined && typeof script !== 'string') {
    throw new Error('script must be a string')
  }
  if (server !== undefined && typeof server !== 'string') {
    throw new Error('server must be a string')
  }
  if (title !== undefined && typeof title !== 'string') {
    throw new Error('title must be a string')
  }
  if (template_id !== undefined && template_id !== null && typeof template_id !== 'number') {
    throw new Error('template_id must be a number or null')
  }
  if (slot_id !== undefined && slot_id !== null && typeof slot_id !== 'number') {
    throw new Error('slot_id must be a number or null')
  }
  if (mime_type !== undefined && typeof mime_type !== 'string') {
    throw new Error('mime_type must be a string')
  }
  if (extension !== undefined && typeof extension !== 'string') {
    throw new Error('extension must be a string')
  }
  if (extension !== undefined && typeof extension === 'string') {
    if (!extension.startsWith('.')) {
      throw new Error('extension must start with a dot (.)')
    }
    if (extension.includes('/') || extension.includes('\\')) {
      throw new Error('extension cannot contain slashes')
    }
    // POSIX compliant: only alphanumeric, dots, hyphens, and underscores after the initial dot
    if (!/^\.[a-zA-Z0-9._-]+$/.test(extension)) {
      throw new Error('extension must be POSIX compliant (alphanumeric, dots, hyphens, underscores only)')
    }
  }
  if (draft !== undefined && typeof draft !== 'boolean') {
    throw new Error('draft must be a boolean')
  }

  const document: EditDocumentInput = {}
  if (typeof path === 'string') document.path = path
  if (typeof published === 'boolean') document.published = published
  if (typeof content === 'string') document.content = content
  if (typeof data === 'string') document.data = data
  if (typeof style === 'string') document.style = style
  if (typeof script === 'string') document.script = script
  if (typeof server === 'string') document.server = server
  if (typeof title === 'string') document.title = title
  if (template_id !== undefined) document.template_id = template_id === null ? null : (template_id as DocumentId)
  if (slot_id !== undefined) document.slot_id = slot_id === null ? null : (slot_id as DocumentId)
  if (typeof mime_type === 'string') document.mime_type = mime_type
  if (typeof extension === 'string') document.extension = extension
  if (typeof draft === 'boolean') document.draft = draft

  return document
}

/**
 * Preview raw content with optional slot and template
 * Used by the editor to preview changes before saving
 *
 * When options.uploadsPath is provided and document.content contains foreign images,
 * those images will be downloaded, saved as uploads, and the content will be updated
 * with local upload URLs. This provides:
 * 1. Security - prevents malicious image URL swapping after save
 * 2. Link rot prevention - images are preserved even if source goes offline
 */
export const getDocumentClientState: DbOperation<
  [DocumentQuery, unknown?, Record<string, string>?, GetDocumentClientStateOptions?],
  DocumentClientState | null
> = async (client, query, body, requestQuery, options) => {
  // Validate and parse the document body
  const document = validateDocumentBody(body)

  let dualDocument: DualDocument | null

  // Process foreign images in content before upserting
  let processedDocument = document
  let foreignImageUploads: SavedUpload[] = []

  // Check if this is a revert request (draft: false with no other content changes)
  // This should clear the draft and return the current published version
  const isRevertRequest =
    document?.draft === false &&
    document.content === undefined &&
    document.data === undefined &&
    document.style === undefined &&
    document.script === undefined &&
    document.server === undefined &&
    document.title === undefined &&
    document.template_id === undefined &&
    document.slot_id === undefined &&
    document.mime_type === undefined &&
    document.extension === undefined &&
    document.published === undefined &&
    document.path === undefined

  if (isRevertRequest) {
    // Clear the draft and return the document with only the current version
    dualDocument = await clearDraft(client, query)
  } else {
    // Only process if content is provided and foreign image processing is enabled
    const shouldAddUploadsFromContent =
      document?.content && options?.uploadsPath && options?.addUploadsFromContent !== false

    if (shouldAddUploadsFromContent) {
      // First, do a preliminary upsert to ensure the document exists (needed for adding uploads)
      // We exclude content here to avoid saving unprocessed content with foreign URLs
      const preliminaryDoc = await upsert(client, query, {...document, content: undefined})
      if (preliminaryDoc) {
        try {
          const result = await addUploadsFromContent(
            client,
            {id: preliminaryDoc.current?.id || preliminaryDoc.draft?.id},
            options!.uploadsPath!,
            document!.content!,
          )

          if (result.uploads.length > 0) {
            // Update document with processed content
            processedDocument = {...document, content: result.content}
            foreignImageUploads = result.uploads
            console.log(`Processed ${result.uploads.length} foreign image(s) in content`)
          }
        } catch (error) {
          console.error('Failed to process foreign images:', error)
          // Continue with original content if processing fails
        }
      }
    }

    if (processedDocument) {
      dualDocument = await upsert(client, query, processedDocument)
    } else {
      dualDocument = await getDualDocument(client, query, {draft: true})
    }
  }

  if (!dualDocument) {
    // Return null for non-existent documents
    return null
  }

  const renderDocument = await getRenderDocument(
    client,
    {dualDocument},
    {
      includeRedirects: true,
      includeUploads: true,
      includeHiddenUploads: true,
      includeSlot: true,
      includeTemplate: true,
      draft: true,
    },
  )

  if (!renderDocument) {
    throw new Error('RenderDocument not found for preview')
  }

  const _render = await render(renderDocument, {
    fn: functionContext(client, renderDocument, requestQuery),
    query: requestQuery,
  })

  // Transform data field based on data_type
  const transformedData = stringifyData(renderDocument.data, renderDocument.data_type, true)

  // Create transformed render document for client
  const clientRenderDocument = {
    ...renderDocument,
    data: transformedData,
  }

  // Fetch API links
  let api: string[] = []
  try {
    const apiContent = await getContent(renderDocument, '/api.json')
    if (Array.isArray(apiContent)) {
      api = apiContent as string[]
    }
  } catch (error) {
    console.error('Failed to fetch API links:', error)
  }

  return {
    document: clientRenderDocument,
    render: {html: _render.html},
    api,
    tabs: {
      content: {
        hasDraft: !!(!dualDocument.draft?.content
          ? false
          : dualDocument.draft?.content !== dualDocument.current?.content),
        isEmpty: !(renderDocument.content || '').trim(),
      },
      data: {
        hasDraft: !!(!dualDocument.draft?.data ? false : dualDocument.draft?.data !== dualDocument.current?.data),
        isEmpty: !(renderDocument.data || '').trim(),
      },
      style: {
        hasDraft: !!(!dualDocument.draft?.style ? false : dualDocument.draft?.style !== dualDocument.current?.style),
        isEmpty: !(renderDocument.style || '').trim(),
      },
      script: {
        hasDraft: !!(!dualDocument.draft?.script ? false : dualDocument.draft?.script !== dualDocument.current?.script),
        isEmpty: !(renderDocument.script || '').trim(),
      },
      server: {
        hasDraft: !!(!dualDocument.draft?.server ? false : dualDocument.draft?.server !== dualDocument.current?.server),
        isEmpty: !(renderDocument.server || '').trim(),
      },
    },
    tabFilenames: getTabFilenames(renderDocument),
    // Flag to indicate content was modified by server (foreign images processed)
    contentModifiedByServer: foreignImageUploads.length > 0,
  }
}
