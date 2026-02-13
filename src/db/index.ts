import {Pool, type PoolClient} from 'pg'
import {config} from 'dotenv'

// Load environment variables
config()

let pool: Pool | null = null

export function getPool(connectionString?: string): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: connectionString || process.env.DATABASE_URL,
    })
  }
  return pool
}

export async function createDatabaseContext(connectionString?: string): Promise<PoolClient> {
  return await getPool(connectionString).connect()
}

export async function closeDatabaseContext(client: PoolClient): Promise<void> {
  await client.release()
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
