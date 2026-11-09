const express = require('express');
const cors = require('cors');

const config = require('./config');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const actionRoutes = require('./routes/actions');
const recordRoutes = require('./routes/records');
const progressRoutes = require('./routes/progress');
const notificationRoutes = require('./routes/notifications');
const challengeRoutes = require('./routes/challenges');
const communityRoutes = require('./routes/community');
const rewardRoutes = require('./routes/rewards');

const app = express();

const corsOrigins = config.corsOrigin
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOrigin = corsOrigins.length === 0 || corsOrigins.includes('*') ? '*' : corsOrigins;

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'eco-backend', time: new Date().toISOString() });
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

app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error(error);
  return res.status(500).json({ error: 'Erro interno do servidor.' });
});

module.exports = app;
