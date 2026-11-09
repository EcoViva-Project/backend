const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadConfig,
  DEFAULT_JWT_SECRET,
  MIN_JWT_SECRET_LENGTH,
} = require('../src/config');

test('config: usa valores padrão quando o ambiente está vazio', () => {
  const config = loadConfig({});

  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.isProduction, false);
  assert.equal(config.port, 3000);
  assert.equal(config.jwtSecret, DEFAULT_JWT_SECRET);
  assert.equal(config.jwtExpiresIn, '7d');
  assert.equal(config.resetCodeTtlMinutes, 30);
  assert.equal(config.corsOrigin, '*');
  assert.ok(config.dbPath.endsWith('eco.db'));
});

test('config: lê as variáveis informadas', () => {
  const config = loadConfig({
    NODE_ENV: 'staging',
    PORT: '4100',
    JWT_SECRET: 'segredo-de-homologacao-com-32-caracteres',
    JWT_EXPIRES_IN: '1d',
    DB_PATH: './tmp/teste.db',
    RESET_CODE_TTL_MINUTES: '10',
    CORS_ORIGIN: 'http://localhost:8080, https://eco.example.com',
  });

  assert.equal(config.nodeEnv, 'staging');
  assert.equal(config.isProduction, false);
  assert.equal(config.port, 4100);
  assert.equal(config.jwtSecret, 'segredo-de-homologacao-com-32-caracteres');
  assert.equal(config.jwtExpiresIn, '1d');
  assert.equal(config.dbPath, './tmp/teste.db');
  assert.equal(config.resetCodeTtlMinutes, 10);
  assert.equal(config.corsOrigin, 'http://localhost:8080, https://eco.example.com');
});

test('config: rejeita PORT inválida', () => {
  for (const value of ['0', '-1', 'abc', '1.5']) {
    assert.throws(() => loadConfig({ PORT: value }), /PORT/, `PORT=${value} deveria falhar`);
  }
});

test('config: rejeita RESET_CODE_TTL_MINUTES inválida', () => {
  for (const value of ['0', '-30', 'dez', '1.5']) {
    assert.throws(
      () => loadConfig({ RESET_CODE_TTL_MINUTES: value }),
      /RESET_CODE_TTL_MINUTES/,
      `RESET_CODE_TTL_MINUTES=${value} deveria falhar`,
    );
  }
});

test('config: exige JWT_SECRET forte em produção', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /JWT_SECRET/);
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', JWT_SECRET: DEFAULT_JWT_SECRET }),
    /JWT_SECRET/,
  );
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'curto-demais' }),
    /JWT_SECRET/,
  );

  const secret = 'a'.repeat(MIN_JWT_SECRET_LENGTH);
  const config = loadConfig({ NODE_ENV: 'production', JWT_SECRET: secret });

  assert.equal(config.isProduction, true);
  assert.equal(config.jwtSecret, secret);
});
