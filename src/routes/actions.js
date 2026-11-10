const express = require('express');
const { authRequired } = require('../middleware/auth');
const { fail, bodyOf } = require('../services/errors');
const { clean } = require('../services/util');
const { findAction, actionJson, listActions, registerAction } = require('../services/actions');
const { summary, achievements } = require('../services/progress');
const db = require('../db');

const router = express.Router();

router.use(authRequired);

function requireAction(id) {
  const action = findAction(id);
  if (!action) fail(404, 'Ação não encontrada.');
  return action;
}

router.get('/', (req, res) => {
  return res.json({ actions: listActions(req.user, req.query) });
});

router.get('/:id', (req, res) => {
  return res.json({ action: actionJson(requireAction(req.params.id), req.user) });
});

router.post('/:id/records', (req, res) => {
  const action = requireAction(req.params.id);
  const data = bodyOf(req);
  const quantity = data.quantity ?? 1;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
    fail(400, 'A quantidade deve ser um número inteiro a partir de 1.');
  }
  let notes = clean(data.notes);
  if (notes.length > 500) notes = notes.slice(0, 500);

  const result = db.transaction(() =>
    registerAction(req.user, action, { quantity, notes: notes || null }),
  )();
  const sum = summary(req.user);
  return res.status(201).json({
    ...result,
    summary: sum,
    achievements: achievements(req.user),
  });
});

module.exports = router;
