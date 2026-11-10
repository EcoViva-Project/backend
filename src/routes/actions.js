const express = require('express');
const { authRequired } = require('../middleware/auth');
const { fail, bodyOf } = require('../services/errors');
const { clean, canonicalId } = require('../services/util');
const { findAction, actionJson, listActions, registerAction } = require('../services/actions');
const { summary, achievements } = require('../services/progress');
const db = require('../db');

const router = express.Router();

router.use(authRequired);
router.param('id', canonicalId);

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

/** O servidor ainda não guarda a foto de comprovação (só o modo local do app). */
const PHOTO_NOT_SUPPORTED =
  'A foto de comprovação ainda não é guardada pelo servidor: por enquanto ela só funciona no modo local do app. Registre a ação sem a foto.';

function hasPhoto(value) {
  if (value === undefined || value === null) return false;
  return typeof value !== 'string' || value.trim() !== '';
}

router.post('/:id/records', (req, res) => {
  const action = requireAction(req.params.id);
  const data = bodyOf(req);
  // Melhor recusar do que aceitar e descartar a foto sem avisar.
  if (hasPhoto(data.photo)) fail(400, PHOTO_NOT_SUPPORTED);
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
