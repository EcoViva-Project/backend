const express = require('express');
const cors = require('cors');

const config = require('./config');
const clock = require('./services/clock');
const { ApiError } = require('./services/errors');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const actionRoutes = require('./routes/actions');
const recordRoutes = require('./routes/records');
const progressRoutes = require('./routes/progress');
const notificationRoutes = require('./routes/notifications');
const challengeRoutes = require('./routes/challenges');
const communityRoutes = require('./routes/community');
const rewardRoutes = require('./routes/rewards');
const placeRoutes = require('./routes/places');

const app = express();

// Atrás de um proxy (Render, Railway, nginx), TRUST_PROXY=true faz `req.ip`
// ser o IP real de quem chamou, usado pelo limitador de tentativas.
app.set('trust proxy', config.trustProxy);

const corsOrigins = config.corsOrigin
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOrigin = corsOrigins.length === 0 || corsOrigins.includes('*') ? '*' : corsOrigins;

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'eco-backend', time: clock.now().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/actions', actionRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/challenges', challengeRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/rewards', rewardRoutes);
app.use('/api/collection-points', placeRoutes.collectionPoints);
app.use('/api/places', placeRoutes.neighborhoods);
app.use('/api/tips', placeRoutes.tips);

app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

const CLIENT_ERRORS = {
  'entity.parse.failed': [400, 'O corpo da requisição não é um JSON válido.'],
  'entity.too.large': [413, 'O corpo da requisição é grande demais.'],
  'encoding.unsupported': [415, 'Codificação do corpo não suportada.'],
  'charset.unsupported': [415, 'Codificação do corpo não suportada.'],
};

// Erros: regra de negócio (`ApiError`) e corpo inválido viram 4xx com
// `{ "error": "..." }`; o resto é 500 e vai para o log.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof ApiError) {
    return res.status(error.status).json({ error: error.message });
  }
  const known = CLIENT_ERRORS[error.type];
  if (known) {
    return res.status(known[0]).json({ error: known[1] });
  }
  const status = Number(error.status || error.statusCode);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return res.status(status).json({ error: 'Requisição inválida.' });
  }
  console.error(error);
  return res.status(500).json({ error: 'Erro interno do servidor.' });
});

module.exports = app;
