const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const MIN_JWT_SECRET_LENGTH = 32;
const DEFAULT_PORT = 3100;
const DEFAULT_HOST = '127.0.0.1';
const JWT_SECRET_FILE = '.jwt-secret';

/**
 * Segredos que já apareceram no repositório (padrão antigo, `.env.example`,
 * testes). São públicos: só valem com `NODE_ENV=test`.
 */
const KNOWN_EXAMPLE_SECRETS = [
  'eco-dev-secret-change-me',
  'change-me-to-a-long-random-string',
  'eco-test-secret',
];

/** Textos de exemplo comuns, que ninguém deveria usar como segredo de verdade. */
const PLACEHOLDER_SECRETS = ['secret', 'segredo', 'jwt-secret', 'your-secret-here', 'changeme'];
const PLACEHOLDER_PATTERN = /change[-_ ]?me|troque|seu[-_ ]segredo|your[-_ ]secret/i;

/** Segredo público ou de exemplo (sem diferenciar maiúsculas e espaços nas pontas). */
function isExampleSecret(secret) {
  const normalized = String(secret).trim().toLowerCase();
  return (
    KNOWN_EXAMPLE_SECRETS.includes(normalized) ||
    PLACEHOLDER_SECRETS.includes(normalized) ||
    PLACEHOLDER_PATTERN.test(normalized)
  );
}

/**
 * `NODE_ENV` sem diferenciar maiúsculas e espaços; `prod` vale como
 * `production`. Devolve o nome usado pela API e o que veio escrito (vazio
 * quando a variável não foi definida).
 */
function normalizeNodeEnv(value) {
  const written = String(value ?? '').trim().toLowerCase();
  const aliases = { prod: 'production' };
  const name = aliases[written] || written;
  return { nodeEnv: name || 'development', written: name };
}

/**
 * `HOST`: em qual endereço a API escuta. Padrão `127.0.0.1` (só este
 * computador). `0.0.0.0` ou `::` abrem a API para a rede.
 */
function parseHost(value) {
  const host = String(value ?? '').trim();
  if (host === '') return DEFAULT_HOST;
  if (host.toLowerCase() === 'localhost' || net.isIP(host) !== 0) return host;
  throw new Error(
    `Configuração inválida para HOST: "${value}". Use um endereço IP, como 127.0.0.1 (padrão) ou 0.0.0.0.`,
  );
}

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

/**
 * Regras de ambiente (`NODE_ENV`, lido sem diferenciar maiúsculas):
 * - `production` (ou `prod`): `JWT_SECRET` obrigatório;
 * - opções perigosas só valem se `NODE_ENV` estiver escrito como
 *   `development` ou `test` (vazio não conta): `EXPOSE_RESET_CODE=true` e
 *   `JWT_SECRET` com menos de 32 caracteres;
 * - segredos de exemplo (do repositório ou textos como "change-me") só valem
 *   com `NODE_ENV=test`, o dos testes automáticos;
 * - sem `JWT_SECRET` fora de produção, a API gera um segredo aleatório (um
 *   `npm start` sem `.env` continua funcionando para desenvolvimento).
 */
function loadConfig(env = process.env) {
  const { nodeEnv, written } = normalizeNodeEnv(env.NODE_ENV);
  const isProduction = nodeEnv === 'production';
  const isTest = written === 'test';
  const allowsDevOptions = written === 'development' || isTest;
  const dbPath = env.DB_PATH || path.join(__dirname, '..', 'data', 'eco.db');
  const exposeResetCode = parseBoolean(env.EXPOSE_RESET_CODE, 'EXPOSE_RESET_CODE');

  let jwtSecret = env.JWT_SECRET || '';
  let jwtSecretSource = 'env';

  if (exposeResetCode && !allowsDevOptions) {
    throw new Error(
      `EXPOSE_RESET_CODE=true só é permitido com NODE_ENV=development ou NODE_ENV=test (agora: ${written ? `"${written}"` : 'vazio'}): ` +
        'o código de recuperação sairia na resposta da API e qualquer pessoa poderia trocar a senha de outra.',
    );
  }
  if (isProduction && !jwtSecret) {
    throw new Error('JWT_SECRET é obrigatório quando NODE_ENV=production.');
  }
  if (jwtSecret && !isTest && isExampleSecret(jwtSecret)) {
    throw new Error(
      'JWT_SECRET é um valor de exemplo (público): com ele qualquer pessoa entra em qualquer conta. ' +
        'Gere um segredo próprio ou deixe a variável vazia fora de produção.',
    );
  }
  if (jwtSecret && !allowsDevOptions && jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET deve ter ao menos ${MIN_JWT_SECRET_LENGTH} caracteres ` +
        '(segredos curtos só valem com NODE_ENV=development ou NODE_ENV=test).',
    );
  }
  if (!jwtSecret) {
    const local = resolveLocalSecret(dbPath);
    jwtSecret = local.secret;
    jwtSecretSource = local.source;
  }

  return {
    nodeEnv,
    isProduction,
    port: parsePositiveInteger(env.PORT, DEFAULT_PORT, 'PORT'),
    host: parseHost(env.HOST),
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
  DEFAULT_HOST,
  JWT_SECRET_FILE,
  KNOWN_EXAMPLE_SECRETS,
  MIN_JWT_SECRET_LENGTH,
};
