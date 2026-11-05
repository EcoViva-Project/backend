const path = require('node:path');

module.exports = {
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET || 'eco-dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'eco.db'),
  resetCodeTtlMinutes: Number(process.env.RESET_CODE_TTL_MINUTES || 30),
};
