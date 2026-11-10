const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const MIN_JWT_SECRET_LENGTH = 32;
const DEFAULT_PORT = 3100;
const JWT_SECRET_FILE = '.jwt-secret';

/**
 * Segredos que já apareceram no repositório (padrão antigo, `.env.example`,
 * testes). São públicos, então nunca valem em produção.
 */
const KNOWN_EXAMPLE_SECRETS = [
  'eco-dev-secret-change-me',
  'change-me-to-a-long-random-string',
  'eco-test-secret',
];

function parsePositiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Configuração inválida para ${name}: "${value}". Use um inteiro positivo.`);
  }
  return parsed;
}

function parseBoolean(value, name) {
  if (value === undefined || value === '') return false;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  throw new Error(`Configuração inválida para ${name}: "${value}". Use true ou false.`);
}

/** Palavras-chave de faixas de endereço que o Express aceita em `trust proxy`. */
const TRUST_PROXY_KEYWORDS = ['loopback', 'linklocal', 'uniquelocal'];

function isProxyAddress(item) {
  if (TRUST_PROXY_KEYWORDS.includes(item.toLowerCase())) return true;
  const [address, prefix, extra] = item.split('/');
  const version = net.isIP(address);
  if (version === 0 || extra !== undefined) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/.test(prefix)) return false;
  return Number(prefix) <= (version === 4 ? 32 : 128);
}

/**
 * `TRUST_PROXY`: em quais proxies confiar para descobrir o IP real (`req.ip`).
 *
 * Nunca vira `true` do Express (confiar em todos): com isso qualquer cliente
 * escolheria o próprio IP pelo cabeçalho `X-Forwarded-For` e escaparia do
 * limitador de tentativas. Aceita:
 * - vazio, `false` ou `0`: desligado (padrão);
 * - inteiro positivo: quantos proxies há na frente da API (`true` antigo = 1);
 * - lista separada por vírgula de IPs, sub-redes ou palavras-chave do Express
 *   (`loopback`, `linklocal`, `uniquelocal`), como `loopback, 10.0.0.0/8`.
 */
function parseTrustProxy(value) {
  if (value === undefined) return false;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '' || normalized === 'false' || normalized === '0') return false;
  if (normalized === 'true') return 1;
  if (/^\d+$/.test(normalized)) return Number(normalized);

  const items = String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const invalid = items.filter((item) => !isProxyAddress(item));
  if (items.length === 0 || invalid.length > 0) {
    throw new Error(
      `Configuração inválida para TRUST_PROXY: "${value}". Use false, o número de proxies ` +
        '(por exemplo 1) ou uma lista de IPs/sub-redes (por exemplo "loopback, 10.0.0.0/8").',
    );
  }
  return items;
}

/** Custo do bcrypt: 10 por padrão; os testes usam 4 para rodar rápido. */
function parseBcryptRounds(value) {
  const rounds = parsePositiveInteger(value, 10, 'BCRYPT_ROUNDS');
  if (rounds < 4 || rounds > 15) {
    throw new Error(`Configuração inválida para BCRYPT_ROUNDS: "${value}". Use um inteiro de 4 a 15.`);
  }
  return rounds;
}

function randomSecret() {
  return crypto.randomBytes(48).toString('hex');
}

/**
 * Segredo JWT para quando `JWT_SECRET` não foi definido (fora de produção).
 *
 * Em vez de um valor fixo e público, gera um segredo aleatório. Com banco em
 * arquivo, o segredo fica em `.jwt-secret` ao lado do banco, para as sessões
 * sobreviverem a um reinício; com banco em memória vale só para o processo.
 */
function resolveLocalSecret(dbPath) {
  if (dbPath === ':memory:') {
    return { secret: randomSecret(), source: 'process' };
  }

  const file = path.join(path.dirname(dbPath), JWT_SECRET_FILE);
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved.length >= MIN_JWT_SECRET_LENGTH) {
      return { secret: saved, source: 'file', file };
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      return { secret: randomSecret(), source: 'process' };
    }
  }

  const secret = randomSecret();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${secret}\n`, { mode: 0o600 });
    return { secret, source: 'file', file };
  } catch {
    // Sem permissão de escrita: o segredo vale só até o processo terminar.
    return { secret, source: 'process' };
  }
}

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const dbPath = env.DB_PATH || path.join(__dirname, '..', 'data', 'eco.db');
  const exposeResetCode = parseBoolean(env.EXPOSE_RESET_CODE, 'EXPOSE_RESET_CODE');

  let jwtSecret = env.JWT_SECRET || '';
  let jwtSecretSource = 'env';

  if (isProduction) {
    if (!jwtSecret) {
      throw new Error('JWT_SECRET é obrigatório quando NODE_ENV=production.');
    }
    if (KNOWN_EXAMPLE_SECRETS.includes(jwtSecret) || jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET deve ser um valor próprio (não um dos exemplos do repositório) com ao menos ${MIN_JWT_SECRET_LENGTH} caracteres.`,
      );
    }
    if (exposeResetCode) {
      throw new Error(
        'EXPOSE_RESET_CODE=true não é permitido com NODE_ENV=production: o código de recuperação sairia na resposta da API.',
      );
    }
  } else if (!jwtSecret) {
    const local = resolveLocalSecret(dbPath);
    jwtSecret = local.secret;
    jwtSecretSource = local.source;
  }

  return {
    nodeEnv,
    isProduction,
    port: parsePositiveInteger(env.PORT, DEFAULT_PORT, 'PORT'),
    jwtSecret,
    jwtSecretSource,
    jwtExpiresIn: env.JWT_EXPIRES_IN || '7d',
    dbPath,
    resetCodeTtlMinutes: parsePositiveInteger(
      env.RESET_CODE_TTL_MINUTES,
      30,
      'RESET_CODE_TTL_MINUTES',
    ),
    exposeResetCode,
    authRateLimitMax: parsePositiveInteger(env.AUTH_RATE_LIMIT_MAX, 10, 'AUTH_RATE_LIMIT_MAX'),
    authRateLimitWindowMinutes: parsePositiveInteger(
      env.AUTH_RATE_LIMIT_WINDOW_MINUTES,
      15,
      'AUTH_RATE_LIMIT_WINDOW_MINUTES',
    ),
    weeklyPointsCap: parsePositiveInteger(env.WEEKLY_POINTS_CAP, 400, 'WEEKLY_POINTS_CAP'),
    bcryptRounds: parseBcryptRounds(env.BCRYPT_ROUNDS),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    corsOrigin: env.CORS_ORIGIN || '*',
  };
}

module.exports = {
  ...loadConfig(),
  loadConfig,
  DEFAULT_PORT,
  JWT_SECRET_FILE,
  KNOWN_EXAMPLE_SECRETS,
  MIN_JWT_SECRET_LENGTH,
};
