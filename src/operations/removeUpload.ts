import type {DocumentQuery, DbOperation} from './types.ts'
import {getUpload} from './getUpload.ts'
import {promises as fs} from 'fs'
import path from 'path'

/**
 * Remove an upload from a document
 * Deletes the file from disk and removes the database record
 *
 * @param client Database client
 * @param query Document query (supports path string, id number, OptimisticDocument, Route, etc.)
 * @param uploadsPath Path to the uploads directory
 * @param originalFilename The original filename of the upload to remove
 * @returns Object with filename and original_filename if successful
 * @throws Error if filename is invalid, upload not found, or deletion fails
 */
export const removeUpload: DbOperation<
  [DocumentQuery, string, string],
  {filename: string; original_filename: string}
> = async (client, query, uploadsPath, originalFilename) => {
  // Validate filename
  if (!originalFilename || typeof originalFilename !== 'string') {
    throw new Error('Invalid filename')
  }

  // First, get the upload to retrieve its info (including the stored filename)
  // Include hidden uploads so we can delete them too
  const upload = await getUpload(client, query, originalFilename, {includeHidden: true})

  if (!upload) {
    throw new Error('Upload not found')
  }

  // Delete the upload from database
  const result = await client.query(
    `DELETE FROM uploads
     WHERE id = $1`,
    [upload.id],
  )

  if (result.rowCount === null || result.rowCount === 0) {
    throw new Error('Failed to delete upload from database')
  }

  // Delete file from disk
  const filePath = path.join(uploadsPath, upload.filename)
  try {
    await fs.unlink(filePath)
  } catch (error) {
    // Log but don't throw if file doesn't exist
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Error deleting upload file:', error)
      throw error
    }
  }

  return {
    filename: upload.filename,
    original_filename: upload.original_filename,
  }
}
