// Dados de demonstração da API.
//
// Espelha `eco-app/lib/core/local/local_seed.dart`: mesmo catálogo, mesmos
// parceiros e cupons, a conta Clara Mendes e 18 vizinhos fictícios em bairros
// reais de São José do Rio Preto. O histórico é gerado passando pelas MESMAS
// funções de regra usadas pelas rotas (limites por ação, teto semanal,
// desafios e conquistas), sempre relativo ao momento da carga. Com o mesmo
// instante, os números batem com os do modo local do app.
//
// O catálogo (ações, desafios, parceiros, recompensas, dicas, meta e pontos de
// coleta) fica em `src/catalog.js`, compartilhado com os dados de referência
// que completam um banco antigo na inicialização (`src/referenceData.js`).
//
// Uso: `npm run seed` (apaga e recria os dados). Com NODE_ENV=production a
// carga é recusada, a não ser com `npm run seed -- --force`.

const db = require('./db');
const config = require('./config');
const clock = require('./services/clock');
const economy = require('./services/economy');
const { ApiError } = require('./services/errors');
const { notify } = require('./services/notifications');
const { createUser } = require('./services/users');
const { weekActionPoints } = require('./services/progress');
const { registerAction } = require('./services/actions');
const { joinChallenge } = require('./services/challenges');
const { redeemReward, markRedemptionUsed } = require('./services/rewards');
const { iso } = require('./services/util');
const {
  DEMO_PARTNER_PIN,
  WEEKLY_GOAL_TARGET,
  ACTIONS,
  CHALLENGES,
  PARTNERS,
  REWARDS,
  TIPS,
  loadCollectionPoints,
  defaultCommunityGoal,
} = require('./catalog');

const DEMO_EMAIL = 'clara@eco.app';
const DEMO_PASSWORD = 'eco1234';

/**
 * Quantos pontos ficam livres abaixo do teto na semana atual, para a
 * apresentação conseguir mostrar o teto sendo atingido.
 */
const ROOM_BELOW_CAP = 25;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Moradores fictícios da demonstração, em bairros reais de Rio Preto.
 * O terceiro valor é o ritmo: 1 = casual, 2 = regular, 3 = dedicado.
 */
const NEIGHBORS = [
  ['Marina Lopes', 'Vila Redentora', 3],
  ['Rafael Souza', 'Higienópolis', 2],
  ['João Ferreira', 'Jardim Alto Rio Preto', 2],
  ['Beatriz Nunes', 'Vila Imperial', 3],
  ['Carlos Eduardo Lima', 'Eldorado', 1],
  ['Fernanda Rocha', 'Solo Sagrado', 2],
  ['Gustavo Almeida', 'Jardim Nazareth', 1],
  ['Helena Barros', 'Vila Maceno', 2],
  ['Igor Santana', 'Jardim Yolanda', 1],
  ['Juliana Prado', 'Vila Anchieta', 3],
  ['Lucas Teixeira', 'Jardim Canaã', 2],
  ['Mariana Costa', 'Jardim Soraia', 1],
  ['Nelson Ribeiro', 'Parque Industrial', 2],
  ['Olívia Martins', 'Vila Ercília', 2],
  ['Paulo Henrique Dias', 'São Francisco', 1],
  ['Renata Cardoso', 'Vila Toninho', 2],
  ['Sérgio Moura', 'Jardim Vetorasso', 1],
  ['Tatiane Freitas', 'Centro', 3],
];

/** Tabelas na ordem em que podem ser apagadas sem ferir as chaves estrangeiras. */
const TABLES = [
  'user_achievements',
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
  'collection_points',
  'community_goals',
  'tips',
];

/** Apaga todos os dados e zera as sequências de id. */
function wipe() {
  for (const table of TABLES) db.prepare(`DELETE FROM ${table}`).run();
  db.prepare('DELETE FROM sqlite_sequence').run();
}

