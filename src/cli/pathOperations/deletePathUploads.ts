import {formatWarning} from '../utils/formatPlan.ts'
import type {PathOperation} from '../utils/pageContext.ts'
import {getUploadsDir} from '../utils/pageContext.ts'
import {readdir, access} from 'node:fs/promises'
import {createLoggedFetch} from '../utils/loggedFetch.ts'
import type {FetchFn} from '../utils/loggedFetch.ts'

interface ServerUpload {
  name: string
  hash: string
}

async function fetchServerUploads(
  fetch: FetchFn,
  serverUrl: string,
  auth: string,
  normalizedPath: string,
): Promise<ServerUpload[]> {
  const uploadsUrl = normalizedPath ? `${serverUrl}/${normalizedPath}/uploads.json` : `${serverUrl}/uploads.json`

  try {
    const response = await fetch(uploadsUrl, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    })

    if (!response.ok) {
      if (response.status === 404) {
        return []
      }
      throw new Error(`Failed to fetch uploads.json: ${response.status}`)
    }

    return (await response.json()) as ServerUpload[]
  } catch {
    return []
  }
}

async function deleteUploadFromServer(
  fetch: FetchFn,
  serverUrl: string,
  auth: string,
  normalizedPath: string,
  filename: string,
): Promise<void> {
  const deleteUrl = normalizedPath
    ? `${serverUrl}/${normalizedPath}/edit?upload=${encodeURIComponent(filename)}`
    : `${serverUrl}/edit?upload=${encodeURIComponent(filename)}`

  const response = await fetch(deleteUrl, {
    method: 'DELETE',
    headers: {
      Authorization: `Basic ${auth}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to delete ${filename}: ${response.status} ${response.statusText}`)
  }
}

/**
 * Delete uploads from server that no longer exist locally for a single path
 */
export const deletePathUploads: PathOperation = async ctx => {
  const uploadsDir = getUploadsDir(ctx)

  let localUploads: string[] = []
  try {
    await access(uploadsDir)
    localUploads = await readdir(uploadsDir)
  } catch {
    // No local uploads directory
  }

  const fetch = createLoggedFetch(ctx.log)
  const serverUploads = await fetchServerUploads(fetch, ctx.serverUrl, ctx.auth, ctx.normalizedPath)
  const serverUploadNames = serverUploads.map(u => u.name)

  const uploadsToDelete = serverUploadNames.filter(filename => !localUploads.includes(filename))

  if (uploadsToDelete.length === 0) {
    return
  }

  for (const filename of uploadsToDelete) {
    try {
      await deleteUploadFromServer(fetch, ctx.serverUrl, ctx.auth, ctx.normalizedPath, filename)
    } catch (error) {
      ctx.log.warn(formatWarning(`Failed to delete ${filename}: ${(error as Error).message}`))
    }
  }
}
