import {mkdir, readFile, readdir, access} from 'node:fs/promises'
import {join} from 'node:path'
import {createWriteStream} from 'node:fs'
import {createHash} from 'node:crypto'
import {pipeline} from 'node:stream/promises'
import {confirm} from '@inquirer/prompts'
import {formatWarning} from '../utils/formatPlan.ts'
import {green, yellow, dim} from '../utils/colors.ts'
import type {PathOperation} from '../utils/pageContext.ts'
import {getUploadsDir} from '../utils/pageContext.ts'
import {createLoggedFetch} from '../utils/loggedFetch.ts'
import type {FetchFn} from '../utils/loggedFetch.ts'

async function downloadFile(fetch: FetchFn, url: string, auth: string, targetPath: string): Promise<void> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  })

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`File not found: ${url}`)
    }
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  }

  if (!response.body) {
    throw new Error('No response body from server')
  }

  const targetDir = join(targetPath, '..')
  await mkdir(targetDir, {recursive: true})

  const fileStream = createWriteStream(targetPath)
  await pipeline(response.body, fileStream)
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

function getLocalFileHash(fileBuffer: Buffer): string {
  return `sha256:${createHash('sha256').update(fileBuffer).digest('hex')}`
}

/**
 * Download missing or changed uploads from server for a single path
 */
export const downloadPathUploads: PathOperation = async ctx => {
  if (!ctx.settings.uploads || ctx.settings.uploads.length === 0) {
    return
  }

  const uploadsDir = getUploadsDir(ctx)

  let existingUploads: string[] = []
  try {
    await access(uploadsDir)
    existingUploads = await readdir(uploadsDir)
  } catch {
    // Directory doesn't exist yet
  }

  // If no local uploads exist, download all without fetching hashes
  if (existingUploads.length === 0) {
    const fetch = createLoggedFetch(ctx.log)

    if (ctx.prompt) {
      for (const filename of ctx.settings.uploads) {
        ctx.log.info(`${green('+')} uploads/${filename} ${dim('(new)')}`)
      }
      const count = ctx.settings.uploads.length
      const proceed = await confirm({
        message: `Would you like to download ${count} item${count === 1 ? '' : 's'}?`,
        default: true,
        theme: {prefix: ''},
      })
      if (!proceed) return
    }

    await mkdir(uploadsDir, {recursive: true})

    for (const filename of ctx.settings.uploads) {
      const uploadUrl = `${ctx.serverUrl}/${ctx.normalizedPath}/uploads/${filename}`
      const targetPath = join(uploadsDir, filename)
      try {
        await downloadFile(fetch, uploadUrl, ctx.auth, targetPath)
      } catch (error) {
        ctx.log.warn(formatWarning(`Failed to download ${filename}: ${(error as Error).message}`))
      }
    }
    return
  }

  // Local uploads exist — fetch hashes to diff
  const fetch = createLoggedFetch(ctx.log)
  const serverUploads = await fetchServerUploads(fetch, ctx.serverUrl, ctx.auth, ctx.normalizedPath)

  const uploadsToDownload: string[] = []

  for (const serverUpload of serverUploads) {
    if (!existingUploads.includes(serverUpload.name)) {
      uploadsToDownload.push(serverUpload.name)
    } else {
      try {
        const fileBuffer = await readFile(join(uploadsDir, serverUpload.name))
        const localHash = getLocalFileHash(fileBuffer)
        if (localHash !== serverUpload.hash) {
          uploadsToDownload.push(serverUpload.name)
        }
      } catch {
        uploadsToDownload.push(serverUpload.name)
      }
    }
  }

  if (uploadsToDownload.length === 0) {
    ctx.log.info('All uploads are up to date')
    return
  }

  if (ctx.prompt) {
    for (const filename of uploadsToDownload) {
      const isNew = !existingUploads.includes(filename)
      if (isNew) {
        ctx.log.info(`${green('+')} uploads/${filename} ${dim('(new)')}`)
      } else {
        ctx.log.info(`${yellow('~')} uploads/${filename} ${dim('(modified)')}`)
      }
    }
    const count = uploadsToDownload.length
    const proceed = await confirm({
      message: `Would you like to download ${count} item${count === 1 ? '' : 's'}?`,
      default: true,
      theme: {prefix: ''},
    })
    if (!proceed) return
  }

  ctx.log.info(`Downloading ${uploadsToDownload.length} new upload${uploadsToDownload.length === 1 ? '' : 's'}`)

  await mkdir(uploadsDir, {recursive: true})

  for (const filename of uploadsToDownload) {
    const uploadUrl = `${ctx.serverUrl}/${ctx.normalizedPath}/uploads/${filename}`
    const targetPath = join(uploadsDir, filename)
    try {
      await downloadFile(fetch, uploadUrl, ctx.auth, targetPath)
    } catch (error) {
      ctx.log.warn(formatWarning(`Failed to download ${filename}: ${(error as Error).message}`))
    }
  }
}
