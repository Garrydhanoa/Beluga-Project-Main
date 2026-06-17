const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

// Best-effort mirror of bot errors into the shared `site_logs` table so the
// website's hidden /higgenlogs page shows them (no more digging in Railway logs).
// Lazy-require to avoid a circular import at startup (database.js pulls Logger).
// Guarded by `logging` so a DB failure inside here can't recurse forever.
let logging = false;
function mirrorToSiteLogs(level, message, error) {
  if (logging) return;
  logging = true;
  try {
    const { pool, isDatabaseAvailable } = require('./database');
    const up = typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
    if (up) {
      const raw = error ? (error.stack || error.message || String(error)) : null;
      pool.query(
        `INSERT INTO site_logs (source, level, kind, summary, detail) VALUES ('bot', $1, 'error', $2, $3)`,
        [level, String(message || 'bot error').slice(0, 500), raw ? raw.slice(0, 4000) : null]
      ).catch(() => {});
    }
  } catch { /* table/db may not exist yet — never block logging */ }
  finally { logging = false; }
}

class Logger {
  static info(message) {
    console.log(`${colors.blue}ℹ️  ${new Date().toISOString()} [INFO]${colors.reset} ${message}`);
  }

  static success(message) {
    console.log(`${colors.green}✅ ${new Date().toISOString()} [SUCCESS]${colors.reset} ${message}`);
  }

  static warning(message) {
    console.log(`${colors.yellow}⚠️  ${new Date().toISOString()} [WARNING]${colors.reset} ${message}`);
  }

  static error(message, error = null) {
    console.error(`${colors.red}❌ ${new Date().toISOString()} [ERROR]${colors.reset} ${message}`);
    if (error) {
      console.error(`${colors.red}${error.stack || error}${colors.reset}`);
    }
    mirrorToSiteLogs('error', message, error);
  }

  static debug(message) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`${colors.magenta}🐛 ${new Date().toISOString()} [DEBUG]${colors.reset} ${message}`);
    }
  }

  static bot(message) {
    console.log(`${colors.cyan}🤖 ${new Date().toISOString()} [BOT]${colors.reset} ${message}`);
  }
}

module.exports = Logger;
