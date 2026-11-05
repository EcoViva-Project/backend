const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const { signToken, authRequired } = require('../middleware/auth');
const { publicUser, createNotification } = require('../services/serializers');

const router = express.Router();

function initialsFor(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'EC';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

router.post('/register', (req, res) => {
  const { name, email, password, neighborhood } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalizedEmail);
  if (exists) {
    return res.status(409).json({ error: 'Já existe uma conta com este e-mail.' });
  }

  const info = db
    .prepare(
      `INSERT INTO users (name, email, password_hash, neighborhood, initials, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      String(name).trim(),
      normalizedEmail,
      bcrypt.hashSync(String(password), 10),
      neighborhood ? String(neighborhood).trim() : 'Jardim das Flores',
      initialsFor(name),
      new Date().toISOString(),
    );

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  createNotification(
    user.id,
    'sistema',
    'Bem-vinda ao Eco!',
    'Sua conta foi criada. Registre sua primeira ação sustentável e comece a somar pontos.',
  );

  return res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Informe e-mail e senha.' });
  }

  const user = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(String(email).trim().toLowerCase());

  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  }

  return res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', authRequired, (req, res) => {
  return res.json({ user: publicUser(req.user) });
});

router.post('/forgot-password', (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: 'Informe o e-mail da conta.' });
  }

  const user = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(String(email).trim().toLowerCase());

  const genericMessage =
    'Se existir uma conta com este e-mail, enviaremos as instruções de recuperação.';

  if (!user) {
    return res.json({ message: genericMessage });
  }

  db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0').run(user.id);

  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + config.resetCodeTtlMinutes * 60000).toISOString();
  db.prepare(
    'INSERT INTO password_resets (user_id, code, expires_at, used) VALUES (?, ?, ?, 0)',
  ).run(user.id, code, expiresAt);

  const response = {
    message: genericMessage,
    expiresInMinutes: config.resetCodeTtlMinutes,
  };
  // Em desenvolvimento (sem provedor de e-mail), devolvemos o código para teste.
  if (process.env.NODE_ENV !== 'production') {
    response.devCode = code;
  }
  return res.json(response);
});

router.post('/reset-password', (req, res) => {
  const { email, code, password } = req.body || {};
  if (!email || !code || !password) {
    return res.status(400).json({ error: 'Informe e-mail, código e nova senha.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  }

  const user = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(String(email).trim().toLowerCase());
  if (!user) {
    return res.status(400).json({ error: 'Código inválido ou expirado.' });
  }

  const reset = db
    .prepare(
      `SELECT * FROM password_resets
       WHERE user_id = ? AND code = ? AND used = 0
       ORDER BY id DESC LIMIT 1`,
    )
    .get(user.id, String(code).trim());

  if (!reset || new Date(reset.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'Código inválido ou expirado.' });
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    bcrypt.hashSync(String(password), 10),
    user.id,
  );
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(reset.id);

  return res.json({ message: 'Senha redefinida com sucesso.' });
});

module.exports = router;
