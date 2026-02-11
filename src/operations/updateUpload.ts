import type {Upload, DbOperation, UploadId, DocumentId} from './types.ts'
import {getAllUploadsForDocument} from './getAllUploadsForDocument.ts'
import {generateUniqueFilename} from './utils/generateUniqueFilename.ts'

/**
 * Input for updating an upload
 */
interface UpdateUploadInput {
  /** New filename for the upload */
  original_filename?: string
  /** Whether the upload is hidden */
  hidden?: boolean
}

/**
 * Updates an upload's original_filename and/or hidden status.
 *
 * When renaming or unhiding causes a filename collision with an existing visible upload:
 * - The existing visible upload gets renamed with an incremented suffix
 * - The existing visible upload is marked as hidden
 * - The target upload takes the desired filename and visibility
 *
 * @param client Database client
 * @param uploadId The ID of the upload to update
 * @param input The fields to update (original_filename and/or hidden)
 * @returns The updated Upload object
 * @throws Error if upload doesn't exist
 */
export const updateUpload: DbOperation<[UploadId, UpdateUploadInput], Upload> = async (client, uploadId, input) => {
  const {original_filename: newFilename, hidden: newHidden} = input

  // Nothing to update
  if (newFilename === undefined && newHidden === undefined) {
    const result = await client.query<Upload>(
      `SELECT id, filename, document_id, created_at, original_filename, hidden
       FROM uploads WHERE id = $1`,
      [uploadId],
    )
    if (result.rows.length === 0) {
      throw new Error('Upload does not exist')
    }
    return result.rows[0]
  }

  try {
    await client.query('BEGIN')

    // Get the current upload
    const currentResult = await client.query<Upload>(
      `SELECT id, filename, document_id, created_at, original_filename, hidden
       FROM uploads WHERE id = $1 FOR UPDATE`,
      [uploadId],
    )

    if (currentResult.rows.length === 0) {
      throw new Error('Upload does not exist')
    }

    const currentUpload = currentResult.rows[0]
    const documentId = currentUpload.document_id as DocumentId

    // Determine the target state
    const targetFilename = newFilename ?? currentUpload.original_filename
    const targetHidden = newHidden ?? currentUpload.hidden

    // Check if we need to handle a collision
    // A collision occurs when:
    // 1. The target filename is different from current OR we're unhiding
    // 2. The target will be visible (not hidden)
    // 3. There's already a visible upload with that filename (other than this one)
    const willBeVisible = !targetHidden
    const filenameChanging = targetFilename !== currentUpload.original_filename
    const visibilityChanging = targetHidden !== currentUpload.hidden

    if (willBeVisible && (filenameChanging || visibilityChanging)) {
      // Get all uploads for collision checking
      const allUploads = await getAllUploadsForDocument(client, documentId)
      const existingFilenames = allUploads.map(u => u.original_filename)

      // Find any existing visible upload with the target filename (excluding this upload)
      const collidingUpload = allUploads.find(
        u => u.original_filename === targetFilename && !u.hidden && u.id !== uploadId,
      )

      if (collidingUpload) {
        // Generate a new unique filename for the displaced upload
        const displacedFilename = generateUniqueFilename(targetFilename, existingFilenames)

        // Mark the colliding upload as hidden and rename it
        await client.query(`UPDATE uploads SET original_filename = $1, hidden = true WHERE id = $2`, [
          displacedFilename,
          collidingUpload.id,
        ])
      }
    }

    // Update the target upload
    const updateResult = await client.query<Upload>(
      `UPDATE uploads 
       SET original_filename = $1, hidden = $2
       WHERE id = $3
       RETURNING id, filename, document_id, created_at, original_filename, hidden`,
      [targetFilename, targetHidden, uploadId],
    )

    await client.query('COMMIT')

    return updateResult.rows[0]
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
