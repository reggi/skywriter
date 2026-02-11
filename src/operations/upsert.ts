import type {EditDocumentInput, DualDocument, Document, Route, DocumentQuery, DbOperation} from './types.ts'
import {normalizeDocumentQuery} from './utils/common.ts'
import {findDocument} from './findDocument.ts'
import {getDocumentRecord} from './getDocumentRecord.ts'
import {createRoute} from './createRoute.ts'
import {createDocumentRecord} from './createDocumentRecord.ts'
import {getDocumentInstance} from './getDocumentInstance.ts'

/**
 * Creates or edits a document
 *
 * Rules:
 * 1. Routes/paths are immutable (they can be deleted)
 * 2. When a path is updated for a document, make a new route and set the path_id to the new route
 * 3. When a draft is inserted for a document:
 *    - If there is no existing draft: copy over every undefined/null field from the current saved version
 *    - If there is an existing draft: update the fields for the draft
 * 4. When a draft is "saved" (published=true), it becomes the new current version and the old record is deleted
 *
 * Supports two call patterns:
 * - 3-param: upsert(client, query, input) - explicit query and input
 * - 2-param: upsert(client, inputWithQuery) - combined query and input in one object
 *
 * @param client Database client
 * @param queryOrInput Query to find the document, or combined query+input object
 * @param input Document data to update (optional if using combined object)
 * @returns Object with current (saved) and/or draft versions of the document
 */
export const upsert: DbOperation<
  [DocumentQuery | (EditDocumentInput & DocumentQuery), EditDocumentInput?],
  DualDocument
