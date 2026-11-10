// Limitador de requisições em memória, sem dependências.
//
// Usado nas rotas sensíveis de autenticação (login, recuperação e troca de
// senha). Conta requisições por chave (IP + e-mail) e também por IP, numa
// janela fixa. Por ficar na memória do processo, vale para uma instância só da
// API e zera quando ela reinicia (suficiente para este projeto; com várias
// instâncias seria preciso um armazenamento compartilhado).

const config = require('../config');

const limiters = new Set();

const TOO_MANY = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';

function createLimiter({ max, windowMs }) {
  const hits = new Map();

  function prune(now) {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }

  const limiter = {
    /** Conta uma tentativa; devolve quantos segundos esperar se passou do limite. */
    hit(key) {
      const now = Date.now();
      if (hits.size > 10000) prune(now);
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      return entry.count > max ? Math.ceil((entry.resetAt - now) / 1000) : 0;
    },
    reset() {
      hits.clear();
    },
  };
  limiters.add(limiter);
  return limiter;
}

/**
 * Middleware que limita a rota por IP + e-mail (`max` tentativas na janela) e
 * por IP (`max × 5`, para quem troca de e-mail a cada tentativa).
 * `keyOf(req)` diz qual e-mail (ou outra identificação) usar.
 */
function rateLimit(name, keyOf = (req) => req.body?.email) {
  const windowMs = config.authRateLimitWindowMinutes * 60 * 1000;
  const byKey = createLimiter({ max: config.authRateLimitMax, windowMs });
  const byIp = createLimiter({ max: config.authRateLimitMax * 5, windowMs });

  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'desconhecido';
    const who = String(keyOf(req) ?? '').trim().toLowerCase();
    const waitKey = byKey.hit(`${name}|${ip}|${who}`);
    const waitIp = byIp.hit(`${name}|${ip}`);
    const wait = Math.max(waitKey, waitIp);
    if (wait > 0) {
      res.set('Retry-After', String(wait));
      return res.status(429).json({ error: TOO_MANY });
    }
    return next();
  };
}

/** Zera todos os contadores (usado pelos testes). */
function resetRateLimits() {
  for (const limiter of limiters) limiter.reset();
}

module.exports = { rateLimit, resetRateLimits, TOO_MANY };
