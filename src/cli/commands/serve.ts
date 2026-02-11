import {Hono} from 'hono'
import {serve as honoServe} from '@hono/node-server'
import {clearCache} from '../../utils/functionContextClient.ts'
import type {Server} from 'node:http'
import {discoverDocuments} from '../utils/discover.ts'
import {watchForChanges} from '../utils/watchForChanges.ts'
import type {CliCommand} from '../utils/types.ts'
import {checkDuplicatePath} from '../middleware/checkDuplicatePath.ts'
import {redirectRoot} from '../middleware/redirectRoot.ts'
import {serveUploads} from '../middleware/serveUploads.ts'
import {serveDocument} from '../middleware/serveDocument.ts'
import log from '../utils/log.ts'

/**
 * Serve multiple documents from the current working directory
 * Discovers all settings.json files and routes to appropriate documents on-demand
 */
export const serve: CliCommand<[number, boolean?, boolean?]> = async (
  ctx,
  port,
  watchFiles = true,
  clearCacheFlag = false,
) => {
  // Clear cache if requested
  if (clearCacheFlag) {
    await clearCache()
  }

  // Discover all documents in the directory tree
  let discovery = await discoverDocuments(process.cwd(), {throwOnEmpty: true})

  // Getter function for middleware (allows for mutable discovery)
  const getDiscovery = () => discovery

  const app = new Hono()

  // Apply middleware in order:
  // 1. Check for duplicate paths (returns 500 if path is duplicated)
  // 2. Redirect root to first document if no root document exists
  // 3. Serve uploads from document directories
  // 4. Serve documents
  app.get(
    '/*',
    checkDuplicatePath(getDiscovery),
    redirectRoot(getDiscovery),
    serveUploads(getDiscovery),
    serveDocument(getDiscovery, ctx),
  )

  log.info(`\n🚀 Serving at http://localhost:${port}/`)
  if (watchFiles) {
    log.info(`👀 Watching for file changes...`)
    watchForChanges(newDiscovery => {
      discovery = newDiscovery
    })
  }

  const server = honoServe({
    fetch: app.fetch,
    port,
  })

  // Ensure the HTTP server keeps the process alive even if the underlying
  // implementation uses `unref()`.
  if (typeof (server as unknown as Server).ref === 'function') {
    ;(server as unknown as Server).ref()
  }

  // Keep the command running until the server closes.
  await new Promise<void>((resolve, reject) => {
    ;(server as unknown as Server).once('close', () => resolve())
    ;(server as unknown as Server).once('error', err => reject(err))
  })
}
