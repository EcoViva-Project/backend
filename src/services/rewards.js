// Recompensas de parceiros e cupons (resgate, validade e conferência).
//
// Espelha a seção "Recompensas e cupons" de `eco-app/lib/core/local/local_api.dart`.

const crypto = require('node:crypto');
const db = require('../db');
const clock = require('./clock');
const economy = require('./economy');
const { fail } = require('./errors');
const { notify } = require('./notifications');
const { summary } = require('./progress');
const { iso, int, flag, clean, parseDate } = require('./util');

/** Janela, em dias, do limite de resgates por pessoa. */
const REDEEM_LIMIT_WINDOW_DAYS = 30;

function findPartner(id) {
  return db.prepare('SELECT * FROM partners WHERE id = ?').get(id) || null;
}

function findReward(id) {
  return db.prepare('SELECT * FROM rewards WHERE id = ?').get(id) || null;
}

function requireReward(id) {
  const row = findReward(id);
  if (!row || !flag(row.active)) fail(404, 'Recompensa não encontrada.');
  return row;
}

/** Resgates da pessoa nesta recompensa nos últimos 30 dias. */
function recentRedemptions(userId, reward) {
  const since = clock.now().getTime() - REDEEM_LIMIT_WINDOW_DAYS * economy.DAY_MS;
  return db
    .prepare('SELECT created_at FROM redemptions WHERE user_id = ? AND reward_id = ?')
    .all(userId, reward.id)
    .filter((row) => {
      const created = parseDate(row.created_at);
      return created !== null && created.getTime() > since;
    }).length;
}

function rewardJson(row, user, partner = findPartner(row.partner_id)) {
  const limit = row.per_user_limit ?? null;
  const mine = recentRedemptions(user.id, row);
  return {
    id: row.id,
    partnerId: row.partner_id,
    partnerName: partner?.name ?? '',
    partnerDescription: partner?.description ?? null,
    partnerIcon: partner?.logo_icon ?? 'storefront',
    partnerAddress: partner?.address ?? null,
    title: row.title,
    description: row.description,
    category: row.category,
    categoryLabel: row.category_label,
    icon: row.icon,
    pointsCost: row.points_cost,
    valueCents: row.value_cents,
    stock: row.stock,
    terms: row.terms,
    validityDays: row.validity_days,
    perUserLimit: limit,
    redeemedByMe: mine,
    limitReached: limit !== null && mine >= limit,
    isFeatured: flag(row.is_featured),
    available: int(row.stock) > 0,
    createdAt: row.created_at,
  };
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Recompensas ativas: destaques primeiro, depois as mais baratas (como no
 * app). Filtros opcionais da API: `category`, `search` e `sort`.
 */
function listRewards(user, { category, search, sort } = {}) {
  const partners = new Map(db.prepare('SELECT * FROM partners').all().map((p) => [p.id, p]));
  let rows = db.prepare('SELECT * FROM rewards WHERE active = 1 ORDER BY id').all();

  if (category && category !== 'all') {
    const wanted = normalizeText(category);
    rows = rows.filter(
      (row) => normalizeText(row.category) === wanted || normalizeText(row.category_label) === wanted,
    );
  }
  if (search) {
    const term = normalizeText(search);
    rows = rows.filter(
      (row) =>
        normalizeText(row.title).includes(term) ||
        normalizeText(row.description).includes(term) ||
        normalizeText(partners.get(row.partner_id)?.name).includes(term),
    );
  }

  const rewards = rows.map((row) => rewardJson(row, user, partners.get(row.partner_id)));
  if (sort === 'points') {
    rewards.sort((a, b) => a.pointsCost - b.pointsCost);
  } else if (sort === 'points_desc') {
    rewards.sort((a, b) => b.pointsCost - a.pointsCost);
  } else if (sort === 'alphabetical') {
    rewards.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  } else {
    rewards.sort(
      (a, b) => Number(b.isFeatured) - Number(a.isFeatured) || a.pointsCost - b.pointsCost,
    );
  }
  return rewards;
}

/** Situação calculada do cupom: `used`, `expired` ou `active`. */
function redemptionStatus(row) {
  if (row.used_at !== null && row.used_at !== undefined) return 'used';
  const expires = parseDate(row.expires_at);
  if (expires && clock.now().getTime() >= expires.getTime()) return 'expired';
  return 'active';
}

function redemptionJson(row) {
  const reward = findReward(row.reward_id);
  const partner = reward ? findPartner(reward.partner_id) : null;
  return {
    id: row.id,
    rewardId: row.reward_id,
    rewardTitle: reward?.title ?? '',
    rewardDescription: reward?.description ?? null,
    partnerName: partner?.name ?? '',
    partnerAddress: partner?.address ?? null,
    icon: reward?.icon ?? 'redeem',
    code: row.code,
    pointsSpent: row.points_spent,
    valueCents: reward?.value_cents ?? 0,
    terms: reward?.terms ?? null,
    status: redemptionStatus(row),
    dateTime: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at ?? null,
  };
}

function findRedemption(id) {
  return db.prepare('SELECT * FROM redemptions WHERE id = ?').get(id) || null;
}

function listRedemptions(user) {
  return db
    .prepare('SELECT * FROM redemptions WHERE user_id = ? ORDER BY created_at DESC, id DESC')
    .all(user.id)
    .map(redemptionJson);
}

function newCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = `ECO-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    if (!db.prepare('SELECT 1 FROM redemptions WHERE code = ?').get(code)) return code;
  }
  return fail(500, 'Não foi possível gerar o código de resgate.');
}

/**
 * Resgata uma recompensa (dentro de uma transação). Devolve a linha do cupom.
 * `at` e `silent` existem para a carga dos dados de demonstração.
 */
function redeemReward(user, reward, { at = null, silent = false } = {}) {
  return db.transaction(() => {
    const when = at ?? clock.now();
    const current = findReward(reward.id);
    if (int(current.stock) <= 0) fail(409, 'Esta recompensa está esgotada.');
    const limit = current.per_user_limit ?? null;
    if (limit !== null && recentRedemptions(user.id, current) >= limit) {
      fail(
        409,
        `Você já resgatou esta recompensa ${limit} ${limit === 1 ? 'vez' : 'vezes'} nos últimos ${REDEEM_LIMIT_WINDOW_DAYS} dias.`,
      );
    }
    const balance = summary(user).points;
    const cost = int(current.points_cost);
    if (balance < cost) {
      fail(409, `Pontos insuficientes. Você tem ${balance} e esta recompensa custa ${cost}.`);
    }

    db.prepare('UPDATE rewards SET stock = stock - 1 WHERE id = ?').run(current.id);
    const code = newCode();
    const validity = Math.max(1, int(current.validity_days, 30));
    const info = db
      .prepare(
        `INSERT INTO redemptions (user_id, reward_id, code, points_spent, created_at, expires_at, used_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        user.id,
        current.id,
        code,
        cost,
        iso(when),
        iso(new Date(when.getTime() + validity * economy.DAY_MS)),
      );
    if (!silent) {
      const partner = findPartner(current.partner_id);
      notify(
        user.id,
        'recompensa',
        'Resgate confirmado!',
        `Você resgatou "${current.title}" com ${partner?.name ?? 'o parceiro'}. Código: ${code}.`,
        { target: '/recompensas', at: when },
      );
    }
    return findRedemption(info.lastInsertRowid);
  })();
}

