const express = require('express');
const { authRequired } = require('../middleware/auth');
const { summary, achievements } = require('../services/progress');

const router = express.Router();

router.use(authRequired);

router.get('/', (req, res) => {
  // Mesma ordem do app: o resumo é lido antes de sincronizar as conquistas.
  const sum = summary(req.user);
  return res.json({ summary: sum, achievements: achievements(req.user) });
});

router.get('/achievements', (req, res) => {
  return res.json({ achievements: achievements(req.user) });
});

module.exports = router;
