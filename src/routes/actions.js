const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const {
  actionFromRow,
  recordFromRow,
  createNotification,
} = require('../services/serializers');
const { getSummary, getAchievements } = require('../services/progress');

const router = express.Router();

router.use(authRequired);

router.get('/', (req, res) => {
  const { category, search, sort } = req.query;
  let rows = db.prepare('SELECT * FROM actions').all();

  if (category && category !== 'all') {
    const normalized = String(category).toLowerCase();
    rows = rows.filter(
      (row) =>
        row.category.toLowerCase() === normalized ||
        row.category_label.toLowerCase() === normalized,
    );
  }

  if (search) {
    const term = String(search).toLowerCase();
    rows = rows.filter((row) => {
      const tags = JSON.parse(row.tags || '[]');
      return (
        row.title.toLowerCase().includes(term) ||
        row.description.toLowerCase().includes(term) ||
        tags.some((tag) => String(tag).toLowerCase().includes(term))
      );
    });
  }

  const actions = rows.map(actionFromRow);

  if (sort === 'points') {
    actions.sort((a, b) => b.points - a.points);
  } else if (sort === 'alphabetical') {
    actions.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  } else {
    actions.sort((a, b) => a.id - b.id);
  }

  return res.json({ actions });
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM actions WHERE id = ?').get(req.params.id);
  if (!row) {
    return res.status(404).json({ error: 'Ação não encontrada.' });
  }
  return res.json({ action: actionFromRow(row) });
});

router.post('/:id/records', (req, res) => {
  const row = db.prepare('SELECT * FROM actions WHERE id = ?').get(req.params.id);
  if (!row) {
    return res.status(404).json({ error: 'Ação não encontrada.' });
  }

  const quantity = Math.min(Math.max(Number(req.body?.quantity) || 1, 1), 50);
  const notes = req.body?.notes ? String(req.body.notes).trim().slice(0, 500) : null;
  const action = actionFromRow(row);
  const points = action.points * quantity;
  const liters = action.liters * quantity;

  const previous = new Set(
    getAchievements(req.user.id)
      .filter((achievement) => achievement.isUnlocked)
      .map((achievement) => achievement.title),
  );

  const created = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO action_records
        (user_id, action_id, title, category_label, icon, points, liters, quantity, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      req.user.id,
      action.id,
      action.title,
      action.categoryLabel,
      action.icon,
      points,
      liters,
      quantity,
      notes,
      created,
    );

  const record = recordFromRow(
    db.prepare('SELECT * FROM action_records WHERE id = ?').get(info.lastInsertRowid),
  );

  createNotification(
    req.user.id,
    'sistema',
    'Ação registrada!',
    `Você registrou "${action.title}" e ganhou +${points} pontos.`,
  );

  const achievements = getAchievements(req.user.id);
  const newAchievements = achievements.filter(
    (achievement) => achievement.isUnlocked && !previous.has(achievement.title),
  );
  for (const achievement of newAchievements) {
    createNotification(
      req.user.id,
      'conquista',
      'Novo selo desbloqueado!',
      `Você conquistou o selo "${achievement.title}".`,
    );
  }

  return res.status(201).json({
    record,
    summary: getSummary(req.user.id),
    achievements,
    newAchievements,
  });
});

module.exports = router;
