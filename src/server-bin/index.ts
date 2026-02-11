import {serve} from '@hono/node-server'
import {createDatabaseContext, closeDatabaseContext, closePool} from '../db/index.ts'
import {createApp} from '../server/index.ts'

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5455/skywriter'
const client = await createDatabaseContext(connectionString)

const app = await createApp(client)

const port = Number(process.env.PORT) || 3000
console.log(`Server is running on http://localhost:${port}`)

serve({
  fetch: app.fetch,
  port,
})

// Cleanup on exit
async function shutdown(signal: string) {
  console.log(`\nReceived ${signal}, shutting down...`)
  await closeDatabaseContext(client)
  await closePool()
  process.exit(0)
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
