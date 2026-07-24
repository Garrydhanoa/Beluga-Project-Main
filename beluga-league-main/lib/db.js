import { Pool } from 'pg'

let pool = null

// TLS config for the Postgres link. If a CA cert is provided (DATABASE_CA_CERT, PEM
// contents), verify the server certificate strictly — this defeats MITM on the DB
// connection. Without a CA we fall back to relaxed verification: the production apps
// connect over Railway's PRIVATE network (postgres.railway.internal), whose self-signed
// cert can't be strictly verified without Railway's CA. Set DATABASE_CA_CERT to enable
// strict TLS (recommended, especially for the public proxy host used in dev).
function buildSslConfig() {
  const ca = process.env.DATABASE_CA_CERT
  if (ca && ca.includes('BEGIN CERTIFICATE')) {
    return { ca, rejectUnauthorized: true }
  }
  return { rejectUnauthorized: false }
}

export function getPool() {
  if (pool) return pool

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured')
  }

  pool = new Pool({
    connectionString,
    ssl: buildSslConfig(),
  })

  return pool
}

export async function query(text, params) {
  const client = getPool()
  return client.query(text, params)
}
