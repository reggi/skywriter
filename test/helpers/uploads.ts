import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {PoolClient} from 'pg'
import type {DocumentQuery, Upload} from '../../src/operations/types.ts'
import {addUpload as dbAddUpload} from '../../src/operations/addUpload.ts'

let uploadsPath: string | null = null

/**
 * Get a shared temporary uploads directory for tests.
 * Creates the directory on first call.
 */
export async function getTestUploadsPath(): Promise<string> {
  if (!uploadsPath) {
    uploadsPath = await mkdtemp(join(tmpdir(), 'skywriter-test-uploads-'))
  }
  return uploadsPath
}

/**
 * Clean up the shared temporary uploads directory.
 * Should be called in an after() hook.
 */
export async function cleanupTestUploads(): Promise<void> {
  if (uploadsPath) {
    await rm(uploadsPath, {recursive: true, force: true})
    uploadsPath = null
  }
}

/**
 * Helper to create an upload for testing purposes.
 * Uses a simple Buffer input with the new consolidated addUpload function.
 */
export async function createTestUpload(
  client: PoolClient,
  query: DocumentQuery,
  options: {
    filename?: string
    original_filename?: string
    content?: string
  } = {},
): Promise<Upload & {filePath: string}> {
  const path = await getTestUploadsPath()
  const filename = options.filename || options.original_filename || 'test-file.jpg'
  const content = options.content || 'test content'

  return dbAddUpload(client, query, path, {
    data: Buffer.from(content),
    filename,
  })
}
