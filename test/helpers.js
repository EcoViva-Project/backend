// Utilitários compartilhados pelos testes de integração.
// Precisa ser carregado antes de qualquer módulo da aplicação para que o
// banco em memória seja usado no lugar do arquivo data/eco.db.
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'eco-test-secret';

const db = require('../src/db');
const app = require('../src/app');

const TABLES = [
  'redemptions',
  'rewards',
  'partners',
  'post_comments',
  'post_likes',
  'posts',
  'challenge_progress',
  'challenges',
  'notifications',
  'action_records',
  'actions',
  'password_resets',
  'users',
];

let server = null;
let baseUrl = null;

async function startServer() {
  if (server) return baseUrl;
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  return baseUrl;
}

async function stopServer() {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  server = null;
  baseUrl = null;
}

function resetDatabase() {
  const clear = db.transaction(() => {
    for (const table of TABLES) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    db.prepare('DELETE FROM sqlite_sequence').run();
  });
  clear();
}

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, body: parsed };
}

async function registerUser({
  name = 'Ana Silva',
  email = 'ana@test.app',
  password = 'segredo123',
  neighborhood,
} = {}) {
  const payload = { name, email, password };
  if (neighborhood) payload.neighborhood = neighborhood;
  const response = await api('/auth/register', { method: 'POST', body: payload });
  if (response.status !== 201) {
    throw new Error(`Falha ao registrar usuário de teste: ${JSON.stringify(response.body)}`);
  }
  return { token: response.body.token, user: response.body.user, password, email };
}

async function login(email, password) {
  const response = await api('/auth/login', { method: 'POST', body: { email, password } });
  if (response.status !== 200) {
    throw new Error(`Falha no login de teste: ${JSON.stringify(response.body)}`);
  }
  return response.body.token;
}

function insertAction({
  title = 'Ação de teste',
  description = 'Descrição da ação de teste',
  category = 'agua',
  categoryLabel = 'Água',
  icon = 'water_drop',
  points = 15,
  liters = 12,
  info = 'Hábito diário',
  infoIcon = 'schedule',
  tags = ['agua', 'teste'],
  footerInfo = 'Rodapé',
  footerIcon = 'groups',
} = {}) {
  const result = db
    .prepare(
      `INSERT INTO actions
        (title, description, category, category_label, icon, points, liters, info, info_icon, tags, footer_info, footer_icon)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      title,
      description,
      category,
      categoryLabel,
      icon,
      points,
      liters,
      info,
      infoIcon,
      JSON.stringify(tags),
      footerInfo,
      footerIcon,
    );
  return db.prepare('SELECT * FROM actions WHERE id = ?').get(result.lastInsertRowid);
}

function insertRecord({
  userId,
  actionId = null,
  title = 'Ação de teste',
  categoryLabel = 'Água',
  icon = 'water_drop',
  points = 15,
  liters = 12,
  quantity = 1,
  notes = null,
  createdAt = new Date().toISOString(),
} = {}) {
  const info = db
    .prepare(
      `INSERT INTO action_records
        (user_id, action_id, title, category_label, icon, points, liters, quantity, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, actionId, title, categoryLabel, icon, points, liters, quantity, notes, createdAt);
  return db.prepare('SELECT * FROM action_records WHERE id = ?').get(info.lastInsertRowid);
}

function insertChallenge({
  title = 'Desafio de teste',
  description = 'Descrição do desafio',
  category = 'Água',
  icon = 'water_drop',
  targetSteps = 3,
  pointsReward = 100,
  participants = 10,
  daysLeft = 5,
  isWeekly = 0,
} = {}) {
  const info = db
    .prepare(
      `INSERT INTO challenges
        (title, description, category, icon, target_steps, points_reward, participants, days_left, is_weekly)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      title,
      description,
      category,
      icon,
      targetSteps,
      pointsReward,
      participants,
      daysLeft,
      isWeekly,
    );
  return db.prepare('SELECT * FROM challenges WHERE id = ?').get(info.lastInsertRowid);
}

function insertPartner({
  name = 'Parceiro de teste',
  description = 'Descrição do parceiro de teste',
  logoIcon = 'storefront',
  createdAt = new Date().toISOString(),
} = {}) {
  const info = db
    .prepare(
      `INSERT INTO partners (name, description, logo_icon, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(name, description, logoIcon, createdAt);
  return db.prepare('SELECT * FROM partners WHERE id = ?').get(info.lastInsertRowid);
}

function insertReward({
  partnerId,
  title = 'Recompensa de teste',
  description = 'Descrição da recompensa de teste',
  category = 'produto',
  categoryLabel = 'Produto',
  icon = 'shopping_bag',
  pointsCost = 100,
  stock = 10,
  terms = 'Termos de teste',
  isFeatured = 0,
  active = 1,
  createdAt = new Date().toISOString(),
} = {}) {
  const info = db
    .prepare(
      `INSERT INTO rewards
        (partner_id, title, description, category, category_label, icon,
         points_cost, stock, terms, is_featured, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      partnerId,
      title,
      description,
      category,
      categoryLabel,
      icon,
      pointsCost,
      stock,
      terms,
      isFeatured,
      active,
      createdAt,
    );
  return db.prepare('SELECT * FROM rewards WHERE id = ?').get(info.lastInsertRowid);
}

module.exports = {
  api,
  registerUser,
  login,
  insertAction,
  insertRecord,
  insertChallenge,
  insertPartner,
  insertReward,
  resetDatabase,
  startServer,
  stopServer,
  db,
};
