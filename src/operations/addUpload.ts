import type {Upload, DocumentQuery, DbOperation} from './types.ts'
import {normalizeDocumentQuery} from './utils/common.ts'
import {findDocument} from './findDocument.ts'
import {getAllUploadsForDocument} from './getAllUploadsForDocument.ts'
import {generateUniqueFilename} from './utils/generateUniqueFilename.ts'
import {stripImageExif} from '../utils/stripImageExif.ts'
import {promises as fs} from 'fs'
import path from 'path'
import {randomBytes, createHash} from 'crypto'

/**
 * Input for file upload - can be either a File from FormData or a Buffer with filename
 */
type UploadInput = File | {data: Buffer; filename: string}

/**
 * Adds an upload to a document, handling both database and file system operations.
 *
 * This function:
 * 1. Generates a unique storage filename with timestamp and random bytes
 * 2. If filename collides with existing upload, marks that upload as hidden and renames it
 * 3. Creates the upload record in the database (with transaction)
 * 4. Writes the file to disk
 *
 * @param client Database client
 * @param query Document query (supports path string, id number, OptimisticDocument, Route, etc.)
 * @param uploadsPath Path to the uploads directory
 * @param input Either a File object from FormData or {data: Buffer, filename: string}
 * @returns The Upload object with additional filePath property
 * @throws Error if document doesn't exist or if there's a constraint violation
 */
export const addUpload: DbOperation<[DocumentQuery, string, UploadInput], Upload & {filePath: string}> = async (
  client,
  query,
  uploadsPath,
  input,
) => {
  const normalizedQuery = normalizeDocumentQuery(query)

  // Extract filename and data based on input type
  const isFile = input instanceof File
  const originalName = isFile ? input.name : input.filename

  // Generate unique storage filename to avoid collisions
  const ext = path.extname(originalName)
  const timestamp = Date.now()
  const random = randomBytes(4).toString('hex')
  const storageFilename = `${timestamp}-${random}${ext}`

  try {
    await client.query('BEGIN')

    // Verify document exists
    const document = await findDocument(client, normalizedQuery)

    if (!document) {
      throw new Error('Document does not exist')
    }

    const documentId = document.id

    // Get ALL existing uploads (including hidden) to check for filename collisions
    const allUploads = await getAllUploadsForDocument(client, documentId)
    const existingFilenames = allUploads.map(u => u.original_filename)

    // Check if there's a visible upload with this filename that needs to be displaced
    const existingVisibleUpload = allUploads.find(u => u.original_filename === originalName && !u.hidden)

    if (existingVisibleUpload) {
      // Generate a new unique filename for the displaced upload
      const displacedFilename = generateUniqueFilename(originalName, existingFilenames)

      // Mark the existing upload as hidden and rename it
      await client.query(`UPDATE uploads SET original_filename = $1, hidden = true WHERE id = $2`, [
        displacedFilename,
        existingVisibleUpload.id,
      ])
    }

    // Get file buffer before INSERT so we can compute the hash
    let fileBuffer: Buffer
    if (isFile) {
      const arrayBuffer = await input.arrayBuffer()
      fileBuffer = Buffer.from(arrayBuffer)
    } else {
      fileBuffer = input.data
    }

    // Strip EXIF data from images to remove PII
    fileBuffer = stripImageExif(fileBuffer, originalName)

    const fileHash = `sha256:${createHash('sha256').update(fileBuffer).digest('hex')}`

    // Insert new upload with the original filename (visible by default)
    const result = await client.query<Upload>(
      `INSERT INTO uploads (filename, document_id, original_filename, hidden, hash)
       VALUES ($1, $2, $3, false, $4)
       RETURNING id, filename, document_id, created_at, original_filename, hidden, hash`,
      [storageFilename, documentId, originalName, fileHash],
    )

    await client.query('COMMIT')

    const upload = result.rows[0]

    // Ensure uploads directory exists
    await fs.mkdir(uploadsPath, {recursive: true})

    // Write file to disk only after database succeeds
    const filePath = path.join(uploadsPath, storageFilename)

    await fs.writeFile(filePath, fileBuffer)

    return {
      ...upload,
      filePath,
    }
  } catch (error) {
    await client.query('ROLLBACK')

    // Check for unique constraint violation
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      if (error.message.includes('uploads_original_filename_document_id')) {
        throw new Error(`File "${originalName}" already exists for this document`)
      }
    }

    throw error
  }
}
