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
// antigas que não estão bloqueadas (cheio só de bloqueios, chave nova espera).
// IPv6 conta pela rede /64.

const crypto = require('node:crypto');
const net = require('node:net');
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

  function blocked(entry) {
    return entry.count >= max;
  }

  /**
   * Abre espaço para uma chave nova: tira as vencidas e, se preciso, as mais
   * antigas que não estão bloqueadas. Um bloqueio nunca sai antes de vencer
   * (senão quem inunda o limitador com chaves novas zeraria os próprios
   * bloqueios). Devolve `false` se não deu para abrir espaço.
   */
  function makeRoom(now) {
    if (hits.size < maxEntries) return true;
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
    // O Map guarda a ordem de inserção: as primeiras chaves são as mais antigas.
    for (const [key, entry] of hits) {
      if (hits.size < maxEntries) break;
      if (!blocked(entry)) hits.delete(key);
    }
    return hits.size < maxEntries;
  }

  /** Cheio só de bloqueios ainda válidos: nenhuma chave nova cabe. */
  function saturated(now) {
    if (hits.size < maxEntries) return false;
    for (const entry of hits.values()) {
      if (entry.resetAt <= now || !blocked(entry)) return false;
    }
    return true;
  }

  /** Espera até o primeiro bloqueio vencer (para chaves novas com o limitador cheio). */
  function saturatedWait(now) {
    let first = Infinity;
    for (const entry of hits.values()) first = Math.min(first, entry.resetAt);
    return waitOf({ resetAt: first }, now);
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
        // Cheio de bloqueios: a chave nova espera, sem apagar nenhum bloqueio.
        if (!makeRoom(now)) return saturatedWait(now);
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
      if (!entry) return saturated(now) ? saturatedWait(now) : 0;
      return blocked(entry) ? waitOf(entry, now) : 0;
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

/** Os 8 grupos de 16 bits de um endereço IPv6 (com `::` expandido). */
function ipv6Groups(address) {
  let text = address.split('%')[0].toLowerCase();
  const v4 = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    text = `${text.slice(0, -v4[0].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const first = head ? head.split(':') : [];
  if (tail === undefined) return first.map((group) => Number.parseInt(group, 16));
  const last = tail ? tail.split(':') : [];
  const zeros = Array(8 - first.length - last.length).fill('0');
  return [...first, ...zeros, ...last].map((group) => Number.parseInt(group, 16));
}

/**
 * Chave do IP para o limitador. Um endereço IPv6 conta pela rede /64 (quem
 * tem uma /64 dispõe de 2^64 endereços e ganharia contadores sem fim); IPv4
 * escrito como IPv6 (`::ffff:1.2.3.4`) conta como o IPv4.
 */
function ipKey(ip) {
  const address = String(ip);
  if (!net.isIPv6(address.split('%')[0])) return address;
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];
  const network = ipv6Groups(address)
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':');
  return `${network}::/64`;
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
    const ip = ipKey(req.ip || req.socket?.remoteAddress || 'desconhecido');
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

module.exports = { rateLimit, createLimiter, resetRateLimits, ipKey, TOO_MANY, MAX_ENTRIES };
