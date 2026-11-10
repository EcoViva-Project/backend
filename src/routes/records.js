const express = require('express');
const { authRequired } = require('../middleware/auth');
const { listRecords } = require('../services/actions');

const router = express.Router();

router.use(authRequired);

router.get('/', (req, res) => {
  return res.json({ records: listRecords(req.user, req.query) });
});

module.exports = router;
