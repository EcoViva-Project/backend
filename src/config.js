const path = require('node:path');

const DEFAULT_JWT_SECRET = 'eco-dev-secret-change-me';
const MIN_JWT_SECRET_LENGTH = 32;

function parsePositiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Configuração inválida para ${name}: "${value}". Use um inteiro positivo.`);
  }
  return parsed;
}

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const jwtSecret = env.JWT_SECRET || DEFAULT_JWT_SECRET;

  if (isProduction) {
    if (!env.JWT_SECRET) {
      throw new Error('JWT_SECRET é obrigatório quando NODE_ENV=production.');
    }
    if (jwtSecret === DEFAULT_JWT_SECRET || jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET deve ser diferente do padrão de desenvolvimento e ter ao menos ${MIN_JWT_SECRET_LENGTH} caracteres.`,
      );
    }
  }

  return {
    nodeEnv,
    isProduction,
    port: parsePositiveInteger(env.PORT, 3000, 'PORT'),
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN || '7d',
    dbPath: env.DB_PATH || path.join(__dirname, '..', 'data', 'eco.db'),
    resetCodeTtlMinutes: parsePositiveInteger(env.RESET_CODE_TTL_MINUTES, 30, 'RESET_CODE_TTL_MINUTES'),
    corsOrigin: env.CORS_ORIGIN || '*',
  };
}

module.exports = {
  ...loadConfig(),
  loadConfig,
  DEFAULT_JWT_SECRET,
  MIN_JWT_SECRET_LENGTH,
};
