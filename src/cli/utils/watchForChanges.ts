import {watch} from 'node:fs/promises'
import type {DiscoveryResult} from '../middleware/types.ts'
import {discoverDocuments} from './discover.ts'
import log from './log.ts'

/**
 * Watch for file changes and re-discover documents when settings.json changes
 * @param onDiscoveryChange - Callback when discovery changes, receives new discovery result
 */
export function watchForChanges(onDiscoveryChange: (discovery: DiscoveryResult) => void): void {
  ;(async () => {
    try {
      const watcher = watch(process.cwd(), {recursive: true})
      for await (const event of watcher) {
        // Skip node_modules and other ignored directories
        if (
          event.filename?.includes('node_modules') ||
          event.filename?.includes('.git') ||
          event.filename?.startsWith('.')
        ) {
          continue
        }

        // Re-discover documents when settings.json files change
        if (event.filename?.endsWith('settings.json')) {
          try {
            const discovery = await discoverDocuments(process.cwd(), {throwOnEmpty: true})
            log.info(`🔄 Re-discovered ${discovery.documents.size} document(s) (${event.filename})`)
            onDiscoveryChange(discovery)
          } catch (error) {
            log.error('❌ Error re-discovering documents:', error)
          }
        } else {
          // Just log the change for other files - they'll be loaded fresh on next request
          log.info(`🔄 File changed: ${event.filename}`)
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ERR_USE_AFTER_CLOSE') {
        log.error('Error watching files:', error)
      }
    }
  })()
}