function insert(table, values) {
  const columns = Object.keys(values);
  const info = db
    .prepare(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    )
    .run(...columns.map((column) => values[column]));
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid);
}

/** Só o catálogo (ações, desafios, parceiros, recompensas, meta, dicas e pontos de coleta). */
function seedCatalog(createdAt) {
  const created = iso(createdAt);
  for (const action of ACTIONS) insert('actions', { ...action, tags: JSON.stringify(action.tags) });
  for (const challenge of CHALLENGES) insert('challenges', challenge);
  const partnerIds = new Map();
  for (const partner of PARTNERS) {
    const row = insert('partners', { ...partner, pin: DEMO_PARTNER_PIN, created_at: created });
    partnerIds.set(partner.name, row.id);
  }
  for (const { partner, ...reward } of REWARDS) {
    insert('rewards', {
      ...reward,
      partner_id: partnerIds.get(partner),
      active: 1,
      created_at: created,
    });
  }
  insert('community_goals', defaultCommunityGoal());
  for (const tip of TIPS) insert('tips', tip);
  for (const point of loadCollectionPoints()) insert('collection_points', point);
}

const byId = (table, id) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
const freshUser = (user) => byId('users', user.id);

/** Tenta registrar; um registro que esbarra em limite é simplesmente ignorado. */
function tryRegister(user, actionId, at, quantity = 1) {
  try {
    registerAction(freshUser(user), byId('actions', actionId), { quantity, at, silent: true });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }
}

function tryRedeem(user, reward, at, now) {
  if (at.getTime() > now.getTime()) return null;
  try {
    return redeemReward(freshUser(user), reward, { at, silent: true });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return null;
  }
}

const plus = (instant, ms) => new Date(instant.getTime() + ms);
const same = (a, b) => a.getTime() === b.getTime();

