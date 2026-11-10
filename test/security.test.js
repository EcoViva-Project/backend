// Segurança (REVISAO.md, S1 a S8 e R5): limitador de tentativas, código de
// recuperação, versão de sessão, troca de senha, validação e erros de corpo.

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  api,
  registerUser,
  login,
  startServer,
  stopServer,
  resetDatabase,
  advanceClock,
  db,
} = require('./helpers');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const config = require('../src/config');
const { loadConfig } = require('../src/config');
const { dummyHash } = require('../src/routes/auth');
const { rateLimit, createLimiter, resetRateLimits } = require('../src/middleware/rateLimit');

const MAX = config.authRateLimitMax;

describe('API — segurança', () => {
  before(startServer);
  after(stopServer);
  beforeEach(resetDatabase);

  describe('limitador de tentativas', () => {
    it('login: bloqueia com 429 depois do limite, por IP + e-mail', async () => {
      await registerUser({ email: 'ana@test.app', password: 'segredo123' });
      for (let i = 0; i < MAX; i += 1) {
        const wrong = await api('/auth/login', {
          method: 'POST',
          body: { email: 'ana@test.app', password: 'errada' },
        });
        assert.equal(wrong.status, 401);
      }
      const blocked = await api('/auth/login', {
        method: 'POST',
        body: { email: 'ana@test.app', password: 'segredo123' },
      });
      assert.equal(blocked.status, 429);
      assert.match(blocked.body.error, /Muitas tentativas/);
      assert.ok(Number(blocked.headers.get('retry-after')) > 0);

      // Outro e-mail do mesmo IP ainda passa (o limite por IP é maior).
      await registerUser({ email: 'bia@test.app', password: 'segredo123' });
      assert.equal(typeof (await login('bia@test.app', 'segredo123')), 'string');

      // Zerado o limitador (como acontece ao fim da janela), o login volta.
      resetRateLimits();
      assert.equal(typeof (await login('ana@test.app', 'segredo123')), 'string');
    });

    it('limite por IP pega quem troca de e-mail a cada tentativa', async () => {
      let last = null;
      for (let i = 0; i <= MAX * 5; i += 1) {
        last = await api('/auth/forgot-password', {
          method: 'POST',
          body: { email: `pessoa${i}@test.app` },
        });
      }
      assert.equal(last.status, 429);
    });

    it('forgot-password e reset-password também são limitados', async () => {
      await registerUser({ email: 'ana@test.app' });
      let forgot = null;
      for (let i = 0; i <= MAX; i += 1) {
        forgot = await api('/auth/forgot-password', {
          method: 'POST',
          body: { email: 'ana@test.app' },
        });
      }
      assert.equal(forgot.status, 429);

      let reset = null;
      for (let i = 0; i <= MAX; i += 1) {
        reset = await api('/auth/reset-password', {
          method: 'POST',
          body: { email: 'ana@test.app', code: '000000', password: 'nova1234' },
        });
      }
      assert.equal(reset.status, 429);
    });

    it('register também é limitado (contador próprio)', async () => {
      let last = null;
      for (let i = 0; i <= MAX; i += 1) {
        last = await api('/auth/register', {
          method: 'POST',
          body: { name: 'Ana Silva', email: 'ana@test.app', password: 'segredo123' },
        });
        if (i === 0) assert.equal(last.status, 201);
        else if (i < MAX) assert.equal(last.status, 409);
      }
      assert.equal(last.status, 429);
      assert.match(last.body.error, /Muitas tentativas/);

      // O contador do cadastro não gasta as tentativas de login.
      assert.equal(typeof (await login('ana@test.app', 'segredo123')), 'string');
    });

    it('TRUST_PROXY=true não deixa o cliente escolher o IP pelo X-Forwarded-For', async () => {
      await registerUser({ email: 'ana@test.app', password: 'segredo123' });
      const original = app.get('trust proxy');
      // Como em produção atrás de um proxy: TRUST_PROXY=true (valor antigo).
      app.set('trust proxy', loadConfig({ DB_PATH: ':memory:', TRUST_PROXY: 'true' }).trustProxy);
      try {
        const statuses = [];
        for (let i = 0; i <= MAX; i += 1) {
          // O cliente inventa um IP diferente a cada vez; o proxy acrescenta o real.
          const response = await api('/auth/login', {
            method: 'POST',
            body: { email: 'ana@test.app', password: 'errada' },
            headers: { 'X-Forwarded-For': `10.0.0.${i}, 203.0.113.9` },
          });
          statuses.push(response.status);
        }
        assert.equal(statuses.at(-1), 429, statuses.join(','));
      } finally {
        app.set('trust proxy', original);
      }
    });

    it('limitador: confere o IP antes e guarda só o hash do e-mail', () => {
      const limiter = rateLimit('teste-memoria');
      const { byKey, byIp } = limiter.limiters;
      const fakeRes = () => ({
        statusCode: 200,
        set() {},
        status(code) {
          this.statusCode = code;
          return this;
        },
        json() {
          return this;
        },
      });
      const sprayed = (i) => `${i}${'a'.repeat(5000)}@test.app`;
      let passed = 0;
      for (let i = 0; i < MAX * 5 + 20; i += 1) {
        const res = fakeRes();
        limiter({ ip: '198.51.100.7', body: { email: sprayed(i) } }, res, () => {
          passed += 1;
        });
      }
      assert.equal(passed, MAX * 5);
      // Bloqueado pelo IP, nenhum contador novo foi criado para os e-mails.
      assert.equal(byKey.size, MAX * 5);
      assert.equal(byIp.size, 1);
      for (const key of byKey.keys()) {
        assert.ok(key.length < 200, 'a chave não guarda o texto enviado');
        assert.match(key, /\|[a-f0-9]{64}$/);
      }
    });

    it('limitador: número de chaves tem teto (saem as vencidas, depois as mais antigas)', () => {
      const realNow = Date.now;
      let now = 1_000_000;
      Date.now = () => now;
      try {
        const limiter = createLimiter({ max: 3, windowMs: 1000, maxEntries: 3 });
        limiter.hit('a');
        now += 600;
        limiter.hit('b');
        limiter.hit('c');
        now += 500; // 'a' venceu; 'b' e 'c' não.
        limiter.hit('d');
        assert.deepEqual(limiter.keys(), ['b', 'c', 'd']);
        limiter.hit('e'); // cheio e nada vencido: sai a mais antiga.
        assert.deepEqual(limiter.keys(), ['c', 'd', 'e']);
        assert.equal(limiter.size, 3);
      } finally {
        Date.now = realNow;
      }
    });
  });

  describe('login', () => {
    it('e-mail sem conta compara a senha com o mesmo custo do bcrypt', () => {
      const original = config.bcryptRounds;
      try {
        assert.equal(bcrypt.getRounds(dummyHash()), config.bcryptRounds);
        config.bcryptRounds = 6;
        assert.equal(bcrypt.getRounds(dummyHash()), 6);
      } finally {
        config.bcryptRounds = original;
      }
    });
  });

  describe('código de recuperação', () => {
    it('guarda só o hash do código e invalida depois de 5 erros', async () => {
      await registerUser({ email: 'ana@test.app', password: 'segredo123' });
      const forgot = await api('/auth/forgot-password', {
        method: 'POST',
        body: { email: 'ana@test.app' },
      });
      const code = forgot.body.devCode;
      const row = db.prepare('SELECT * FROM password_resets').get();
      assert.notEqual(row.code, code);
      assert.match(row.code, /^[a-f0-9]{64}$/);

      const wrongCode = code === '123456' ? '654321' : '123456';
      for (let i = 0; i < 5; i += 1) {
        const wrong = await api('/auth/reset-password', {
          method: 'POST',
          body: { email: 'ana@test.app', code: wrongCode, password: 'nova1234' },
        });
        assert.equal(wrong.status, 400);
      }
      const after5 = db.prepare('SELECT attempts, used FROM password_resets').get();
      assert.deepEqual({ ...after5 }, { attempts: 5, used: 1 });

      const right = await api('/auth/reset-password', {
        method: 'POST',
        body: { email: 'ana@test.app', code, password: 'nova1234' },
      });
      assert.equal(right.status, 400);
    });

    it('código vence com o tempo', async () => {
      await registerUser({ email: 'ana@test.app' });
      const forgot = await api('/auth/forgot-password', {
        method: 'POST',
        body: { email: 'ana@test.app' },
      });
      advanceClock((config.resetCodeTtlMinutes + 1) * 60000);
      const late = await api('/auth/reset-password', {
        method: 'POST',
        body: { email: 'ana@test.app', code: forgot.body.devCode, password: 'nova1234' },
      });
      assert.equal(late.status, 400);
      assert.equal(late.body.error, 'Código inválido ou expirado.');
    });

    it('devCode só aparece com EXPOSE_RESET_CODE=true; a resposta é igual com e sem conta', async () => {
      await registerUser({ email: 'ana@test.app' });
      const original = config.exposeResetCode;
      config.exposeResetCode = false;
      try {
        const known = await api('/auth/forgot-password', {
          method: 'POST',
          body: { email: 'ana@test.app' },
        });
        const unknown = await api('/auth/forgot-password', {
          method: 'POST',
          body: { email: 'ninguem@test.app' },
        });
        assert.equal(known.status, 200);
        assert.deepEqual(known.body, unknown.body);
        assert.equal(known.body.devCode, undefined);
      } finally {
        config.exposeResetCode = original;
      }
    });
  });

  describe('sessões', () => {
    it('redefinir a senha invalida os tokens antigos', async () => {
      const { token } = await registerUser({ email: 'ana@test.app', password: 'segredo123' });
      assert.equal((await api('/auth/me', { token })).status, 200);

      const forgot = await api('/auth/forgot-password', {
        method: 'POST',
        body: { email: 'ana@test.app' },
      });
      const reset = await api('/auth/reset-password', {
        method: 'POST',
        body: { email: 'ana@test.app', code: forgot.body.devCode, password: 'nova1234' },
      });
      assert.equal(reset.status, 200);

      const old = await api('/auth/me', { token });
      assert.equal(old.status, 401);
      assert.equal(old.body.error, 'Sessão expirada ou inválida.');
      const fresh = await login('ana@test.app', 'nova1234');
      assert.equal((await api('/auth/me', { token: fresh })).status, 200);
    });

    it('change-password pede a senha atual, troca e encerra as outras sessões', async () => {
      const { token } = await registerUser({ email: 'ana@test.app', password: 'segredo123' });
      const otherDevice = await login('ana@test.app', 'segredo123');
      const change = (body, auth = token) =>
        api('/auth/change-password', { method: 'POST', token: auth, body });

      assert.equal((await api('/auth/change-password', { method: 'POST', body: {} })).status, 401);
      const missing = await change({});
      assert.equal(missing.status, 400);
      assert.equal(missing.body.error, 'Informe a senha atual e a nova senha.');
      const wrong = await change({ currentPassword: 'errada', newPassword: 'nova1234' });
      assert.equal(wrong.status, 400);
      assert.equal(wrong.body.error, 'A senha atual está incorreta.');
      const short = await change({ currentPassword: 'segredo123', newPassword: '123' });
      assert.equal(short.status, 400);

      const ok = await change({ currentPassword: 'segredo123', newPassword: 'nova1234' });
      assert.equal(ok.status, 200);
      assert.equal(typeof ok.body.token, 'string');
      assert.equal(ok.body.user.email, 'ana@test.app');

      assert.equal((await api('/auth/me', { token })).status, 401);
      assert.equal((await api('/auth/me', { token: otherDevice })).status, 401);
      assert.equal((await api('/auth/me', { token: ok.body.token })).status, 200);
      const oldPassword = await api('/auth/login', {
        method: 'POST',
        body: { email: 'ana@test.app', password: 'segredo123' },
      });
      assert.equal(oldPassword.status, 401);
      assert.equal(typeof (await login('ana@test.app', 'nova1234')), 'string');
    });
  });

  describe('validação do cadastro', () => {
    it('recusa nome, e-mail e senha inválidos', async () => {
      const register = (body) => api('/auth/register', { method: 'POST', body });
      const cases = [
        [{ name: '   ', email: 'a@b.co', password: '123456' }, 'Nome, e-mail e senha são obrigatórios.'],
        [{ name: { a: 1 }, email: 'a@b.co', password: '123456' }, 'Nome, e-mail e senha são obrigatórios.'],
        [{ name: 'A', email: 'a@b.co', password: '123456' }, 'Informe um nome com 2 a 80 caracteres.'],
        [{ name: 'x'.repeat(81), email: 'a@b.co', password: '123456' }, 'Informe um nome com 2 a 80 caracteres.'],
        [{ name: 'Ana', email: 'nao-e-email', password: '123456' }, 'Informe um e-mail válido.'],
        [{ name: 'Ana', email: `${'a'.repeat(115)}@b.com`, password: '123456' }, 'Informe um e-mail válido.'],
        [{ name: 'Ana', email: 'a@b.co', password: '12345' }, 'A senha deve ter pelo menos 6 caracteres.'],
        [{ name: 'Ana', email: 'a@b.co', password: 'x'.repeat(201) }, 'A senha deve ter no máximo 200 caracteres.'],
        [{ name: 'Ana', email: 'a@b.co', password: 123456 }, 'Nome, e-mail e senha são obrigatórios.'],
        [{ name: 'Ana', email: 'a@b.co', password: '123456', neighborhood: 'x'.repeat(81) }, 'O bairro deve ter no máximo 80 caracteres.'],
        [{ name: 'Ana', email: 'a@b.co', password: '123456', cep: '1501511' }, 'Informe um CEP com 8 dígitos.'],
      ];
      for (const [body, message] of cases) {
        const response = await register(body);
        assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
        assert.equal(response.body.error, message);
      }
      assert.equal(db.prepare('SELECT COUNT(*) AS total FROM users').get().total, 0);
    });
  });

  describe('corpo da requisição', () => {
    it('JSON inválido → 400; corpo grande demais → 413', async () => {
      const broken = await api('/auth/login', { method: 'POST', rawBody: '{"email": ' });
      assert.equal(broken.status, 400);
      assert.equal(broken.body.error, 'O corpo da requisição não é um JSON válido.');

      const huge = await api('/auth/register', {
        method: 'POST',
        rawBody: JSON.stringify({ name: 'x'.repeat(1024 * 1024 + 10) }),
      });
      assert.equal(huge.status, 413);
      assert.equal(huge.body.error, 'O corpo da requisição é grande demais.');
    });

    it('rota inexistente → 404 em JSON', async () => {
      const response = await api('/nao-existe');
      assert.equal(response.status, 404);
      assert.equal(response.body.error, 'Rota não encontrada.');
    });
  });
});
