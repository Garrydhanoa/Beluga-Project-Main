import { Pool } from 'pg'

let pool = null

export function getPool() {
  if (pool) return pool

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured')
  }

  pool = new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: false,
    },
  })

  return pool
}

export async function query(text, params) {
  const client = getPool()
  return client.query(text, params)
}
