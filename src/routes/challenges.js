const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { challengeFromRow, createNotification } = require('../services/serializers');
const { getSummary, getAchievements } = require('../services/progress');

const router = express.Router();

router.use(authRequired);

function loadChallenges(userId) {
  const rows = db
    .prepare(
      `SELECT c.*, cp.joined, cp.completed_steps, cp.completed
       FROM challenges c
       LEFT JOIN challenge_progress cp
         ON cp.challenge_id = c.id AND cp.user_id = ?
       ORDER BY c.is_weekly DESC, c.id ASC`,
    )
    .all(userId);
  return rows.map(challengeFromRow);
}

router.get('/', (req, res) => {
  return res.json({ challenges: loadChallenges(req.user.id) });
});

router.get('/:id', (req, res) => {
  const challenge = loadChallenges(req.user.id).find(
    (item) => item.id === Number(req.params.id),
  );
  if (!challenge) {
    return res.status(404).json({ error: 'Desafio não encontrado.' });
  }
  return res.json({ challenge });
});

router.post('/:id/join', (req, res) => {
  const challenge = db
    .prepare('SELECT * FROM challenges WHERE id = ?')
    .get(req.params.id);
  if (!challenge) {
    return res.status(404).json({ error: 'Desafio não encontrado.' });
  }

  const existing = db
    .prepare('SELECT * FROM challenge_progress WHERE user_id = ? AND challenge_id = ?')
    .get(req.user.id, challenge.id);

  if (existing) {
    db.prepare(
      'UPDATE challenge_progress SET joined = 1 WHERE user_id = ? AND challenge_id = ?',
    ).run(req.user.id, challenge.id);
  } else {
    db.prepare(
      `INSERT INTO challenge_progress (user_id, challenge_id, completed_steps, joined, completed)
       VALUES (?, ?, 0, 1, 0)`,
    ).run(req.user.id, challenge.id);
    db.prepare('UPDATE challenges SET participants = participants + 1 WHERE id = ?').run(
      challenge.id,
    );
  }

  const updated = loadChallenges(req.user.id).find((item) => item.id === challenge.id);
  return res.json({ challenge: updated });
});

router.post('/:id/progress', (req, res) => {
  const challenge = db
    .prepare('SELECT * FROM challenges WHERE id = ?')
    .get(req.params.id);
  if (!challenge) {
    return res.status(404).json({ error: 'Desafio não encontrado.' });
  }

  const row = db
    .prepare('SELECT * FROM challenge_progress WHERE user_id = ? AND challenge_id = ?')
    .get(req.user.id, challenge.id);

  if (!row || !row.joined) {
    return res.status(400).json({ error: 'Entre no desafio antes de registrar progresso.' });
  }
  if (row.completed) {
    return res.status(400).json({ error: 'Desafio já concluído.' });
  }

  const steps = Math.max(1, Number(req.body?.steps) || 1);
  const completedSteps = Math.min(row.completed_steps + steps, challenge.target_steps);
  const completed = completedSteps >= challenge.target_steps ? 1 : 0;

  db.prepare(
    `UPDATE challenge_progress
     SET completed_steps = ?, completed = ?
     WHERE user_id = ? AND challenge_id = ?`,
  ).run(completedSteps, completed, req.user.id, challenge.id);

  if (completed) {
    const ago = new Date().toISOString();
    db.prepare(
      `INSERT INTO action_records
        (user_id, action_id, title, category_label, icon, points, liters, quantity, notes, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, 0, 1, ?, ?)`,
    ).run(
      req.user.id,
      `Desafio concluído: ${challenge.title}`,
      challenge.category,
      challenge.icon,
      challenge.points_reward,
      'Recompensa de desafio coletivo',
      ago,
    );
    createNotification(
      req.user.id,
      'desafio',
      'Desafio concluído!',
      `Você concluiu "${challenge.title}" e ganhou +${challenge.points_reward} pontos.`,
    );
  }

  return res.json({
    challenge: loadChallenges(req.user.id).find((item) => item.id === challenge.id),
    summary: getSummary(req.user.id),
    achievements: getAchievements(req.user.id),
  });
});

module.exports = router;
