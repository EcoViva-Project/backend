const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { notificationFromRow } = require('../services/serializers');

const router = express.Router();

router.use(authRequired);

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100',
    )
    .all(req.user.id);
  return res.json({
    notifications: rows.map(notificationFromRow),
    unreadCount: rows.filter((row) => !row.read).length,
  });
});

router.post('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  return res.json({ ok: true });
});

router.patch('/:id/read', (req, res) => {
  const result = db
    .prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Notificação não encontrada.' });
  }
  return res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(
    req.params.id,
    req.user.id,
  );
  return res.json({ ok: true });
});

router.delete('/', (req, res) => {
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
  return res.json({ ok: true });
});

module.exports = router;
