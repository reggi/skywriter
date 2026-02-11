import {readFile, readdir, access} from 'node:fs/promises'
import {join} from 'node:path'
import {Blob} from 'node:buffer'
import {createHash} from 'node:crypto'
import {formatWarning} from '../utils/formatPlan.ts'
import type {PathOperation} from '../utils/pageContext.ts'
import {getUploadsDir} from '../utils/pageContext.ts'
import {createLoggedFetch} from '../utils/loggedFetch.ts'
import type {FetchFn} from '../utils/loggedFetch.ts'

async function uploadFile(
  fetch: FetchFn,
  url: string,
  auth: string,
  filePath: string,
  filename: string,
): Promise<void> {
  const fileBuffer = await readFile(filePath)
  const blob = new Blob([fileBuffer])

  const form = new FormData()
  form.append('file', blob, filename)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
    },
    body: form,
  })

  if (!response.ok) {
    throw new Error(`Failed to upload ${filename}: ${response.status} ${response.statusText}`)
  }

  try {
    const result = (await response.json()) as {success?: boolean; error?: string}
    if (!result.success) {
      throw new Error(`Server did not confirm upload: ${result.error || 'unknown error'}`)
    }
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error(`Unexpected server response for ${filename}`)
    }
    throw e
  }
}

function getLocalFileHash(fileBuffer: Buffer): string {
  return `sha256:${createHash('sha256').update(fileBuffer).digest('hex')}`
}

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

/**
 * Upload new and changed uploads to server for a single path
 */
export const uploadPathUploads: PathOperation = async ctx => {
  const uploadsDir = getUploadsDir(ctx)

  try {
    await access(uploadsDir)
  } catch {
    return
  }

  const fetch = createLoggedFetch(ctx.log)
  const localUploads = await readdir(uploadsDir)
  const serverUploads = await fetchServerUploads(fetch, ctx.serverUrl, ctx.auth, ctx.normalizedPath)
  const serverUploadMap = new Map(serverUploads.map(u => [u.name, u.hash]))

  const uploadsToSend: string[] = []

  for (const filename of localUploads) {
    const filePath = join(uploadsDir, filename)
    try {
      const fileBuffer = await readFile(filePath)
      const localHash = getLocalFileHash(fileBuffer)
      const serverHash = serverUploadMap.get(filename)
      if (!serverHash || localHash !== serverHash) {
        uploadsToSend.push(filename)
      }
    } catch {
      // File doesn't exist locally, skip
    }
  }

  if (uploadsToSend.length === 0) {
    ctx.log.info('All uploads are synced')
    return
  }

  ctx.log.info(`Uploading ${uploadsToSend.length} new upload${uploadsToSend.length === 1 ? '' : 's'}`)

  const uploadUrl = ctx.normalizedPath
    ? `${ctx.serverUrl}/${ctx.normalizedPath}/edit?upload=true`
    : `${ctx.serverUrl}/edit?upload=true`

  for (const filename of uploadsToSend) {
    const filePath = join(uploadsDir, filename)
    try {
      await access(filePath)
      await uploadFile(fetch, uploadUrl, ctx.auth, filePath, filename)
      ctx.log.info(`Uploaded ${filename}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        ctx.log.warn(formatWarning(`File not found locally: ${filename}`))
      } else {
        ctx.log.warn(formatWarning(`Failed to upload ${filename}: ${(error as Error).message}`))
      }
    }
  }
}
