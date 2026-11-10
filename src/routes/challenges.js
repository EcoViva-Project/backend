const express = require('express');
const { authRequired } = require('../middleware/auth');
const { fail } = require('../services/errors');
const {
  findChallenge,
  challengeJson,
  listChallenges,
  joinChallenge,
} = require('../services/challenges');

const router = express.Router();

router.use(authRequired);

function requireChallenge(id) {
  const challenge = findChallenge(id);
  if (!challenge) fail(404, 'Desafio não encontrado.');
  return challenge;
}

router.get('/', (req, res) => {
  return res.json({ challenges: listChallenges(req.user) });
});

router.get('/:id', (req, res) => {
  return res.json({ challenge: challengeJson(requireChallenge(req.params.id), req.user) });
});

/** Entra no desafio (ou recomeça um desafio vencido). */
router.post('/:id/join', (req, res) => {
  const challenge = requireChallenge(req.params.id);
  joinChallenge(req.user, challenge);
  return res.json({ challenge: challengeJson(challenge, req.user) });
});

/** Rota antiga: o avanço manual de etapa deixou de existir. */
router.post('/:id/progress', () => {
  fail(
    410,
    'O desafio agora avança sozinho quando você registra uma ação da categoria dele.',
  );
});

module.exports = router;
