const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
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

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user) {
      return res.status(401).json({ error: 'Sessão inválida.' });
    }
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: 'Sessão expirada ou inválida.' });
  }
}

module.exports = { signToken, authRequired };
