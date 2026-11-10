const express = require('express');
const { authRequired } = require('../middleware/auth');
const { bodyOf } = require('../services/errors');
const { summary } = require('../services/progress');
const rewards = require('../services/rewards');

const router = express.Router();

router.use(authRequired);

router.get('/', (req, res) => {
  return res.json({ rewards: rewards.listRewards(req.user, req.query) });
});

router.get('/redemptions', (req, res) => {
  return res.json({
    redemptions: rewards.listRedemptions(req.user),
    summary: summary(req.user),
  });
});

/** Conferência do cupom no parceiro: `{ "pin": "1234" }`. */
router.post('/redemptions/:id/use', (req, res) => {
  return res.json({ redemption: rewards.useRedemption(req.user, req.params.id, bodyOf(req)) });
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
