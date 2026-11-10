const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { fail, bodyOf } = require('../services/errors');
const { listNotifications } = require('../services/notifications');

const router = express.Router();

router.use(authRequired);

router.get('/', (req, res) => {
  return res.json(listNotifications(req.user.id));
});

router.post('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(req.user.id);
  return res.json({ ok: true });
});

/** Marca como lida; `{ "read": false }` volta a marcar como não lida. */
router.patch('/:id/read', (req, res) => {
  const read = bodyOf(req).read === false ? 0 : 1;
  const result = db
    .prepare('UPDATE notifications SET read = ? WHERE id = ? AND user_id = ?')
    .run(read, req.params.id, req.user.id);
  if (result.changes === 0) fail(404, 'Notificação não encontrada.');
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
