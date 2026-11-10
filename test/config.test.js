// O módulo de configuração lê o ambiente ao ser carregado: banco em memória
// para não criar arquivos em `data/`.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadConfig,
  DEFAULT_PORT,
  JWT_SECRET_FILE,
  KNOWN_EXAMPLE_SECRETS,
  MIN_JWT_SECRET_LENGTH,
} = require('../src/config');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'eco-config-'));
}

test('config: usa valores padrão quando o ambiente está vazio', () => {
  const config = loadConfig({ DB_PATH: ':memory:' });

  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.isProduction, false);
  assert.equal(config.port, 3100);
  assert.equal(DEFAULT_PORT, 3100);
  assert.equal(config.jwtExpiresIn, '7d');
  assert.equal(config.resetCodeTtlMinutes, 30);
  assert.equal(config.exposeResetCode, false);
  assert.equal(config.weeklyPointsCap, 400);
  assert.equal(config.authRateLimitMax, 10);
  assert.equal(config.authRateLimitWindowMinutes, 15);
  assert.equal(config.bcryptRounds, 10);
  assert.equal(config.trustProxy, false);
  assert.equal(config.corsOrigin, '*');
  assert.ok(loadConfig({}).dbPath.endsWith('eco.db'));
});

test('config: sem JWT_SECRET fora de produção gera um segredo aleatório', () => {
  const first = loadConfig({ DB_PATH: ':memory:' });
  const second = loadConfig({ DB_PATH: ':memory:' });
  assert.ok(first.jwtSecret.length >= MIN_JWT_SECRET_LENGTH);
  assert.notEqual(first.jwtSecret, second.jwtSecret);
  assert.equal(first.jwtSecretSource, 'process');
  assert.equal(KNOWN_EXAMPLE_SECRETS.includes(first.jwtSecret), false);
});

test('config: com banco em arquivo o segredo gerado fica salvo ao lado do banco', () => {
  const dir = tempDir();
  try {
    const dbPath = path.join(dir, 'eco.db');
    const first = loadConfig({ DB_PATH: dbPath });
    const second = loadConfig({ DB_PATH: dbPath });
    assert.equal(first.jwtSecretSource, 'file');
    assert.equal(first.jwtSecret, second.jwtSecret);
    assert.equal(fs.readFileSync(path.join(dir, JWT_SECRET_FILE), 'utf8').trim(), first.jwtSecret);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('config: lê as variáveis informadas', () => {
  const config = loadConfig({
    NODE_ENV: 'staging',
    PORT: '4100',
    JWT_SECRET: 'segredo-de-homologacao-com-32-caracteres',
    JWT_EXPIRES_IN: '1d',
    DB_PATH: './tmp/teste.db',
    RESET_CODE_TTL_MINUTES: '10',
    EXPOSE_RESET_CODE: 'true',
    WEEKLY_POINTS_CAP: '500',
    AUTH_RATE_LIMIT_MAX: '3',
    AUTH_RATE_LIMIT_WINDOW_MINUTES: '5',
    BCRYPT_ROUNDS: '12',
    TRUST_PROXY: 'true',
    CORS_ORIGIN: 'http://localhost:8080, https://eco.example.com',
  });

  assert.equal(config.nodeEnv, 'staging');
  assert.equal(config.isProduction, false);
  assert.equal(config.port, 4100);
  assert.equal(config.jwtSecret, 'segredo-de-homologacao-com-32-caracteres');
  assert.equal(config.jwtSecretSource, 'env');
  assert.equal(config.jwtExpiresIn, '1d');
  assert.equal(config.dbPath, './tmp/teste.db');
  assert.equal(config.resetCodeTtlMinutes, 10);
  assert.equal(config.exposeResetCode, true);
  assert.equal(config.weeklyPointsCap, 500);
  assert.equal(config.authRateLimitMax, 3);
  assert.equal(config.authRateLimitWindowMinutes, 5);
  assert.equal(config.bcryptRounds, 12);
  // O antigo TRUST_PROXY=true vale como um proxy (nunca como confiar em todos).
  assert.equal(config.trustProxy, 1);
  assert.equal(config.corsOrigin, 'http://localhost:8080, https://eco.example.com');
});

test('config: rejeita valores numéricos e booleanos inválidos', () => {
  const memory = { DB_PATH: ':memory:' };
  for (const value of ['0', '-1', 'abc', '1.5']) {
    assert.throws(() => loadConfig({ ...memory, PORT: value }), /PORT/);
    assert.throws(
      () => loadConfig({ ...memory, RESET_CODE_TTL_MINUTES: value }),
      /RESET_CODE_TTL_MINUTES/,
    );
    assert.throws(() => loadConfig({ ...memory, WEEKLY_POINTS_CAP: value }), /WEEKLY_POINTS_CAP/);
  }
  assert.throws(() => loadConfig({ ...memory, EXPOSE_RESET_CODE: 'talvez' }), /EXPOSE_RESET_CODE/);
  assert.throws(() => loadConfig({ ...memory, BCRYPT_ROUNDS: '2' }), /BCRYPT_ROUNDS/);
});

test('config: exige JWT_SECRET próprio e forte em produção', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /JWT_SECRET/);
  for (const secret of KNOWN_EXAMPLE_SECRETS) {
    assert.throws(
      () => loadConfig({ NODE_ENV: 'production', JWT_SECRET: secret }),
      /JWT_SECRET/,
      `o exemplo "${secret}" deveria ser recusado`,
    );
  }
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'curto-demais' }),
    /JWT_SECRET/,
  );

  const secret = 'a'.repeat(MIN_JWT_SECRET_LENGTH);
  const config = loadConfig({ NODE_ENV: 'production', JWT_SECRET: secret });
  assert.equal(config.isProduction, true);
  assert.equal(config.jwtSecret, secret);
});

test('config: o JWT_SECRET do .env.example vem vazio', () => {
  const example = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  assert.match(example, /^JWT_SECRET=$/m);
  assert.match(example, /^PORT=3100$/m);
});

test('config: produção recusa EXPOSE_RESET_CODE=true', () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'b'.repeat(64),
        EXPOSE_RESET_CODE: 'true',
      }),
    /EXPOSE_RESET_CODE/,
  );
});

test('config: TRUST_PROXY aceita número de proxies ou lista de endereços, nunca true', () => {
  const memory = { DB_PATH: ':memory:' };
  const trust = (value) => loadConfig({ ...memory, TRUST_PROXY: value }).trustProxy;
  for (const off of [undefined, '', 'false', 'FALSE', '0', ' 0 ']) assert.equal(trust(off), false);
  assert.equal(trust('true'), 1);
  assert.equal(trust('1'), 1);
  assert.equal(trust('2'), 2);
  assert.deepEqual(trust('loopback'), ['loopback']);
  assert.deepEqual(trust('loopback, 10.0.0.0/8 ,192.168.0.1'), [
    'loopback',
    '10.0.0.0/8',
    '192.168.0.1',
  ]);
  assert.deepEqual(trust('uniquelocal,::1,fd00::/8'), ['uniquelocal', '::1', 'fd00::/8']);
  for (const value of ['talvez', '-1', '1.5', '10.0.0.0/33', '10.0.0/8', 'loopback,,qualquer', ',']) {
    assert.throws(() => trust(value), /TRUST_PROXY/, value);
  }
});
