// Dados de referência: um banco criado pela versão antiga (seed do ramo
// `main`) fica utilizável depois de subir a API — cupons conferidos com o PIN
// do catálogo, ações com limite, pontos de coleta, dica do dia e meta coletiva.
//
// Este arquivo não usa `helpers.js`: o banco aqui é um arquivo com o esquema e
// os dados antigos, montado ANTES de carregar a aplicação, para passar pelo
// mesmo caminho da inicialização real (`src/db.js`).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-referencia-'));
const file = path.join(dir, 'eco.db');
process.env.NODE_ENV = 'test';
process.env.DB_PATH = file;
process.env.JWT_SECRET = 'eco-test-secret';
process.env.BCRYPT_ROUNDS = '4';

const { MIGRATIONS, migrate } = require('../src/migrations');

const DAY_MS = 24 * 60 * 60 * 1000;

/** Banco como o seed do ramo `main` deixava: esquema original, sem versão. */
function buildOldDatabase() {
  const old = new Database(file);
  MIGRATIONS[0].up(old);
  const created = new Date(Date.now() - 30 * DAY_MS).toISOString();

  old
    .prepare(
      `INSERT INTO users (id, name, email, password_hash, neighborhood, initials, created_at)
       VALUES (1, 'Clara Mendes', 'clara@eco.app', ?, 'Jardim das Flores', 'CM', ?)`,
    )
    .run(bcrypt.hashSync('eco1234', 4), created);

  // Catálogo antigo: mesmos títulos, pontos antigos e nenhuma coluna de limite.
  const action = old.prepare(
    `INSERT INTO actions (title, description, category, category_label, icon, points)
     VALUES (?, 'Descrição antiga', ?, ?, ?, ?)`,
  );
  action.run('Fechar a torneira ao escovar os dentes', 'agua', 'Água', 'water_drop', 15);
  action.run('Separar resíduos secos e orgânicos', 'reciclagem', 'Reciclagem', 'recycling', 30);
  action.run('Deslocamento a pé ou de bicicleta', 'transporte', 'Transporte', 'directions_bike', 40);
  action.run('Compostagem de resíduos orgânicos', 'alimentacao', 'Alimentação', 'compost', 35);
  // Pontos trocados à mão (o padrão antigo era 20): não podem ser sobrescritos.
  action.run('Apagar luzes em cômodos vazios', 'energia', 'Energia', 'lightbulb_outline', 25);
  action.run('Mutirão de limpeza de praça pública', 'publico', 'Espaços Públicos', 'park', 60);
  // Ação que não está no catálogo: fica como está.
  action.run('Ação criada pela escola', 'publico', 'Espaços Públicos', 'school', 50);

  const partner = old.prepare(
    `INSERT INTO partners (name, description, logo_icon, created_at) VALUES (?, 'Parceiro', 'storefront', ?)`,
  );
  for (const name of [
    'Mercado Verde',
    'EcoClean Serviços',
    'Café Raízes',
    'Floresta Games',
    'Bike Urbana',
    'Padaria do Bairro',
  ]) {
    partner.run(name, created);
  }
  old
    .prepare(
      `INSERT INTO rewards (id, partner_id, title, description, category, category_label, icon,
                            points_cost, stock, created_at)
       VALUES (1, 1, 'Kit de sacolas reutilizáveis', 'Três sacolas', 'produto', 'Produto',
               'shopping_bag', 100, 5, ?)`,
    )
    .run(created);
  old
    .prepare(
      `INSERT INTO redemptions (user_id, reward_id, code, points_spent, status, created_at)
       VALUES (1, 1, 'ECO-ANTIGO01', 100, 'active', ?)`,
    )
    .run(new Date(Date.now() - DAY_MS).toISOString());
  old.close();
}

buildOldDatabase();

// Inicialização real: migrações e dados de referência, guardando o aviso do log.
const startupWarnings = [];
const realWarn = console.warn;
console.warn = (message) => startupWarnings.push(String(message));
const db = require('../src/db');
const app = require('../src/app');
const seed = require('../src/seed');
const { ensureReferenceData } = require('../src/referenceData');
console.warn = realWarn;

let server = null;
let baseUrl = null;

async function api(urlPath, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** Conteúdo das tabelas que o passo de referência pode mexer. */
function snapshot() {
  const tables = [
    'actions',
    'partners',
    'rewards',
    'challenges',
    'collection_points',
    'tips',
    'community_goals',
  ];
  return Object.fromEntries(
    tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]),
  );
}

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('banco antigo: depois de subir, o cupom é conferido com o PIN do catálogo', async () => {
  const login = await api('/auth/login', {
    method: 'POST',
    body: { email: 'clara@eco.app', password: 'eco1234' },
  });
  assert.equal(login.status, 200);
  const token = login.body.token;

  const { redemptions } = (await api('/rewards/redemptions', { token })).body;
  assert.equal(redemptions.length, 1);
  assert.equal(redemptions[0].status, 'active');

  const used = await api(`/rewards/redemptions/${redemptions[0].id}/use`, {
    method: 'POST',
    token,
    body: { pin: seed.DEMO_PARTNER_PIN },
  });
  assert.equal(used.status, 200);
  assert.equal(used.body.redemption.status, 'used');
});