/** Marca o cupom como usado. */
function markRedemptionUsed(redemption, { at = null } = {}) {
  db.prepare('UPDATE redemptions SET used_at = ? WHERE id = ?').run(
    iso(at ?? clock.now()),
    redemption.id,
  );
  return findRedemption(redemption.id);
}

/**
 * Conferência do cupom no balcão: o atendente digita o código (PIN) do
 * parceiro no aparelho de quem resgatou.
 */
function useRedemption(user, id, data) {
  const redemption = findRedemption(id);
  if (!redemption || redemption.user_id !== user.id) fail(404, 'Cupom não encontrado.');
  const status = redemptionStatus(redemption);
  if (status === 'used') fail(409, 'Este cupom já foi utilizado.');
  if (status === 'expired') fail(409, 'Este cupom está vencido.');

  const reward = findReward(redemption.reward_id);
  const partner = reward ? findPartner(reward.partner_id) : null;
  const pin = clean(data.pin);
  if (!partner || !pin || !partner.pin || pin !== String(partner.pin)) {
    fail(403, 'Código do parceiro incorreto.');
  }

  const used = markRedemptionUsed(redemption);
  notify(
    user.id,
    'recompensa',
    'Cupom utilizado',
    `O cupom ${redemption.code} foi conferido por ${partner.name}. Bom proveito!`,
    { target: '/recompensas' },
  );
  return redemptionJson(used);
}

module.exports = {
  REDEEM_LIMIT_WINDOW_DAYS,
  requireReward,
  rewardJson,
  listRewards,
  redemptionStatus,
  redemptionJson,
  listRedemptions,
  redeemReward,
  markRedemptionUsed,
  useRedemption,
};
