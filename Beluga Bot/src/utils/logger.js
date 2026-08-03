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

// Best-effort mirror of bot errors into the shared `higgen_logs` table so the
// website's hidden /higgenlogs page shows them (no more digging in Railway logs).
// Because EVERY error in the bot already funnels through Logger.error, this one
// hook gives the Fails tab complete coverage: unhandledRejection, uncaughtException,
// the Discord client error event, and every command's own catch block.
//
// higgenLog buffers and lazy-requires the database itself, so this stays cheap and
// can't deadlock on the logger↔database circular import. Guarded by `logging` so a
// failure inside the mirror can never recurse back into Logger.
let logging = false;
function mirrorToAuditLog(level, message, error) {
  if (logging) return;
  logging = true;
  try {
    require('./higgenLog').logLoggerError(level, message, error);
  } catch { /* audit table may not exist yet — never block logging */ }
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
    mirrorToAuditLog('error', message, error);
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
