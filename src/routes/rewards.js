const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const {
  rewardFromRow,
  redemptionFromRow,
  createNotification,
} = require('../services/serializers');
const { getSummary } = require('../services/progress');

const router = express.Router();

router.use(authRequired);

const REWARD_QUERY = `
  SELECT r.*, p.name AS partner_name, p.description AS partner_description,
         p.logo_icon AS partner_icon
  FROM rewards r
  JOIN partners p ON p.id = r.partner_id
`;

function loadReward(id) {
  return db
    .prepare(`${REWARD_QUERY} WHERE r.id = ? AND r.active = 1`)
    .get(id);
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function listRewards({ category, search, sort } = {}) {
  let rows = db
    .prepare(`${REWARD_QUERY} WHERE r.active = 1`)
    .all();

  if (category && category !== 'all') {
    const normalized = normalizeText(category);
    rows = rows.filter(
      (row) =>
        normalizeText(row.category) === normalized ||
        normalizeText(row.category_label) === normalized,
    );
  }

  if (search) {
    const term = normalizeText(search);
    rows = rows.filter(
      (row) =>
        normalizeText(row.title).includes(term) ||
        normalizeText(row.description).includes(term) ||
        normalizeText(row.partner_name).includes(term),
    );
  }

  const rewards = rows.map(rewardFromRow);

  if (sort === 'points') {
    rewards.sort((a, b) => a.pointsCost - b.pointsCost);
  } else if (sort === 'points_desc') {
    rewards.sort((a, b) => b.pointsCost - a.pointsCost);
  } else if (sort === 'alphabetical') {
    rewards.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  } else {
    rewards.sort(
      (a, b) =>
        Number(b.isFeatured) - Number(a.isFeatured) || a.pointsCost - b.pointsCost,
    );
  }

  return rewards;
}

function generateCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = `ECO-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const exists = db.prepare('SELECT 1 FROM redemptions WHERE code = ?').get(code);
    if (!exists) return code;
  }
  throw new Error('Não foi possível gerar o código de resgate.');
}

router.get('/', (req, res) => {
  return res.json({ rewards: listRewards(req.query) });
});

router.get('/redemptions', (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, w.title AS reward_title, w.icon AS reward_icon,
              p.name AS partner_name
       FROM redemptions r
       JOIN rewards w ON w.id = r.reward_id
       JOIN partners p ON p.id = w.partner_id
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC, r.id DESC`,
    )
    .all(req.user.id);

  return res.json({
    redemptions: rows.map(redemptionFromRow),
    summary: getSummary(req.user.id),
  });
});

router.get('/:id', (req, res) => {
  const row = loadReward(req.params.id);
  if (!row) {
    return res.status(404).json({ error: 'Recompensa não encontrada.' });
  }
  return res.json({ reward: rewardFromRow(row) });
});

router.post('/:id/redeem', (req, res) => {
  const result = db.transaction(() => {
    const row = loadReward(req.params.id);
    if (!row) {
      return { status: 404, error: 'Recompensa não encontrada.' };
    }
    if (row.stock <= 0) {
      return { status: 409, error: 'Esta recompensa está esgotada.' };
    }

    const summary = getSummary(req.user.id);
    if (summary.points < row.points_cost) {
      return {
        status: 409,
        error: `Pontos insuficientes. Você tem ${summary.points} e esta recompensa custa ${row.points_cost}.`,
      };
    }

    db.prepare('UPDATE rewards SET stock = stock - 1 WHERE id = ?').run(row.id);

    const code = generateCode();
    const created = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO redemptions (user_id, reward_id, code, points_spent, status, created_at)
         VALUES (?, ?, ?, ?, 'active', ?)`,
      )
      .run(req.user.id, row.id, code, row.points_cost, created);

    createNotification(
      req.user.id,
      'sistema',
      'Resgate confirmado!',
      `Você resgatou "${row.title}" com ${row.partner_name}. Código: ${code}.`,
    );

    const redemption = db
      .prepare(
        `SELECT r.*, w.title AS reward_title, w.icon AS reward_icon,
                p.name AS partner_name
         FROM redemptions r
         JOIN rewards w ON w.id = r.reward_id
         JOIN partners p ON p.id = w.partner_id
         WHERE r.id = ?`,
      )
      .get(info.lastInsertRowid);

    return {
      redemption: redemptionFromRow(redemption),
      reward: rewardFromRow(loadReward(row.id)),
      summary: getSummary(req.user.id),
    };
  })();

  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.status(201).json(result);
});

module.exports = router;
