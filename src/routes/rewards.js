const express = require('express');
const { authRequired } = require('../middleware/auth');
const { createLimiter } = require('../middleware/rateLimit');
const { ApiError, fail, bodyOf } = require('../services/errors');
const { summary } = require('../services/progress');
const rewards = require('../services/rewards');
const { canonicalId } = require('../services/util');

const router = express.Router();

router.use(authRequired);
// Ids só na forma canônica (`3`): `03`, `3.0` ou `+3` respondem como cupom ou
// recompensa inexistente e não ganham contador próprio de tentativas do PIN.
router.param('id', canonicalId);

router.get('/', (req, res) => {
  return res.json({ rewards: rewards.listRewards(req.user, req.query) });
});

router.get('/redemptions', (req, res) => {
  return res.json({
    redemptions: rewards.listRedemptions(req.user),
    summary: summary(req.user),
  });
});

/** Tentativas erradas do código do parceiro por pessoa e cupom, na janela. */
const PIN_MAX_ATTEMPTS = 5;
const PIN_WINDOW_MINUTES = 15;
const PIN_TOO_MANY =
  'Muitas tentativas erradas do código do parceiro. Aguarde alguns minutos e tente novamente.';

// O PIN do parceiro é curto: sem limite, daria para descobri-lo testando todos.
// Só as tentativas erradas contam; a conferência certa não gasta tentativa.
const pinAttempts = createLimiter({
  max: PIN_MAX_ATTEMPTS,
  windowMs: PIN_WINDOW_MINUTES * 60 * 1000,
});

/** Conferência do cupom no parceiro: `{ "pin": "1234" }`. */
router.post('/redemptions/:id/use', (req, res) => {
  const id = req.params.id;
  if (id === null) fail(404, 'Cupom não encontrado.');
  const key = `${req.user.id}|${id}`;
  const wait = pinAttempts.peek(key);
  if (wait > 0) {
    res.set('Retry-After', String(wait));
    return res.status(429).json({ error: PIN_TOO_MANY });
  }
  try {
    return res.json({ redemption: rewards.useRedemption(req.user, id, bodyOf(req)) });
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) pinAttempts.hit(key);
    throw error;
  }
});

router.get('/:id', (req, res) => {
  return res.json({ reward: rewards.rewardJson(rewards.requireReward(req.params.id), req.user) });
});

router.post('/:id/redeem', (req, res) => {
  const reward = rewards.requireReward(req.params.id);
  const redemption = rewards.redeemReward(req.user, reward);
  return res.status(201).json({
    redemption: rewards.redemptionJson(redemption),
    reward: rewards.rewardJson(rewards.requireReward(reward.id), req.user),
    summary: summary(req.user),
  });
});

module.exports = router;
