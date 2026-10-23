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
    keepAlive: true,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
  })

  // A Postgres restart drops connections; pg reports that as an 'error' event on
  // the pool (idle clients) or on the checked-out client. Unlistened, it's an
  // uncaught exception that kills the server. Log it; the pool reconnects itself.
  pool.on('error', (err) => {
    console.warn(`[db] connection dropped (${err.message}); reconnecting on next query`)
  })
  pool.on('connect', (client) => {
    client.on('error', (err) => console.warn(`[db] client error (${err.message})`))
  })

  return pool
}

export async function query(text, params) {
  const client = getPool()
  return client.query(text, params)
}