function seedClara(now, today, weekStart, firstDay) {
  const clara = createUser({
    name: 'Clara Mendes',
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    neighborhood: 'Boa Vista',
    createdAt: plus(firstDay, 7 * HOUR),
  });
  // Meta mensal compatível com o ritmo da conta de demonstração.
  db.prepare('UPDATE users SET monthly_goal = 120, weekly_goal = 25 WHERE id = ?').run(clara.id);

  const reward = (title) => db.prepare('SELECT * FROM rewards WHERE title = ?').get(title);

  function register(actionId, at, { quantity = 1, currentWeek = false } = {}) {
    if (at.getTime() > now.getTime()) return;
    if (currentWeek) {
      const points = byId('actions', actionId).points * quantity;
      if (weekActionPoints(clara.id, at) + points > economy.WEEKLY_CAP - ROOM_BELOW_CAP) return;
    }
    tryRegister(clara, actionId, at, quantity);
  }

  // ----- Semanas anteriores: ritmo de uma usuária regular -----
  const transportChallengeWeek = plus(weekStart, -35 * DAY);
  const expiredCouponDay = plus(weekStart, -40 * DAY);
  const usedCouponDay = plus(weekStart, -18 * DAY);

  for (let d = firstDay; d.getTime() < weekStart.getTime(); d = plus(d, DAY)) {
    const weekday = economy.weekday(d);
    const weeksAgo = Math.floor(Math.floor((weekStart - d) / DAY) / 7) + 1;
    const inChallengeWeek =
      d.getTime() >= transportChallengeWeek.getTime() &&
      d.getTime() < plus(transportChallengeWeek, 7 * DAY).getTime();

    if (same(d, transportChallengeWeek)) {
      joinChallenge(clara, byId('challenges', 2), { at: plus(d, 7 * HOUR) });
    }

    register(1, plus(d, 7 * HOUR + 30 * MINUTE));
    register(1, plus(d, 21 * HOUR + 40 * MINUTE));
    register(2, plus(d, 12 * HOUR + 10 * MINUTE));
    if (weekday === 1 || weekday === 3 || weekday === 5) {
      register(3, plus(d, 18 * HOUR + 20 * MINUTE), { quantity: inChallengeWeek ? 2 : 1 });
    }
    if (weekday === 2 || weekday === 6) register(4, plus(d, 19 * HOUR + 40 * MINUTE));
    if (weekday === 4 && weeksAgo % 2 === 0) register(5, plus(d, 22 * HOUR));
    if (weekday === 7 && weeksAgo % 3 === 0) register(6, plus(d, 9 * HOUR));

    if (same(d, expiredCouponDay)) {
      tryRedeem(clara, reward('15% de desconto no combo'), plus(d, 13 * HOUR), now);
    }
    if (same(d, usedCouponDay)) {
      const redemption = tryRedeem(clara, reward('Café especial grátis'), plus(d, 13 * HOUR), now);
      if (redemption) markRedemptionUsed(redemption, { at: plus(d, 2 * DAY + 9 * HOUR) });
    }
  }

  // ----- Semana atual: dias cheios em ritmo forte, para chegar perto do teto -----
  if (weekStart.getTime() <= now.getTime()) {
    joinChallenge(clara, byId('challenges', 1), { at: plus(weekStart, 5 * MINUTE) });
  }
  const yesterday = plus(today, -DAY);
  for (let d = weekStart; d.getTime() < today.getTime(); d = plus(d, DAY)) {
    const isMonday = economy.weekday(d) === 1;
    register(1, plus(d, 7 * HOUR + 30 * MINUTE), { currentWeek: true });
    register(1, plus(d, 21 * HOUR + 40 * MINUTE), { currentWeek: true });
    register(2, plus(d, 12 * HOUR + 10 * MINUTE), { currentWeek: true });
    register(4, plus(d, 19 * HOUR + 40 * MINUTE), { currentWeek: true });
    register(3, plus(d, 18 * HOUR + 20 * MINUTE), { quantity: 2, currentWeek: true });
    if (isMonday) register(5, plus(d, 22 * HOUR), { currentWeek: true });
    if (same(d, yesterday)) register(6, plus(d, 9 * HOUR), { currentWeek: true });
  }

  // ----- Hoje: poucas ações, espalhadas pelo tempo já decorrido do dia -----
  const elapsedSeconds = Math.trunc((now - today) / 1000);
  const todayAt = (fraction) => plus(today, Math.round(elapsedSeconds * fraction) * 1000);
  register(1, todayAt(0.3), { currentWeek: true });
  register(2, todayAt(0.5), { currentWeek: true });
  register(3, todayAt(0.7), { currentWeek: true });

  // Um cupom ainda válido, resgatado há três dias.
  tryRedeem(
    clara,
    reward('20% de desconto no almoço executivo'),
    plus(now, -(3 * DAY + 2 * HOUR)),
    now,
  );

  return freshUser(clara);
}

/**
 * Cria os moradores fictícios e as duas últimas semanas de ações deles,
 * passando pelas mesmas regras de qualquer usuário. É daqui que saem os
 * números do bairro: vizinhos ativos, ações da semana, meta coletiva, ranking
 * e "quantos registraram hoje".
 */
