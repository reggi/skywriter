import {readFile, stat} from 'node:fs/promises'
import {join} from 'node:path'
import {pack} from 'tar-stream'
import {createGzip} from 'node:zlib'
import {formatSuccess} from '../utils/formatPlan.ts'
import type {PathOperation} from '../utils/pageContext.ts'
import {createLoggedFetch} from '../utils/loggedFetch.ts'
import {validateAndGetFilesFromDir} from '../utils/validateAndGetFilesFromDir.ts'

/**
 * Create tarball from list of files in a directory
 */
async function createTarballFromDir(dir: string, files: string[]): Promise<Buffer> {
  const chunks: Buffer[] = []
  const packStream = pack()
  const gzip = createGzip()

  return new Promise(async (resolve, reject) => {
    gzip.on('data', (chunk: Buffer) => chunks.push(chunk))
    gzip.on('end', () => resolve(Buffer.concat(chunks)))
    gzip.on('error', reject)

    packStream.pipe(gzip)

    for (const file of files) {
      const filePath = join(dir, file)
      const content = await readFile(filePath)
      const stats = await stat(filePath)
      packStream.entry(
        {
          name: file,
          size: content.length,
          mode: stats.mode,
          mtime: stats.mtime,
        },
        content,
      )
    }

    packStream.finalize()
  })
}

/**
 * Push a single path via tar — upload tarball to server
 */
export const pushPathViaTar: PathOperation = async ctx => {
  const dir = ctx.dir === '.' ? '.' : ctx.dir
  const {files} = await validateAndGetFilesFromDir(dir)
  const tarball = await createTarballFromDir(dir, files)

  const uploadUrl = ctx.normalizedPath
    ? `${ctx.serverUrl}/${ctx.normalizedPath}/edit?update=true`
    : `${ctx.serverUrl}/edit?update=true`

  const fetch = createLoggedFetch(ctx.log.prefix('push'))
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${ctx.auth}`,
      'Content-Type': 'application/gzip',
    },
    body: new Uint8Array(tarball),
  })

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Authentication failed')
    }
    const errorText = await response.text()
    const label = ctx.reference.charAt(0).toUpperCase() + ctx.reference.slice(1)
    throw new Error(`${label} upload failed (${response.status}): ${errorText}`)
  }

  ctx.log.prefix('push').info(formatSuccess('Uploaded successfully'))
}
