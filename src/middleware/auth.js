const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

const INVALID_SESSION = 'Sessão expirada ou inválida.';

/**
 * Token da sessão. `ver` é a versão de sessão do usuário: trocar ou redefinir
 * a senha incrementa `users.token_version` e invalida os tokens antigos.
 */
function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, ver: user.token_version ?? 0 },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

function readToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

function authRequired(req, res, next) {
  const token = readToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Autenticação necessária.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: INVALID_SESSION });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
  if (!user || (payload.ver ?? 0) !== (user.token_version ?? 0)) {
    return res.status(401).json({ error: INVALID_SESSION });
  }
  req.user = user;
  return next();
}

module.exports = { signToken, authRequired };
