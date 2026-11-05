const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { recordFromRow } = require('../services/serializers');

const router = express.Router();

router.use(authRequired);

router.get('/', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const rows = db
    .prepare(
      `SELECT * FROM action_records WHERE user_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(req.user.id, limit);

  return res.json({ records: rows.map(recordFromRow) });
});

module.exports = router;
