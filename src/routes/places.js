// Rotas do bairro que não são do feed: pontos de coleta, busca de bairros e
// dica do dia.

const express = require('express');
const { authRequired } = require('../middleware/auth');
const community = require('../services/community');
const places = require('../services/places');

const collectionPoints = express.Router();
collectionPoints.use(authRequired);
collectionPoints.get('/', (req, res) => {
  return res.json({ points: community.listCollectionPoints(req.user, req.query) });
});

// Pública: a lista de nomes de bairros é usada pelo cadastro, antes de haver
// sessão (como no modo local do app). Não tem dado de nenhuma pessoa.
const neighborhoods = express.Router();
neighborhoods.get('/neighborhoods', (req, res) => {
  return res.json({ neighborhoods: places.searchNeighborhoods(String(req.query.search ?? '')) });
});

const tips = express.Router();
tips.use(authRequired);
tips.get('/today', (req, res) => {
  return res.json({ tip: community.tipOfTheDay() });
});

module.exports = { collectionPoints, neighborhoods, tips };