function seedNeighbors(now, today, weekStart) {
  const firstDay = plus(today, -13 * DAY);
  const people = new Map();

  // Gerador simples e determinístico (o mesmo do app): a demonstração é sempre a mesma.
  let state = 20261111;
  function next(max) {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return (state >> 8) % max;
  }

  const elapsedToday = Math.trunc((now - today) / 1000);

  NEIGHBORS.forEach(([name, neighborhood, pace], i) => {
    const person = createUser({
      name,
      email: `vizinho${i + 1}@demo.ecoviva`,
      // Contas de figuração: ninguém entra com elas.
      password: `figurante-${state + i}-${Math.random().toString(36).slice(2)}`,
      neighborhood,
      createdAt: plus(firstDay, -(20 + i) * DAY),
    });
    people.set(name, person);

    const register = (actionId, at, quantity = 1) => {
      if (at.getTime() > now.getTime()) return;
      tryRegister(person, actionId, at, quantity);
    };

    // Entradas em desafios, para a contagem de participantes ser real.
    const joins = [];
    if (i < 9) joins.push([1, plus(weekStart, (10 + i) * MINUTE)]);
    if (i >= 3 && i < 10) joins.push([2, plus(today, -5 * DAY)]);
    if (i >= 10 && i < 14) joins.push([3, plus(today, -6 * DAY)]);
    if (i >= 12) joins.push([4, plus(today, -4 * DAY)]);
    for (const [challengeId, at] of joins) {
      if (at.getTime() > now.getTime()) continue;
      joinChallenge(person, byId('challenges', challengeId), { at });
    }

    for (let d = firstDay; d.getTime() <= today.getTime(); d = plus(d, DAY)) {
      const isToday = same(d, today);
      const activeChance = pace === 3 ? 95 : pace === 2 ? 75 : 45;
      const roll = next(100);
      if (roll >= activeChance) continue;

      // Hoje as ações se espalham pelo tempo já decorrido do dia.
      const at = (hour, minute) => {
        if (!isToday) return plus(d, hour * HOUR + minute * MINUTE);
        const fraction = Math.min(Math.max((hour - 6) / 17, 0.05), 0.95);
        return plus(today, Math.round(elapsedToday * fraction) * 1000);
      };

      register(1, at(7, 20 + i));
      if (pace >= 2) register(1, at(21, 10 + i));
      if (next(100) < 40 + pace * 15) register(2, at(12, i));
      if (next(100) < 15 + pace * 15) register(3, at(18, i), pace === 3 ? 2 : 1);
      if (next(100) < 10 + pace * 12) register(4, at(19, 30));
      if (next(100) < 20 + pace * 10) register(5, at(22, 0));
      if (pace === 3 && economy.weekday(d) === 7) register(6, at(9, 0));
    }
  });
  return people;
}

function seedCommunity(clara, now, people) {
  const ago = (ms) => iso(plus(now, -ms));

  function post({ name, initials, content, likes, age, userId = null, comments = [] }) {
    const row = insert('posts', {
      // As publicações dos vizinhos pertencem às contas deles.
      user_id: userId ?? people.get(name)?.id ?? null,
      author_name: name,
      author_initials: initials,
      content,
      base_likes: likes,
      created_at: ago(age),
    });
    for (const [author, authorInitials, body, commentAge] of comments) {
      insert('post_comments', {
        post_id: row.id,
        user_id: null,
        author_name: author,
        author_initials: authorInitials,
        content: body,
        created_at: ago(commentAge),
      });
    }
    if (userId !== null) {
      db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)').run(row.id, userId);
    }
  }

  post({
    name: 'Marina Lopes',
    initials: 'ML',
    content:
      'Comecei a compostar na varanda e em duas semanas o lixo orgânico da casa caiu pela metade. Quem quiser dicas, chama!',
    likes: 34,
    age: 3 * HOUR,
    comments: [['Rafael Souza', 'RS', 'Adorei! Vou tentar aqui também.', 2 * HOUR]],
  });
  post({
    name: 'Rafael Souza',
    initials: 'RS',
    content:
      'Mutirão de limpeza da praça neste sábado às 9h. Levem luvas e sacolas, a prefeitura recolhe o material no fim da manhã.',
    likes: 51,
    age: 8 * HOUR,
    comments: [['Marina Lopes', 'ML', 'Vou levar as crianças para ajudar.', 4 * HOUR]],
  });
  post({
    name: 'João Ferreira',
    initials: 'JF',
    content:
      'Troquei o carro pela bike em trajetos de até 5 km. Em um mês foram 18 trajetos e muita disposição a mais.',
    likes: 28,
    age: 26 * HOUR,
  });
  post({
    name: clara.name,
    initials: clara.initials,
    userId: clara.id,
    content:
      'Fechando a torneira todos os dias já passei de mil litros de água poupados. Pequenas atitudes somam muito!',
    likes: 19,
    age: 50 * HOUR,
    comments: [['João Ferreira', 'JF', 'Excelente, Clara! Bora manter o ritmo.', 48 * HOUR]],
  });
}

