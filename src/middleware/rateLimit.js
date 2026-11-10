// Limitador de requisições em memória, sem dependências.
//
// Usado nas rotas sensíveis de autenticação (cadastro, login, recuperação e
// troca de senha) e na conferência do cupom. Conta requisições por chave
// (IP + e-mail) e também por IP, numa janela fixa. Por ficar na memória do
// processo, vale para uma instância só da API e zera quando ela reinicia
// (suficiente para este projeto; com várias instâncias seria preciso um
// armazenamento compartilhado).
//
// A memória usada tem teto: cada contador guarda só chaves curtas (o e-mail
// entra como hash SHA-256, nunca o texto enviado) e o número de chaves é
// limitado (`MAX_ENTRIES`); cheio, saem primeiro as vencidas e depois as mais
// antigas.

const crypto = require('node:crypto');
const config = require('../config');

const limiters = new Set();

const TOO_MANY = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';

/** Chaves guardadas, no máximo, por contador. */
const MAX_ENTRIES = 10000;

function createLimiter({ max, windowMs, maxEntries = MAX_ENTRIES }) {
  const hits = new Map();

  function current(key, now) {
    const entry = hits.get(key);
    if (entry && entry.resetAt <= now) {
      hits.delete(key);
      return null;
    }
    return entry || null;
  }

  /** Abre espaço para uma chave nova: tira as vencidas e, se preciso, as mais antigas. */
  function makeRoom(now) {
    if (hits.size < maxEntries) return;
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
    // O Map guarda a ordem de inserção: as primeiras chaves são as mais antigas.
    for (const key of hits.keys()) {
      if (hits.size < maxEntries) break;
      hits.delete(key);
    }
  }

  function waitOf(entry, now) {
    return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  }

  const limiter = {
    /** Conta uma tentativa; devolve quantos segundos esperar se passou do limite. */
    hit(key) {
      const now = Date.now();
      let entry = current(key, now);
      if (!entry) {
        makeRoom(now);
        entry = { count: 0, resetAt: now + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      return entry.count > max ? waitOf(entry, now) : 0;
    },
    /** Sem contar nada: quantos segundos esperar se o limite já foi atingido. */
    peek(key) {
      const now = Date.now();
      const entry = current(key, now);
      return entry && entry.count >= max ? waitOf(entry, now) : 0;
    },
    get size() {
      return hits.size;
    },
    keys() {
      return [...hits.keys()];
    },
    reset() {
      hits.clear();
    },
  };
  limiters.add(limiter);
  return limiter;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Middleware que limita a rota por IP (`max × 5`, para quem troca de e-mail a
 * cada tentativa) e por IP + e-mail (`max` tentativas na janela).
 * `keyOf(req)` diz qual e-mail (ou outra identificação) usar.
 *
 * O limite por IP é conferido primeiro: passou dele, a resposta é 429 sem
 * criar contador para o e-mail.
 */
function rateLimit(name, keyOf = (req) => req.body?.email) {
  const windowMs = config.authRateLimitWindowMinutes * 60 * 1000;
  const byKey = createLimiter({ max: config.authRateLimitMax, windowMs });
  const byIp = createLimiter({ max: config.authRateLimitMax * 5, windowMs });

  function tooMany(res, wait) {
    res.set('Retry-After', String(wait));
    return res.status(429).json({ error: TOO_MANY });
  }

  const middleware = (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'desconhecido';
    const waitIp = byIp.hit(`${name}|${ip}`);
    if (waitIp > 0) return tooMany(res, waitIp);

    const who = String(keyOf(req) ?? '').trim().toLowerCase();
    const waitKey = byKey.hit(`${name}|${ip}|${sha256(who)}`);
    if (waitKey > 0) return tooMany(res, waitKey);
    return next();
  };
  middleware.limiters = { byKey, byIp };
  return middleware;
}

/** Zera todos os contadores (usado pelos testes). */
function resetRateLimits() {
  for (const limiter of limiters) limiter.reset();
}

module.exports = { rateLimit, createLimiter, resetRateLimits, TOO_MANY, MAX_ENTRIES };
