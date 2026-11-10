// Utilitários compartilhados pelos testes de integração.
// Precisa ser carregado antes de qualquer módulo da aplicação para que o
// banco em memória seja usado no lugar do arquivo data/eco.db.
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'eco-test-secret';
process.env.EXPOSE_RESET_CODE = 'true';
process.env.BCRYPT_ROUNDS = '4';

const db = require('../src/db');
const app = require('../src/app');
const clock = require('../src/services/clock');
const economy = require('../src/services/economy');
const seed = require('../src/seed');
const { resetRateLimits } = require('../src/middleware/rateLimit');

/** Quarta-feira, 11/11/2026, 15:00 em Brasília (dia da feira). */
const WEDNESDAY = new Date('2026-11-11T18:00:00.000Z');

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

/** Banco vazio, relógio parado na quarta da feira e limitador zerado. */
function resetDatabase() {
  db.transaction(() => seed.wipe())();
  clock.setNow(WEDNESDAY);
  resetRateLimits();
}

/** Banco com os dados de demonstração, com o relógio parado na quarta da feira. */
function seedDemo(now = WEDNESDAY) {
  resetRateLimits();
  clock.setNow(now);
  seed.runSeed({ now });
}

/** Avança (ou volta) o relógio da aplicação. */
function advanceClock(ms) {
  clock.setNow(new Date(clock.now().getTime() + ms));
}

async function api(path, { method = 'GET', token, body, rawBody, headers: extra = {} } = {}) {
  const headers = { ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined || rawBody !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
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
  return { status: response.status, body: parsed, headers: response.headers };
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

async function loginDemo() {
  return login(seed.DEMO_EMAIL, seed.DEMO_PASSWORD);
}

function insertRow(table, values) {
  const columns = Object.keys(values);
  const info = db
    .prepare(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    )
    .run(...columns.map((column) => values[column]));
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid);
}

function insertAction({
  title = 'Ação de teste',
  description = 'Descrição da ação de teste',
  category = 'agua',
  categoryLabel = 'Água',
  icon = 'water_drop',
  points = 15,
  liters = 12,
  dailyLimit = null,
  weeklyLimit = null,
  info = 'Hábito diário',
  infoIcon = 'schedule',
  tags = ['agua', 'teste'],
  footerInfo = 'Rodapé',
  footerIcon = 'groups',
} = {}) {
  return insertRow('actions', {
    title,
    description,
    category,
    category_label: categoryLabel,
    icon,
    points,
    liters,
    daily_limit: dailyLimit,
    weekly_limit: weeklyLimit,
    info,
    info_icon: infoIcon,
    tags: JSON.stringify(tags),
    footer_info: footerInfo,
    footer_icon: footerIcon,
  });
}

function insertRecord({
  userId,
  actionId = null,
  kind = 'action',
  title = 'Ação de teste',
  categoryLabel = 'Água',
  icon = 'water_drop',
  points = 15,
  basePoints = points,
  liters = 12,
  quantity = 1,
  notes = null,
  createdAt = clock.now().toISOString(),
} = {}) {
  return insertRow('action_records', {
    user_id: userId,
    action_id: actionId,
    kind,
    title,
    category_label: categoryLabel,
    icon,
    points,
    base_points: basePoints,
    liters,
    quantity,
    notes,
    created_at: createdAt,
    local_date: economy.dateKey(createdAt),
  });
}

function insertChallenge({
  title = 'Desafio de teste',
  description = 'Descrição do desafio',
  category = 'Água',
  icon = 'water_drop',
  targetSteps = 3,
  stepMode = 'actions',
  pointsReward = 100,
  baseParticipants = 10,
  durationDays = 7,
  isWeekly = 0,
} = {}) {
  return insertRow('challenges', {
    title,
    description,
    category,
    icon,
    target_steps: targetSteps,
    step_mode: stepMode,
    points_reward: pointsReward,
    base_participants: baseParticipants,
    duration_days: durationDays,
    is_weekly: isWeekly,
  });
}

function insertPartner({
  name = 'Parceiro de teste',
  description = 'Descrição do parceiro de teste',
  logoIcon = 'storefront',
  address = 'Rua de Teste, 10',
  pin = '4321',
  createdAt = clock.now().toISOString(),
} = {}) {
  return insertRow('partners', {
    name,
    description,
    logo_icon: logoIcon,
    address,
    pin,
    created_at: createdAt,
  });
}

function insertReward({
  partnerId,
  title = 'Recompensa de teste',
  description = 'Descrição da recompensa de teste',
  category = 'produto',
  categoryLabel = 'Produto',
  icon = 'shopping_bag',
  pointsCost = 100,
  valueCents = 200,
  stock = 10,
  terms = 'Termos de teste',
  validityDays = 30,
  perUserLimit = null,
  isFeatured = 0,
  active = 1,
  createdAt = clock.now().toISOString(),
} = {}) {
  return insertRow('rewards', {
    partner_id: partnerId,
    title,
    description,
    category,
    category_label: categoryLabel,
    icon,
    points_cost: pointsCost,
    value_cents: valueCents,
    stock,
    terms,
    validity_days: validityDays,
    per_user_limit: perUserLimit,
    is_featured: isFeatured,
    active,
    created_at: createdAt,
  });
}

module.exports = {
  WEDNESDAY,
  DAY_MS: economy.DAY_MS,
  api,
  registerUser,
  login,
  loginDemo,
  insertRow,
  insertAction,
  insertRecord,
  insertChallenge,
  insertPartner,
  insertReward,
  resetDatabase,
  seedDemo,
  advanceClock,
  startServer,
  stopServer,
  clock,
  economy,
  seed,
  db,
};