function seedNotifications(clara, now, firstDay) {
  notify(
    clara.id,
    'sistema',
    'Boas-vindas ao EcoViva!',
    'Sua conta de demonstração está pronta, com histórico, desafios, comunidade e cupons.',
    { target: '/acoes', at: plus(firstDay, 7 * HOUR), read: true },
  );
  notify(
    clara.id,
    'recompensa',
    'Resgate confirmado!',
    'Você resgatou "20% de desconto no almoço executivo" com Restaurante Sabor da Terra.',
    { target: '/recompensas', at: plus(now, -(3 * DAY + 2 * HOUR)), read: true },
  );
  notify(clara.id, 'comunidade', 'Novo comentário', 'João Ferreira comentou na sua publicação.', {
    target: '/comunidade',
    at: plus(now, -48 * HOUR),
  });
  notify(
    clara.id,
    'desafio',
    'Desafio em andamento',
    'Continue registrando ações de Água para concluir "Semana sem desperdício de água".',
    { target: '/desafios', at: plus(now, -5 * HOUR) },
  );
  notify(
    clara.id,
    'sistema',
    'Você está perto do teto da semana',
    `Faltam poucos pontos para os ${economy.WEEKLY_CAP} desta semana. As ações continuam valendo para desafios e conquistas.`,
    { target: '/progresso', at: plus(now, -40 * MINUTE) },
  );
}

/**
 * Apaga tudo e recria os dados de demonstração, relativos a `now`.
 * Enquanto a carga roda, o relógio da aplicação fica parado em `now`.
 */
function runSeed({ now = clock.now() } = {}) {
  const previous = clock.fixedAt();
  clock.setNow(now);
  try {
    db.transaction(() => {
      wipe();
      const today = economy.startOfLocalDay(now);
      const weekStart = plus(today, -(economy.weekday(now) - 1) * DAY);
      const firstDay = plus(today, -63 * DAY);

      seedCatalog(firstDay);
      const clara = seedClara(now, today, weekStart, firstDay);
      const people = seedNeighbors(now, today, weekStart);
      seedCommunity(clara, now, people);
      seedNotifications(clara, now, firstDay);
    })();
  } finally {
    clock.setNow(previous);
  }
}

function counts() {
  const one = (sql) => db.prepare(sql).get().total;
  return {
    users: one('SELECT COUNT(*) AS total FROM users'),
    actions: one('SELECT COUNT(*) AS total FROM actions'),
    records: one("SELECT COUNT(*) AS total FROM action_records WHERE kind = 'action'"),
    rewards: one('SELECT COUNT(*) AS total FROM rewards'),
    collectionPoints: one('SELECT COUNT(*) AS total FROM collection_points'),
  };
}

if (require.main === module) {
  const force = process.argv.includes('--force');
  if (config.isProduction && !force) {
    console.error(
      'Recusado: NODE_ENV=production. O seed APAGA todos os dados. Se é isso mesmo, rode `npm run seed -- --force`.',
    );
    process.exit(1);
  }
  runSeed();
  const total = counts();
  console.log(
    `Dados de demonstração criados: ${total.users} usuários, ${total.actions} ações, ` +
      `${total.records} registros, ${total.rewards} recompensas, ${total.collectionPoints} pontos de coleta.`,
  );
  console.log(`Conta de demonstração: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  db.close();
}

module.exports = {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_PARTNER_PIN,
  WEEKLY_GOAL_TARGET,
  ACTIONS,
  CHALLENGES,
  PARTNERS,
  REWARDS,
  TIPS,
  NEIGHBORS,
  runSeed,
  seedCatalog,
  wipe,
};
