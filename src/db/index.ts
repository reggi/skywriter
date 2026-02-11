import {Pool, type PoolClient} from 'pg'
import {config} from 'dotenv'

// Load environment variables
config()

let pool: Pool | null = null

export async function createDatabaseContext(connectionString?: string): Promise<PoolClient> {
  if (!pool) {
    pool = new Pool({
      connectionString: connectionString || process.env.DATABASE_URL,
    })
  }

  return await pool.connect()
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
