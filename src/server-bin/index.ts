import {serve} from '@hono/node-server'
import {getPool, closePool} from '../db/index.ts'
import {createApp} from '../server/index.ts'

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5455/skywriter'
const pool = getPool(connectionString)

const app = await createApp(pool)

const port = Number(process.env.PORT) || 3000
console.log(`Server is running on http://localhost:${port}`)

serve({
  fetch: app.fetch,
  port,
})

// Cleanup on exit
async function shutdown(signal: string) {
  console.log(`\nReceived ${signal}, shutting down...`)
  await closePool()
  process.exit(0)
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
