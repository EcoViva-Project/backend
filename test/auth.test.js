const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { api, registerUser, login, startServer, stopServer, resetDatabase } = require('./helpers');

describe('API — saúde e autenticação', () => {
  before(startServer);
  after(stopServer);
  beforeEach(resetDatabase);

  it('GET /health responde com status ok', async () => {
    const { status, body } = await api('/health');
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'eco-backend');
    assert.ok(body.time);
  });

  it('register exige nome, e-mail e senha', async () => {
    const { status, body } = await api('/auth/register', {
      method: 'POST',
      body: { email: 'teste@eco.app' },
    });
    assert.equal(status, 400);
    assert.match(body.error, /obrigatórios/);
  });

  it('register rejeita senha com menos de 6 caracteres', async () => {
    const { status, body } = await api('/auth/register', {
      method: 'POST',
      body: { name: 'Ana', email: 'ana@eco.app', password: '123' },
    });
    assert.equal(status, 400);
    assert.match(body.error, /6 caracteres/);
  });

  it('register cria conta, normaliza e-mail e devolve token', async () => {
    const { status, body } = await api('/auth/register', {
      method: 'POST',
      body: {
        name: 'Ana Silva',
        email: '  Ana@Eco.App ',
        password: 'segredo123',
        neighborhood: 'Centro',
      },
    });

    assert.equal(status, 201);
    assert.equal(typeof body.token, 'string');
    assert.equal(body.user.email, 'ana@eco.app');
    assert.equal(body.user.name, 'Ana Silva');
    assert.equal(body.user.initials, 'AS');
    assert.equal(body.user.neighborhood, 'Centro');
    assert.equal(body.user.monthlyGoal, 17);
    assert.equal(body.user.weeklyGoal, 5);
    assert.equal(body.user.preferences.notificationsEnabled, true);
    assert.equal(body.user.password_hash, undefined);
    assert.equal(body.user.passwordHash, undefined);
  });

  it('register impede e-mail duplicado ignorando maiúsculas', async () => {
    await registerUser({ email: 'ana@eco.app' });
    const { status, body } = await api('/auth/register', {
      method: 'POST',
      body: { name: 'Outra Ana', email: 'ANA@ECO.APP', password: 'segredo123' },
    });
    assert.equal(status, 409);
    assert.match(body.error, /Já existe/);
  });

  it('login valida credenciais', async () => {
    await registerUser({ email: 'ana@eco.app', password: 'segredo123' });

    const missing = await api('/auth/login', { method: 'POST', body: {} });
    assert.equal(missing.status, 400);

    const wrong = await api('/auth/login', {
      method: 'POST',
      body: { email: 'ana@eco.app', password: 'errada' },
    });
    assert.equal(wrong.status, 401);
    assert.match(wrong.body.error, /inválidos/);

    const ok = await api('/auth/login', {
      method: 'POST',
      body: { email: 'ANA@eco.app', password: 'segredo123' },
    });
    assert.equal(ok.status, 200);
    assert.equal(typeof ok.body.token, 'string');
    assert.equal(ok.body.user.email, 'ana@eco.app');
  });

  it('GET /auth/me exige token válido', async () => {
    const missing = await api('/auth/me');
    assert.equal(missing.status, 401);
    assert.match(missing.body.error, /Autenticação necessária/);

    const invalid = await api('/auth/me', { token: 'token-invalido' });
    assert.equal(invalid.status, 401);

    const { token, user } = await registerUser();
    const me = await api('/auth/me', { token });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.id, user.id);
  });

  it('forgot-password devolve mensagem genérica e código em desenvolvimento', async () => {
    const missing = await api('/auth/forgot-password', { method: 'POST', body: {} });
    assert.equal(missing.status, 400);

    const unknown = await api('/auth/forgot-password', {
      method: 'POST',
      body: { email: 'ninguem@eco.app' },
    });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.devCode, undefined);

    await registerUser({ email: 'ana@eco.app' });
    const known = await api('/auth/forgot-password', {
      method: 'POST',
      body: { email: 'ana@eco.app' },
    });
    assert.equal(known.status, 200);
    assert.match(known.body.devCode, /^\d{6}$/);
    assert.equal(known.body.expiresInMinutes, 30);
  });

  it('forgot-password invalida o código anterior', async () => {
    await registerUser({ email: 'ana@eco.app' });
    const first = await api('/auth/forgot-password', {
      method: 'POST',
      body: { email: 'ana@eco.app' },
    });
    const second = await api('/auth/forgot-password', {
      method: 'POST',
      body: { email: 'ana@eco.app' },
    });

    const reuse = await api('/auth/reset-password', {
      method: 'POST',
      body: { email: 'ana@eco.app', code: first.body.devCode, password: 'nova123' },
    });
    assert.equal(reuse.status, 400);

    const valid = await api('/auth/reset-password', {
      method: 'POST',
      body: { email: 'ana@eco.app', code: second.body.devCode, password: 'nova123' },
    });
    assert.equal(valid.status, 200);
  });

  it('reset-password troca a senha e permite apenas um uso', async () => {
    await registerUser({ email: 'ana@eco.app', password: 'segredo123' });
    const forgot = await api('/auth/forgot-password', {
      method: 'POST',
      body: { email: 'ana@eco.app' },
    });
    const code = forgot.body.devCode;

    const missing = await api('/auth/reset-password', {
      method: 'POST',
      body: { email: 'ana@eco.app' },
    });
    assert.equal(missing.status, 400);

    const short = await api('/auth/reset-password', {
      method: 'POST',
      body: { email: 'ana@eco.app', code, password: '123' },
    });
    assert.equal(short.status, 400);

    const wrong = await api('/auth/reset-password', {
      method: 'POST',
      body: { email: 'ana@eco.app', code: '000000', password: 'nova123' },
    });
    assert.equal(wrong.status, 400);

    const change = await api('/auth/reset-password', {
      method: 'POST',
      body: { email: 'ana@eco.app', code, password: 'nova123' },
    });
    assert.equal(change.status, 200);

    const oldPassword = await api('/auth/login', {
      method: 'POST',
      body: { email: 'ana@eco.app', password: 'segredo123' },
    });
    assert.equal(oldPassword.status, 401);

    const newPassword = await login('ana@eco.app', 'nova123');
    assert.equal(typeof newPassword, 'string');

    const reused = await api('/auth/reset-password', {
      method: 'POST',
      body: { email: 'ana@eco.app', code, password: 'outra123' },
    });
    assert.equal(reused.status, 400);
  });
});
