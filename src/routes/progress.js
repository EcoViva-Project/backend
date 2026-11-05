const express = require('express');
const { authRequired } = require('../middleware/auth');
const { getSummary, getAchievements } = require('../services/progress');

const router = express.Router();

router.use(authRequired);

router.get('/', (req, res) => {
  return res.json({
    summary: getSummary(req.user.id),
    achievements: getAchievements(req.user.id),
  });
});

router.get('/achievements', (req, res) => {
  return res.json({ achievements: getAchievements(req.user.id) });
});

module.exports = router;