test('banco antigo: ações do catálogo ganham limites e os pontos novos (se não mudados)', async () => {
  const token = (
    await api('/auth/login', { method: 'POST', body: { email: 'clara@eco.app', password: 'eco1234' } })
  ).body.token;
  const { actions } = (await api('/actions', { token })).body;
  const byTitle = new Map(actions.map((action) => [action.title, action]));

  const water = byTitle.get('Fechar a torneira ao escovar os dentes');
  assert.equal(water.dailyLimit, 2);
  assert.equal(water.points, 5);
  const square = byTitle.get('Mutirão de limpeza de praça pública');
  assert.equal(square.weeklyLimit, 1);
  assert.equal(square.points, 100);
  // Pontos trocados à mão continuam; o limite entra.
  const lights = byTitle.get('Apagar luzes em cômodos vazios');
  assert.equal(lights.points, 25);
  assert.equal(lights.dailyLimit, 1);
  // Fora do catálogo: sem mudança.
  const school = byTitle.get('Ação criada pela escola');
  assert.equal(school.points, 50);
  assert.equal(school.dailyLimit, null);
  assert.equal(school.weeklyLimit, null);

  // O limite diário vale: a terceira vez no mesmo dia é recusada.
  const register = () =>
    api(`/actions/${water.id}/records`, { method: 'POST', token, body: { quantity: 1 } });
  assert.equal((await register()).status, 201);
  assert.equal((await register()).status, 201);
  const third = await register();
  assert.equal(third.status, 409);
});

test('banco antigo: pontos de coleta, dica do dia e meta coletiva', async () => {
  const token = (
    await api('/auth/login', { method: 'POST', body: { email: 'clara@eco.app', password: 'eco1234' } })
  ).body.token;

  const points = await api('/collection-points', { token });
  assert.equal(points.status, 200);
  assert.ok(points.body.points.length > 0);

  const tip = await api('/tips/today', { token });
  assert.equal(tip.status, 200);
  assert.ok(tip.body.tip && tip.body.tip.text);

  const stats = await api('/community/stats', { token });
  assert.equal(stats.status, 200);
  assert.ok(stats.body.goal);
  assert.equal(stats.body.goal.target, seed.WEEKLY_GOAL_TARGET);
});

test('banco antigo: parceiro fora do catálogo sem PIN fica como está e gera um aviso', () => {
  const pins = db.prepare('SELECT name, pin FROM partners ORDER BY id').all();
  for (const row of pins) {
    assert.equal(row.pin, row.name === 'Padaria do Bairro' ? '' : seed.DEMO_PARTNER_PIN, row.name);
  }
  assert.equal(startupWarnings.length, 1);
  assert.match(startupWarnings[0], /Padaria do Bairro/);
  assert.match(startupWarnings[0], /PIN/);
});

test('o passo é idempotente: rodar de novo não muda nada', () => {
  const before = snapshot();
  const warnings = [];
  const { changes } = ensureReferenceData(db, { log: { warn: (m) => warnings.push(m) } });
  assert.deepEqual(changes, {
    collectionPoints: 0,
    tips: 0,
    communityGoals: 0,
    actions: 0,
    partners: 0,
    rewards: 0,
    challenges: 0,
  });
  assert.deepEqual(snapshot(), before);
  assert.equal(warnings.length, 1);
});

