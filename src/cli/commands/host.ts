import {serve as honoServe} from '@hono/node-server'
import {getPool, closePool} from '../../db/index.ts'
import {createApp} from '../../server/index.ts'
import {runner} from 'node-pg-migrate'
import type {Server} from 'node:http'
import type {CliCommand} from '../utils/types.ts'
import log from '../utils/log.ts'

/**
 * Start the production server backed by PostgreSQL
 */
export const host: CliCommand<[number, boolean?, boolean?]> = async (_ctx, port, migrate = false, seed = true) => {
  const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5455/skywriter'

  if (migrate) {
    log.info('Running pending database migrations...')
    await runner({
      databaseUrl: connectionString,
      migrationsTable: 'pgmigrations',
      dir: new URL('../../../migrations', import.meta.url).pathname,
      direction: 'up',
      log: (msg: string) => log.info(msg),
    })
    log.info('Migrations complete.')
  }

  const pool = getPool(connectionString)
  const app = await createApp(pool, {seed})

  log.info(`🚀 Server is running on http://localhost:${port}/`)

  const server = honoServe({
    fetch: app.fetch,
    port,
  })

  if (typeof (server as unknown as Server).ref === 'function') {
    ;(server as unknown as Server).ref()
  }

  async function shutdown(signal: string) {
    log.info(`\nReceived ${signal}, shutting down...`)
    await closePool()
    process.exit(0)
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })

  // Keep the command running until the server closes
  await new Promise<void>((resolve, reject) => {
    ;(server as unknown as Server).once('close', () => resolve())
    ;(server as unknown as Server).once('error', err => reject(err))
  })
}
