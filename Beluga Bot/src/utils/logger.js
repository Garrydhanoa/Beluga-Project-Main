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
