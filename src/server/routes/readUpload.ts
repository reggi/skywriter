import type {MiddlewareHandler} from 'hono'
import * as nodePath from 'path'
import {readFile} from 'fs/promises'
import mime from 'mime-types'
import type {AppContext} from '../utils/types.ts'
import {getUpload} from '../../operations/getUpload.ts'

export const readUpload: MiddlewareHandler<AppContext> = async c => {
  const client = c.get('client')
  const uploadsMatch = c.get('pathMatch')

  if (!uploadsMatch) {
    throw new Error('readUpload requires pathMatch to be set')
  }

  const docPath = uploadsMatch[1] || '/'
  const originalFilename = decodeURIComponent(uploadsMatch[2])

  try {
    const isAuthenticated = c.get('isAuthenticated') || false
    const revealHidden = c.req.query('reveal') !== undefined

    // Build options based on authentication and reveal param
    const options: {published?: boolean; includeHidden?: boolean} = {}

    if (!isAuthenticated) {
      // Unauthenticated users can only see uploads on published documents
      options.published = true
    } else if (revealHidden) {
      // Authenticated users with ?reveal can see hidden uploads
      options.includeHidden = true
    }

    // Look up the upload by document path and original filename
    const upload = await getUpload(client, {path: docPath}, originalFilename, options)

    if (!upload) {
      return c.html('<h1>404 - Upload Not Found</h1>', 404)
    }

    // Read the actual file from the uploads directory using the system filename
    const uploadsPath = c.get('uploadsPath')
    const filePath = nodePath.join(uploadsPath, upload.filename)
    const fileBuffer = await readFile(filePath)

    // Determine content type from file extension
    const contentType = mime.lookup(originalFilename) || 'application/octet-stream'

    // Encode filename for Content-Disposition header (RFC 5987)
    // Remove non-ASCII characters for fallback, and provide UTF-8 encoded version
    const asciiFilename = originalFilename.replace(/[^\x00-\x7F]/g, '_')
    const encodedFilename = encodeURIComponent(originalFilename)

    return new Response(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
      },
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File not found on disk - return 404 without logging (common for orphaned records)
      return c.html('<h1>404 - File Not Found</h1>', 404)
    }
    console.error('Upload serving error:', error)
    return c.html('<h1>500 - Internal Server Error</h1>', 500)
  }
}
