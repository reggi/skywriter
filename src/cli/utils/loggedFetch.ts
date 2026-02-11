import type {PrefixLog} from './prefixLog.ts'

export type FetchFn = (url: string | URL, init?: RequestInit) => Promise<Response>

export function createLoggedFetch(log: PrefixLog): FetchFn {
  return async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method || 'GET').toUpperCase()
    try {
      const response = await globalThis.fetch(url, init)
      log.http(`${method} ${url} ${response.status}`)
      return response
    } catch (err) {
      log.http(`${method} ${url} FAILED`)
      throw err
    }
  }
}
