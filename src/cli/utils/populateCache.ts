import {assemble} from './assemble.ts'
import {render} from '../../render/index.ts'
import {functionContextClient} from '../../fn/functionContextClient.ts'
import type {PrefixLog} from './prefixLog.ts'

interface PopulateCacheConfig {
  serverUrl: string
  username: string
  password: string
}

/**
 * Populate cache by assembling the document and triggering a render
 */
export async function populateCache(config: PopulateCacheConfig, cmdLog: PrefixLog, dir?: string): Promise<void> {
  const log = cmdLog.prefix('cache')
  try {
    const document = await assemble(dir)
    const fn = functionContextClient(
      config.serverUrl,
      {
        username: config.username,
        password: config.password,
      },
      {cache: true, log: (msg: string) => log.http(msg)},
    )
    await render(document, {fn})
  } catch (error) {
    throw error
  }
}