test('banco recém-criado pelo seed: o passo não muda nada', () => {
  seed.runSeed({ now: new Date('2026-11-11T18:00:00.000Z') });
  const before = snapshot();
  const warnings = [];
  const result = ensureReferenceData(db, { log: { warn: (m) => warnings.push(m) } });
  assert.deepEqual(result.changes, {
    collectionPoints: 0,
    tips: 0,
    communityGoals: 0,
    actions: 0,
    partners: 0,
    rewards: 0,
    challenges: 0,
  });
  assert.deepEqual(result.withoutPin, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(snapshot(), before);

  // Em produção também não muda nada (os parceiros do seed já têm PIN).
  const production = ensureReferenceData(db, { production: true, log: { warn: (m) => warnings.push(m) } });
  assert.equal(Object.values(production.changes).reduce((a, b) => a + b, 0), 0);
  assert.deepEqual(warnings, []);
  assert.deepEqual(snapshot(), before);
});

// ---------------------------------------------------------------------------
// Recompensas e desafios do catálogo antigo e PIN de demonstração em produção.
// Bancos em memória, montados como o seed do ramo `main` deixava.
// ---------------------------------------------------------------------------

/** Recompensas do seed do `main`: título, parceiro e preço antigo. */
const OLD_REWARDS = [
  ['Kit de sacolas reutilizáveis', 'Mercado Verde', 400, 'Retire na loja em até 30 dias após o resgate.'],
  ['Cesta de hortifrúti orgânico', 'Mercado Verde', 900, 'Entrega agendada no bairro. Sujeito à disponibilidade da safra.'],
  ['Limpeza ecológica residencial', 'EcoClean Serviços', 1200, 'Agendamento com antecedência mínima de 3 dias.'],
  ['Café especial grátis', 'Café Raízes', 150, 'Válido de segunda a sexta, das 8h às 17h.'],
  ['15% de desconto no combo', 'Café Raízes', 90, 'Não cumulativo com outras promoções.'],
  ['Skin Guardião da Floresta', 'Floresta Games', 500, 'Código enviado por e-mail após o resgate.'],
  ['Passe de temporada Floresta Viva', 'Floresta Games', 1500, 'Código de uso único, vinculado à sua conta no jogo.'],
  ['Revisão básica de bicicleta', 'Bike Urbana', 700, 'Peças não inclusas. Agende pelo telefone da oficina.'],
  ['Camisa oficial EcoViva', 'Bike Urbana', 650, 'Tamanhos sujeitos ao estoque disponível.'],
];

/** Desafios do seed do `main`: título, descrição, etapas, bônus, dias restantes. */
const OLD_CHALLENGES = [
  ['Semana sem desperdício de água', 'Feche a torneira e reduza o tempo de banho por 7 dias.', 7, 120, 4, 1],
  ['Transporte ativo no bairro', 'Faça 5 trajetos curtos a pé ou de bicicleta.', 5, 100, 6, 1],
  ['Mutirão da praça central', 'Participe da limpeza e do plantio de mudas na praça do bairro.', 1, 150, 12, 0],
  ['Desafio da compostagem', 'Separe resíduos orgânicos por 10 dias seguidos.', 10, 180, 9, 0],
];

function oldCatalogDatabase({ edit } = {}) {
  const old = new Database(':memory:');
  MIGRATIONS[0].up(old);
  const created = '2026-10-01T00:00:00.000Z';
  const partnerIds = new Map();
  for (const name of ['Mercado Verde', 'EcoClean Serviços', 'Café Raízes', 'Floresta Games', 'Bike Urbana']) {
    const info = old
      .prepare(`INSERT INTO partners (name, description, logo_icon, created_at) VALUES (?, 'Parceiro', 'storefront', ?)`)
      .run(name, created);
    partnerIds.set(name, info.lastInsertRowid);
  }
  const reward = old.prepare(
    `INSERT INTO rewards (partner_id, title, description, category, category_label, icon,
                          points_cost, stock, terms, is_featured, active, created_at)
     VALUES (?, ?, 'Descrição antiga', 'produto', 'Produto', 'shopping_bag', ?, 5, ?, 0, 1, ?)`,
  );
  for (const [title, partner, cost, terms] of OLD_REWARDS) {
    reward.run(partnerIds.get(partner), title, cost, terms, created);
  }
  const challenge = old.prepare(
    `INSERT INTO challenges (title, description, category, icon, target_steps, points_reward,
                             participants, days_left, is_weekly)
     VALUES (?, ?, 'Categoria', 'eco', ?, ?, 10, ?, ?)`,
  );
  for (const row of OLD_CHALLENGES) challenge.run(...row);
  if (edit) edit(old);
  migrate(old);
  return old;
}

const quiet = { warn() {} };

function rewardRow(database, title) {
  return database.prepare('SELECT * FROM rewards WHERE title = ?').get(title);
}

function challengeRow(database, title) {
  return database.prepare('SELECT * FROM challenges WHERE title = ?').get(title);
}

test('banco antigo: recompensas e desafios do catálogo passam às regras novas', () => {
  const old = oldCatalogDatabase();
  try {
    // Antes: como a migração deixa.
    const kitBefore = rewardRow(old, 'Kit de sacolas reutilizáveis');
    assert.equal(kitBefore.points_cost, 400);
    assert.equal(kitBefore.per_user_limit, null);
    assert.equal(challengeRow(old, 'Transporte ativo no bairro').step_mode, 'days');

    const { changes } = ensureReferenceData(old, { log: quiet });
    assert.ok(changes.rewards > 0);
    assert.ok(changes.challenges > 0);

    const catalog = require('../src/catalog');
    for (const item of catalog.REWARDS) {
      const row = rewardRow(old, item.title);
      if (!row) continue; // Recompensas novas do catálogo não existiam no banco antigo.
      assert.equal(row.points_cost, item.points_cost, item.title);
      assert.equal(row.value_cents, item.value_cents, item.title);
      assert.equal(row.validity_days, item.validity_days, item.title);
      assert.equal(row.per_user_limit, item.per_user_limit, item.title);
      assert.equal(row.terms, item.terms, item.title);
    }
    for (const item of catalog.CHALLENGES) {
      const row = challengeRow(old, item.title);
      assert.equal(row.step_mode, item.step_mode, item.title);
      assert.equal(row.duration_days, item.duration_days, item.title);
      assert.equal(row.points_reward, item.points_reward, item.title);
      assert.equal(row.description, item.description, item.title);
    }
    assert.equal(rewardRow(old, 'Kit de sacolas reutilizáveis').points_cost, 1500);
    assert.equal(challengeRow(old, 'Transporte ativo no bairro').step_mode, 'actions');

    // Idempotente: rodar de novo não muda nada.
    const again = ensureReferenceData(old, { log: quiet });
    assert.equal(again.changes.rewards, 0);
    assert.equal(again.changes.challenges, 0);
  } finally {
    old.close();
  }
});

test('banco antigo: o que foi trocado à mão em recompensas e desafios não é sobrescrito', () => {
  const old = oldCatalogDatabase({
    edit(database) {
      database.prepare("UPDATE rewards SET points_cost = 950, terms = 'Termos da loja' WHERE title = 'Cesta de hortifrúti orgânico'").run();
      database.prepare("UPDATE challenges SET points_reward = 200, description = 'Texto da escola' WHERE title = 'Desafio da compostagem'").run();
    },
  });
  try {
    // Depois da migração, alguém já ajustou à mão as colunas novas.
    old.prepare("UPDATE rewards SET value_cents = 1234, validity_days = 15, per_user_limit = 3 WHERE title = 'Skin Guardião da Floresta'").run();
    old.prepare("UPDATE challenges SET step_mode = 'days', duration_days = 30 WHERE title = 'Mutirão da praça central'").run();
    // ...e um item fora do catálogo.
    old.prepare(
      `INSERT INTO rewards (partner_id, title, description, category, category_label, icon, points_cost, stock, created_at)
       VALUES (1, 'Brinde da escola', 'Brinde', 'produto', 'Produto', 'school', 400, 3, '2026-10-01T00:00:00.000Z')`,
    ).run();

    ensureReferenceData(old, { log: quiet });

    const basket = rewardRow(old, 'Cesta de hortifrúti orgânico');
    assert.equal(basket.points_cost, 950);
    assert.equal(basket.terms, 'Termos da loja');
    assert.equal(basket.value_cents, 6000); // Este ainda estava no padrão antigo.

    const skin = rewardRow(old, 'Skin Guardião da Floresta');
    assert.equal(skin.value_cents, 1234);
    assert.equal(skin.validity_days, 15);
    assert.equal(skin.per_user_limit, 3);
    assert.equal(skin.points_cost, 800); // O preço ainda era o antigo.

    const compost = challengeRow(old, 'Desafio da compostagem');
    assert.equal(compost.points_reward, 200);
    assert.equal(compost.description, 'Texto da escola');
    assert.equal(compost.duration_days, 14);

    // Prazo trocado à mão fica; o bônus, ainda no padrão antigo, muda.
    const square = challengeRow(old, 'Mutirão da praça central');
    assert.equal(square.duration_days, 30);
    assert.equal(square.points_reward, 60);

    const extra = rewardRow(old, 'Brinde da escola');
    assert.equal(extra.points_cost, 400);
    assert.equal(extra.value_cents, 0);
    assert.equal(extra.per_user_limit, null);
  } finally {
    old.close();
  }
});

test('produção: o PIN de demonstração não é gravado; os parceiros entram no aviso', () => {
  const old = oldCatalogDatabase();
  try {
    const warnings = [];
    const result = ensureReferenceData(old, {
      production: true,
      log: { warn: (message) => warnings.push(String(message)) },
    });
    assert.equal(result.changes.partners, 0);
    const pins = old.prepare('SELECT name, pin FROM partners ORDER BY id').all();
    for (const row of pins) assert.equal(row.pin, '', row.name);
    assert.deepEqual(result.withoutPin, pins.map((row) => row.name));
    assert.equal(warnings.length, 1);
    for (const row of pins) assert.ok(warnings[0].includes(row.name), row.name);

    // Fora de produção, como hoje: os parceiros do catálogo recebem o PIN de demonstração.
    const dev = ensureReferenceData(old, { log: quiet });
    assert.equal(dev.changes.partners, pins.length);
    assert.deepEqual(dev.withoutPin, []);
  } finally {
    old.close();
  }
});
