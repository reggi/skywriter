import type {DocumentQuery, RenderDocumentsManyQuery, UploadsManyQuery} from '../operations/types.ts'
import {createHash} from 'crypto'
import {mkdir, readFile, writeFile, rm} from 'fs/promises'
import {join} from 'path'

/**
 * Generate a cache key from function name and arguments
 */
function getCacheKey(fnName: string, args: unknown): string {
  const argsString = JSON.stringify(args, Object.keys(args as object).sort())
  const hash = createHash('sha256').update(`${fnName}:${argsString}`).digest('hex').substring(0, 16)
  return `${fnName}-${hash}.json`
}

/**
 * Client-side version of functionContext that makes fetch requests to the server
 * Drop-in replacement for server-side functionContext
 */
export function functionContextClient(
  serverUrl?: string,
  auth?: {username: string; password: string},
  options?: {cache?: boolean; log?: (message: string) => void},
) {
  const baseUrl = serverUrl || ''
  const enableCache = options?.cache ?? true
  const cacheDir = './cache'
  const emit = options?.log ?? console.log

  async function callFunction<T>(fnName: string, args: unknown): Promise<T> {
    // Try to read from cache first
    if (enableCache) {
      try {
        const cacheKey = getCacheKey(fnName, args)
        const cachePath = join(cacheDir, cacheKey)
        const cached = await readFile(cachePath, 'utf-8')
        emit(`Cache hit: ${fnName}`)
        return JSON.parse(cached) as T
      } catch {
        // Cache miss, continue to fetch
      }
    }

    const url = `${baseUrl}/edit?fn=${fnName}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Add Basic Auth if credentials provided
    if (auth) {
      const authString = Buffer.from(`${auth.username}:${auth.password}`).toString('base64')
      headers['Authorization'] = `Basic ${authString}`
    }

    emit(`POST ${url}`)

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
      credentials: auth ? undefined : 'include', // Use cookies if no auth header
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Function call failed: ${response.status} ${response.statusText}\n${errorText}`)
    }

    const result = (await response.json()) as T

    // Write to cache (fire and forget to avoid blocking)
    if (enableCache) {
      mkdir(cacheDir, {recursive: true})
        .then(() => {
          const cacheKey = getCacheKey(fnName, args)
          const cachePath = join(cacheDir, cacheKey)
          return writeFile(cachePath, JSON.stringify(result, null, 2), 'utf-8')
        })
        .then(() => emit(`Cached: ${fnName}`))
        .catch(error => console.error(`[functionContextClient] Cache write failed:`, error))
    }

    return result
  }

  return {
    getPage: async (query: DocumentQuery) => {
      return await callFunction('getPage', {query})
    },
    getPages: async (options?: RenderDocumentsManyQuery) => {
      return await callFunction('getPages', {options})
    },
    getUploads: async (options?: UploadsManyQuery & {path?: string}) => {
      return await callFunction('getUploads', {options})
    },
  }
}

/**
 * Clear the cache directory
 */
export async function clearCache(cacheDir: string = './cache'): Promise<void> {
  try {
    await rm(cacheDir, {recursive: true, force: true})
    console.log(`✓ Cache cleared: ${cacheDir}`)
  } catch (error) {
    console.error(`Failed to clear cache:`, error)
  }
}