> = async (client, queryOrInput, input?) => {
  // Handle both call patterns: determine if this is the 2-param or 3-param version
  let query: DocumentQuery
  let data: EditDocumentInput

  if (input === undefined) {
    // 2-param version: queryOrInput contains both query and input
    query = queryOrInput as EditDocumentInput & DocumentQuery
    data = queryOrInput as EditDocumentInput & DocumentQuery
  } else {
    // 3-param version: separate query and input
    query = queryOrInput as DocumentQuery
    data = input
  }

  try {
    await client.query('BEGIN')
    // Defer constraint checking to allow circular references between documents and routes
    await client.query('SET CONSTRAINTS routes_document_id_fkey DEFERRED')

    // isPublishing means converting a draft to current (published: true with existing draft)
    // but only when there are actual content changes, not just metadata changes
    const isDraft = data.draft === true
    const isPublishing = data.published === true && !isDraft

    // Check if only metadata is being changed (no content fields)
    // This is used to preserve the draft when only toggling published status or changing path
    const hasContentFields =
      data.content !== undefined ||
      data.data !== undefined ||
      data.style !== undefined ||
      data.script !== undefined ||
      data.server !== undefined ||
      data.title !== undefined ||
      data.template_id !== undefined ||
      data.slot_id !== undefined ||
      data.mime_type !== undefined ||
      data.extension !== undefined
    const isMetadataOnlyChange = !hasContentFields && !isDraft

    // When only metadata is changing (like toggling published status), don't promote draft to current
    const shouldPublishDraft = isPublishing && hasContentFields

    // 1. Find existing document
    const normalizedQuery = normalizeDocumentQuery(query)
    const existingDoc = await findDocument(client, normalizedQuery)

    let document: Document
    let newRoute: Route | null = null
    let isRedirect = false

    if (!existingDoc) {
      // Create new document - path is required for new documents
      if (!data.path) {
        throw new Error('path is required when creating a new document')
      }

      // First create the record
      const record = await createDocumentRecord(client, data)

      // Create route with a placeholder document_id (will be updated)
      // This relies on the deferred constraint
      const tempRoute = await client.query<Route>(
        `INSERT INTO routes (path, document_id)
         VALUES ($1, 0)
         RETURNING *`,
        [data.path],
      )
      newRoute = tempRoute.rows[0]

      // Now create the document with the route
      // Use explicit published value if provided, otherwise default to !isDraft
      const publishedValue = data.published !== undefined ? data.published : !isDraft
      const docResult = await client.query<Document>(
        `INSERT INTO documents (path_id, published, ${isDraft ? 'draft_record_id' : 'current_record_id'})
         VALUES ($1, $2, $3)
         RETURNING *`,
        [newRoute.id, publishedValue, record.id],
      )
      document = docResult.rows[0]

      // Update the route with the correct document_id
      await client.query(`UPDATE routes SET document_id = $1 WHERE id = $2`, [document.id, newRoute.id])

      // Set the appropriate record ID in the document object
      if (isDraft) {
        document.draft_record_id = record.id
      } else {
        document.current_record_id = record.id
      }
    } else {
      document = existingDoc
      isRedirect = existingDoc.redirect || false

      // Check if path or published status changed
      const pathChanged = data.path && existingDoc.route.path !== data.path
      const publishedStatusChanged = data.published !== undefined && data.published !== document.published

      if (pathChanged) {
        // Path changed - create new route (Rule 2)
        newRoute = await createRoute(client, data.path!, document.id)
        document.path_id = newRoute.id
      }

      // Update document if path or published status changed
      if (pathChanged || publishedStatusChanged) {
        const updates: string[] = []
        const values: (number | boolean)[] = []
        let paramIndex = 1

        if (pathChanged) {
          updates.push(`path_id = $${paramIndex++}`)
          values.push(newRoute!.id)
        }

        if (publishedStatusChanged) {
          updates.push(`published = $${paramIndex++}`)
          values.push(data.published!)
          document.published = data.published!
        }

        updates.push(`updated_at = CURRENT_TIMESTAMP`)
        values.push(document.id)

        await client.query(`UPDATE documents SET ${updates.join(', ')} WHERE id = $${paramIndex}`, values)
      }

      // Get existing current (saved) record if it exists
      const publishedRecord = document.current_record_id
        ? await getDocumentRecord(client, document.current_record_id)
        : null

      if (shouldPublishDraft && document.draft_record_id) {
        // Rule 4: Publishing a draft - create a new record from draft data and any new input
        const oldPublishedId = document.current_record_id
        const draftRecord = await getDocumentRecord(client, document.draft_record_id)

        // Create new record merging draft with new input
        const newRecord = await createDocumentRecord(client, data, draftRecord)

        // Promote new record to current (saved) version and clear draft
        await client.query(
          `UPDATE documents 
           SET current_record_id = $1, draft_record_id = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [newRecord.id, document.id],
        )

        document.current_record_id = newRecord.id
        const oldDraftId = document.draft_record_id
        document.draft_record_id = null

        // Delete old records now that they're no longer referenced
        if (oldPublishedId) {
          await client.query(`DELETE FROM document_records WHERE id = $1`, [oldPublishedId])
        }
        if (oldDraftId) {
          await client.query(`DELETE FROM document_records WHERE id = $1`, [oldDraftId])
        }
      } else if (isDraft) {
        // Rule 3: Creating or updating a draft
        const oldDraftId = document.draft_record_id

        // Always create new draft record, copying undefined/null fields from current saved version
        const draftRecord = await createDocumentRecord(client, data, publishedRecord)

        // Check if the draft is identical to the current record
        let isDraftIdentical = false
        if (publishedRecord) {
          // Compare all relevant fields between draft and current record
          isDraftIdentical =
            draftRecord.title === publishedRecord.title &&
            draftRecord.content === publishedRecord.content &&
            draftRecord.data === publishedRecord.data &&
            draftRecord.style === publishedRecord.style &&
            draftRecord.script === publishedRecord.script &&
            draftRecord.server === publishedRecord.server &&
            draftRecord.template_id === publishedRecord.template_id &&
            draftRecord.slot_id === publishedRecord.slot_id &&
            draftRecord.content_type === publishedRecord.content_type &&
            draftRecord.data_type === publishedRecord.data_type &&
            draftRecord.has_eta === publishedRecord.has_eta &&
            draftRecord.mime_type === publishedRecord.mime_type &&
            draftRecord.extension === publishedRecord.extension
        }

        if (isDraftIdentical) {
          // Draft is identical to current - drop the draft
          // Delete the new draft record we just created
          await client.query(`DELETE FROM document_records WHERE id = $1`, [draftRecord.id])

          // Clear the draft reference if one existed
          if (oldDraftId) {
            await client.query(
              `UPDATE documents SET draft_record_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
              [document.id],
            )
            // Delete old draft record
            await client.query(`DELETE FROM document_records WHERE id = $1`, [oldDraftId])
            document.draft_record_id = null
          }
          // If there was no old draft, document.draft_record_id is already null, so no update needed
        } else {
          // Draft is different - keep it
          await client.query(
            `UPDATE documents SET draft_record_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [draftRecord.id, document.id],
          )
          document.draft_record_id = draftRecord.id

          // Delete old draft if it existed
          if (oldDraftId) {
            await client.query(`DELETE FROM document_records WHERE id = $1`, [oldDraftId])
          }
        }
      } else if (isMetadataOnlyChange) {
        // Only metadata changed (e.g., published status or path) - preserve existing draft
        // No need to create new records or modify draft_record_id
        // The path and published updates were already handled above
      } else {
        // Update published record directly - create new record and swap
        const oldPublishedId = document.current_record_id
        const oldDraftId = document.draft_record_id

        // Create new published record
        const record = await createDocumentRecord(client, data, publishedRecord)

        await client.query(
          `UPDATE documents SET current_record_id = $1, draft_record_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [record.id, document.id],
        )
        document.current_record_id = record.id
        document.draft_record_id = null

        // Delete old published record if it existed
        if (oldPublishedId) {
          await client.query(`DELETE FROM document_records WHERE id = $1`, [oldPublishedId])
        }
        // Delete draft record if it existed
        if (oldDraftId) {
          await client.query(`DELETE FROM document_records WHERE id = $1`, [oldDraftId])
        }
      }
    }

    // Fetch the canonical path for the document
    const pathResult = await client.query<{path: string}>(`SELECT path FROM routes WHERE id = $1`, [document.path_id])
    const canonicalPath = pathResult.rows[0].path

    // Fetch the complete document with published and draft records separately
    const result: DualDocument = {
      id: document.id,
      path: canonicalPath,
      redirect: isRedirect,
      published: document.published,
    }

    // Fetch published record if it exists
    if (document.current_record_id) {
      const currentInstance = await getDocumentInstance(client, document.id, 'current')
      if (currentInstance) {
        result.current = currentInstance
      }
    }

    // Fetch draft record if it exists
    if (document.draft_record_id) {
      const draftInstance = await getDocumentInstance(client, document.id, 'draft')
      if (draftInstance) {
        result.draft = draftInstance
      }
    }

    await client.query('COMMIT')

    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
