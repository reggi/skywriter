import type {MiddlewareHandler} from 'hono'
import {assemble} from '../utils/assemble.ts'
import {responder} from '../../responder/index.ts'
import {render} from '../../render/index.ts'
import {functionContextClient} from '../../fn/functionContextClient.ts'
import {readConfig} from '../utils/config.ts'
import type {CliContext} from '../utils/types.ts'
import type {CliMiddlewareFactory, DiscoveryGetter, DiscoveryResult} from './types.ts'
import {createPrefixLog} from '../utils/prefixLog.ts'
import log from '../utils/log.ts'

/**
 * Middleware that serves documents by finding and assembling them on-demand.
 *
 * @param getDiscovery - Getter function for the current discovery result
 * @param ctx - CLI context for authentication
 */
export const serveDocument: CliMiddlewareFactory<[getDiscovery: DiscoveryGetter, ctx: CliContext]> = (
  getDiscovery,
  ctx,
): MiddlewareHandler => {
  // Create function context once (lazily initialized)
  let fn: ReturnType<typeof functionContextClient> | null = null
  let fnInitialized = false

  const getFn = async () => {
    if (!fnInitialized) {
      fnInitialized = true
      try {
        const cmdLog = createPrefixLog(ctx.cliName, 'serve')
        const config = await readConfig(ctx, cmdLog)
        fn = functionContextClient(
          config.serverUrl,
          {
            username: config.username,
            password: config.password,
          },
          {cache: true},
        )
        log.info(`\n🔐 Connected to: ${config.serverUrl}`)
        log.info(`💾 Cache enabled: ./cache`)
      } catch {
        log.info('\n⚠️  Not logged in - server functions (fn.getPage, etc.) will not be available')
        fn = {
          getPage: async () => {
            throw new Error(`fn.getPage() requires authentication. Run "${ctx.cliName} login" to connect to a server.`)
          },
          getPages: async () => {
            throw new Error(`fn.getPages() requires authentication. Run "${ctx.cliName} login" to connect to a server.`)
          },
          getUploads: async () => {
            throw new Error(
              `fn.getUploads() requires authentication. Run "${ctx.cliName} login" to connect to a server.`,
            )
          },
        }
      }
    }
    return fn!
  }

  return async (c, next) => {
    const discovery = getDiscovery()
    const requestPath = c.req.path

    // Find the document by trying to match the path
    const docInfo = findDocumentForPath(discovery, requestPath)
    if (!docInfo) {
      return next()
    }

    try {
      // Create a resolver that looks up paths from the discovery graph
      const resolveDocumentPath = async (path: string): Promise<string | null> => {
        const doc = discovery.documents.get(path)
        return doc?.fsPath ?? null
      }

      // Assemble document on-demand from its filesystem location
      const document = await assemble(docInfo.fsPath, {resolveDocumentPath})

      // Get function context (lazy init)
      const fn = await getFn()

      return await responder({
        path: requestPath,
        getDocument: async () => document,
        getRender: async doc => render(doc, {fn}),
      })
    } catch (error) {
      log.error(`❌ Error loading ${requestPath}:`, error)
      return new Response(`Error loading document: ${(error as Error).message}`, {
        status: 500,
        headers: {'Content-Type': 'text/plain'},
      })
    }
  }
}

/**
 * Find the document info for a given request path.
 * Handles parsing asset suffixes and finding the matching document.
 */
function findDocumentForPath(discovery: DiscoveryResult, requestPath: string): {fsPath: string; path: string} | null {
  // Try direct match first
  let docInfo = discovery.documents.get(requestPath)
  if (docInfo) {
    return {fsPath: docInfo.fsPath, path: requestPath}
  }

  // Try matching by stripping potential asset suffixes
  // Assets are things like /data.json, /style.css, etc.
  // We'll try progressively shorter paths
  const parts = requestPath.split('/')
  for (let i = parts.length - 1; i >= 0; i--) {
    const testPath = parts.slice(0, i + 1).join('/') || '/'
    docInfo = discovery.documents.get(testPath)
    if (docInfo) {
      return {fsPath: docInfo.fsPath, path: testPath}
    }
  }

  return null
}
