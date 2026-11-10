const express = require('express');
const { authRequired } = require('../middleware/auth');
const { bodyOf } = require('../services/errors');
const { publicUser, updateProfile, updatePreferences } = require('../services/users');
const { summary, achievements } = require('../services/progress');

const router = express.Router();

router.use(authRequired);

router.get('/me', (req, res) => {
  // Mesma ordem do app: o resumo é lido antes de sincronizar as conquistas.
  const user = publicUser(req.user);
  const sum = summary(req.user);
  return res.json({ user, summary: sum, achievements: achievements(req.user) });
});

router.patch('/me', (req, res) => {
  return res.json({ user: publicUser(updateProfile(req.user, bodyOf(req))) });
});

router.patch('/me/preferences', (req, res) => {
  return res.json({ user: publicUser(updatePreferences(req.user, bodyOf(req))) });
});

module.exports = router;
