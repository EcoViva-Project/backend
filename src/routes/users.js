const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { publicUser } = require('../services/serializers');
const { getSummary, getAchievements } = require('../services/progress');

const router = express.Router();

router.use(authRequired);

router.get('/me', (req, res) => {
  return res.json({
    user: publicUser(req.user),
    summary: getSummary(req.user.id),
    achievements: getAchievements(req.user.id),
  });
});

router.patch('/me', (req, res) => {
  const { name, neighborhood, monthlyGoal, weeklyGoal } = req.body || {};
  const updates = [];
  const values = [];

  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (trimmed.length < 2) {
      return res.status(400).json({ error: 'Informe um nome válido.' });
    }
    const parts = trimmed.split(/\s+/);
    const initials =
      parts.length === 1
        ? parts[0].slice(0, 2).toUpperCase()
        : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    updates.push('name = ?', 'initials = ?');
    values.push(trimmed, initials);
  }
  if (neighborhood !== undefined) {
    updates.push('neighborhood = ?');
    values.push(String(neighborhood).trim());
  }
  if (monthlyGoal !== undefined) {
    updates.push('monthly_goal = ?');
    values.push(Math.max(1, Number(monthlyGoal) || 1));
  }
  if (weeklyGoal !== undefined) {
    updates.push('weekly_goal = ?');
    values.push(Math.max(1, Number(weeklyGoal) || 1));
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
  }

  values.push(req.user.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  return res.json({ user: publicUser(user) });
});

router.patch('/me/preferences', (req, res) => {
  const map = {
    notificationsEnabled: 'notifications_enabled',
    remindersEnabled: 'reminders_enabled',
    privacyProfile: 'privacy_profile',
    privacyLocation: 'privacy_location',
  };
  const updates = [];
  const values = [];

  for (const [key, column] of Object.entries(map)) {
    if (req.body?.[key] !== undefined) {
      updates.push(`${column} = ?`);
      values.push(req.body[key] ? 1 : 0);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Nenhuma preferência informada.' });
  }

  values.push(req.user.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  return res.json({ user: publicUser(user) });
});

module.exports = router;
