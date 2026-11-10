const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const clock = require('../services/clock');
const { sha256 } = require('../migrations');
const { signToken, authRequired } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { fail, bodyOf } = require('../services/errors');
const { notify } = require('../services/notifications');
const { iso, int, clean } = require('../services/util');
const {
  findUser,
  findUserByEmail,
  hashPassword,
  publicUser,
  createUser,
} = require('../services/users');
const {
  passwordOf,
  validateName,
  validateEmail,
  validatePassword,
  addressFrom,
} = require('../services/validation');

const router = express.Router();

/** Tentativas erradas que invalidam um código de recuperação. */
const MAX_RESET_ATTEMPTS = 5;

const FORGOT_MESSAGE =
  'Se existir uma conta com este e-mail, enviaremos as instruções de recuperação.';

function sameHash(a, b) {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));
  return first.length === second.length && crypto.timingSafeEqual(first, second);
}

/**
 * Hash para comparar a senha mesmo quando o e-mail não existe. Usa o mesmo
 * custo (`BCRYPT_ROUNDS`) das senhas de verdade: com custo menor, a resposta
 * para um e-mail sem conta seria mais rápida e revelaria quais e-mails existem.
 * Refeito só se o custo configurado mudar.
 */
let dummy = null;
function dummyHash() {
  if (!dummy || dummy.rounds !== config.bcryptRounds) {
    dummy = {
      rounds: config.bcryptRounds,
      hash: bcrypt.hashSync('eco-senha-inexistente', config.bcryptRounds),
    };
  }
  return dummy.hash;
}
dummyHash();

router.post('/register', rateLimit('register'), (req, res) => {
  const data = bodyOf(req);
  const name = clean(data.name);
  const email = clean(data.email).toLowerCase();
  const password = passwordOf(data.password);

  if (!name || !email || !password) fail(400, 'Nome, e-mail e senha são obrigatórios.');
  validateName(name);
  validateEmail(email);
  validatePassword(password);
  if (findUserByEmail(email)) fail(409, 'Já existe uma conta com este e-mail.');

  const address = addressFrom(data);
  const user = createUser({ name, email, password, ...address });
  notify(
    user.id,
    'sistema',
    'Boas-vindas ao EcoViva!',
    'Sua conta foi criada. Registre sua primeira ação sustentável e comece a somar pontos.',
    { target: '/acoes' },
  );
  return res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post('/login', rateLimit('login'), (req, res) => {
  const data = bodyOf(req);
  const email = clean(data.email);
  const password = passwordOf(data.password);
  if (!email || !password) fail(400, 'Informe e-mail e senha.');

  const user = findUserByEmail(email);
  const valid = bcrypt.compareSync(password, user ? user.password_hash : dummyHash());
  if (!user || !valid) fail(401, 'E-mail ou senha inválidos.');

  return res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', authRequired, (req, res) => {
  return res.json({ user: publicUser(req.user) });
});

router.post('/forgot-password', rateLimit('forgot-password'), (req, res) => {
  const email = clean(bodyOf(req).email);
  if (!email) fail(400, 'Informe o e-mail da conta.');

  // Mesma resposta para e-mail com e sem conta.
  const response = { message: FORGOT_MESSAGE, expiresInMinutes: config.resetCodeTtlMinutes };
  const user = findUserByEmail(email);
  if (!user) return res.json(response);

  const code = String(crypto.randomInt(100000, 1000000));
  db.transaction(() => {
    db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0').run(user.id);
    db.prepare(
      `INSERT INTO password_resets (user_id, code, expires_at, attempts, used)
       VALUES (?, ?, ?, 0, 0)`,
    ).run(
      user.id,
      sha256(code),
      iso(new Date(clock.now().getTime() + config.resetCodeTtlMinutes * 60000)),
    );
  })();

  // Não há envio de e-mail ainda. Só com EXPOSE_RESET_CODE=true (proibido em
  // produção) o código volta na resposta, para testes e demonstração.
  if (config.exposeResetCode) response.devCode = code;
  return res.json(response);
});

router.post('/reset-password', rateLimit('reset-password'), (req, res) => {
  const data = bodyOf(req);
  const email = clean(data.email);
  const code = clean(data.code);
  const password = passwordOf(data.password);
  if (!email || !code || !password) fail(400, 'Informe e-mail, código e nova senha.');
  validatePassword(password);

  const user = findUserByEmail(email);
  const reset = user
    ? db
        .prepare(
          `SELECT * FROM password_resets WHERE user_id = ? AND used = 0
           ORDER BY id DESC LIMIT 1`,
        )
        .get(user.id)
    : null;
  const expired =
    !reset || new Date(reset.expires_at).getTime() < clock.now().getTime();
  if (!user || !reset || expired) fail(400, 'Código inválido ou expirado.');

  if (!sameHash(reset.code, sha256(code))) {
    const attempts = int(reset.attempts) + 1;
    db.prepare('UPDATE password_resets SET attempts = ?, used = ? WHERE id = ?').run(
      attempts,
      attempts >= MAX_RESET_ATTEMPTS ? 1 : 0,
      reset.id,
    );
    fail(400, 'Código inválido ou expirado.');
  }

  db.transaction(() => {
    // Nova senha e nova versão de sessão: os tokens antigos deixam de valer.
    db.prepare(
      'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
    ).run(hashPassword(password), user.id);
    db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(reset.id);
  })();

  return res.json({ message: 'Senha redefinida com sucesso.' });
});

router.post(
  '/change-password',
  authRequired,
  rateLimit('change-password', (req) => `usuario-${req.user.id}`),
  (req, res) => {
    const data = bodyOf(req);
    const currentPassword = passwordOf(data.currentPassword);
    const newPassword = passwordOf(data.newPassword);
    if (!currentPassword || !newPassword) fail(400, 'Informe a senha atual e a nova senha.');
    validatePassword(newPassword);
    if (!bcrypt.compareSync(currentPassword, req.user.password_hash)) {
      fail(400, 'A senha atual está incorreta.');
    }

    // Encerra as outras sessões e devolve um token novo para este aparelho.
    db.prepare(
      'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
    ).run(hashPassword(newPassword), req.user.id);
    const user = findUser(req.user.id);
    return res.json({
      message: 'Senha alterada com sucesso.',
      token: signToken(user),
      user: publicUser(user),
    });
  },
);

module.exports = router;
module.exports.dummyHash = dummyHash;
