// Catálogo de ações e registro de ações (limites por ação e teto semanal).
//
// Espelha a seção "Catálogo de ações e registros" de
// `eco-app/lib/core/local/local_api.dart`. `registerAction` é usada pela rota
// e pela carga de demonstração (com `at` e `silent`).

const db = require('../db');
const clock = require('./clock');
const economy = require('./economy');
const { fail } = require('./errors');
const { notify } = require('./notifications');
const { weekActionPoints, syncAchievements } = require('./progress');
const { advanceChallenges } = require('./challenges');
const { iso, int } = require('./util');

function findAction(id) {
  return db.prepare('SELECT * FROM actions WHERE id = ?').get(id) || null;
}

/** Quantas vezes (somando a quantidade) a pessoa registrou a ação no dia e na semana. */
function usage(userId, action, instant) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN local_date = ? THEN quantity ELSE 0 END), 0) AS today,
              COALESCE(SUM(CASE WHEN local_date >= ? AND local_date <= ? THEN quantity ELSE 0 END), 0) AS week
       FROM action_records
       WHERE user_id = ? AND kind = 'action' AND action_id = ?`,
    )
    .get(
      economy.dateKey(instant),
      economy.weekStartKey(instant),
      economy.weekEndKey(instant),
      userId,
      action.id,
    );
  return { today: row.today, week: row.week };
}

function remainingFor(action, used) {
  const daily = action.daily_limit ?? null;
  const weekly = action.weekly_limit ?? null;
  let remaining = null;
  if (daily !== null) remaining = Math.max(daily - used.today, 0);
  if (weekly !== null) {
    const left = Math.max(weekly - used.week, 0);
    remaining = remaining === null ? left : Math.min(remaining, left);
  }
  return remaining;
}

/** Quantas outras pessoas registraram cada ação hoje (por id da ação). */
function neighborsTodayByAction(userId) {
  const map = new Map();
  for (const row of db
    .prepare(
      `SELECT action_id, COUNT(DISTINCT user_id) AS people FROM action_records
       WHERE kind = 'action' AND local_date = ? AND user_id != ? AND action_id IS NOT NULL
       GROUP BY action_id`,
    )
    .all(economy.dateKey(clock.now()), userId)) {
    map.set(row.action_id, row.people);
  }
  return map;
}

function actionJson(row, user, neighbors = neighborsTodayByAction(user.id)) {
  const used = usage(user.id, row, clock.now());
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    categoryLabel: row.category_label,
    icon: row.icon,
    points: row.points,
    liters: row.liters,
    dailyLimit: row.daily_limit ?? null,
    weeklyLimit: row.weekly_limit ?? null,
    usedToday: used.today,
    usedThisWeek: used.week,
    remaining: remainingFor(row, used),
    neighborsToday: neighbors.get(row.id) || 0,
    info: row.info,
    infoIcon: row.info_icon,
    tags: JSON.parse(row.tags || '[]'),
    footerInfo: row.footer_info,
    footerIcon: row.footer_icon,
  };
}

function compareText(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function listActions(user, query = {}) {
  const category = String(query.category ?? '').toLowerCase();
  const search = String(query.search ?? '').toLowerCase();
  const rows = db
    .prepare('SELECT * FROM actions ORDER BY id')
    .all()
    .filter((row) => {
      if (category && category !== 'all') {
        if (
          String(row.category).toLowerCase() !== category &&
          String(row.category_label).toLowerCase() !== category
        ) {
          return false;
        }
      }
      if (search) {
        const haystack = `${row.title} ${row.description} ${row.tags}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  const neighbors = neighborsTodayByAction(user.id);
  const actions = rows.map((row) => actionJson(row, user, neighbors));
  if (query.sort === 'points') {
    actions.sort((a, b) => int(b.points) - int(a.points));
  } else if (query.sort === 'alphabetical') {
    actions.sort((a, b) => compareText(String(a.title), String(b.title)));
  } else {
    actions.sort((a, b) => int(a.id) - int(b.id));
  }
  return actions;
}

function recordJson(row) {
  return {
    id: row.id,
    actionId: row.action_id,
    kind: row.kind,
    title: row.title,
    categoryLabel: row.category_label,
    icon: row.icon,
    points: row.points,
    basePoints: row.base_points,
    capped: int(row.base_points) > int(row.points),
    liters: row.liters,
    quantity: row.quantity,
    notes: row.notes,
    dateTime: row.created_at,
  };
}

function listRecords(user, query = {}) {
  const raw = String(query.limit ?? '').trim();
  const parsed = /^[+-]?\d+$/.test(raw) ? Number.parseInt(raw, 10) : 100;
  const limit = Math.min(Math.max(parsed, 1), 500);
  return db
    .prepare(
      `SELECT * FROM action_records WHERE user_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(user.id, limit)
    .map(recordJson);
}

function times(count) {
  return count === 1 ? 'vez' : 'vezes';
}

/**
 * Registra uma ação aplicando os limites por ação e o teto semanal.
 * Devolve `{ record, capReached, challengeUpdates, newAchievements }`.
 * `at` e `silent` existem para a carga dos dados de demonstração.
 */
function registerAction(user, action, { quantity = 1, notes = null, at = null, silent = false } = {}) {
  const when = at ?? clock.now();
  const used = usage(user.id, action, when);
  const daily = action.daily_limit ?? null;
  const weekly = action.weekly_limit ?? null;
  if (daily !== null && used.today + quantity > daily) {
    const left = daily - used.today;
    fail(
      409,
      used.today >= daily
        ? `Você já registrou esta ação ${daily} ${times(daily)} hoje. Ela volta a valer amanhã.`
        : `Hoje você ainda pode registrar esta ação ${left} ${times(left)}.`,
    );
  }
  if (weekly !== null && used.week + quantity > weekly) {
    fail(
      409,
      `Esta ação pode ser registrada ${weekly} ${times(weekly)} por semana. Ela volta a valer na segunda-feira.`,
    );
  }

  const cap = economy.WEEKLY_CAP;
  const basePoints = int(action.points) * quantity;
  const weekBefore = weekActionPoints(user.id, when);
  const credited = Math.max(0, Math.min(basePoints, cap - weekBefore));

  const info = db
    .prepare(
      `INSERT INTO action_records
        (user_id, action_id, kind, title, category_label, icon, points, base_points,
         liters, quantity, notes, created_at, local_date)
       VALUES (?, ?, 'action', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user.id,
      action.id,
      action.title,
      action.category_label,
      action.icon,
      credited,
      basePoints,
      int(action.liters) * quantity,
      quantity,
      notes,
      iso(when),
      economy.dateKey(when),
    );
  const record = db.prepare('SELECT * FROM action_records WHERE id = ?').get(info.lastInsertRowid);

  const capReached = weekBefore < cap && weekBefore + credited >= cap;
  if (!silent) {
    let message;
    if (credited === basePoints) {
      message = `Você registrou "${action.title}" e ganhou +${credited} pontos.`;
    } else if (credited > 0) {
      message = `Você registrou "${action.title}" e ganhou +${credited} pontos (o restante passou do teto da semana).`;
    } else {
      message = `Você registrou "${action.title}". O teto semanal já foi atingido, então a ação conta para o histórico e os desafios, sem pontos.`;
    }
    notify(user.id, 'sistema', 'Ação registrada!', message, {
      target: '/meu-historico',
      at: when,
    });
    if (capReached) {
      notify(
        user.id,
        'sistema',
        'Teto semanal atingido',
        `Você chegou aos ${cap} pontos de ações desta semana. Continue registrando: as ações contam para desafios e conquistas, e os pontos voltam na segunda-feira.`,
        { target: '/progresso', at: when },
      );
    }
  }

  const challengeUpdates = advanceChallenges(user, action, quantity, when, { silent });
  const newAchievements = syncAchievements(user, { at: when, silent });

  return {
    record: recordJson(record),
    capReached,
    challengeUpdates,
    newAchievements,
  };
}

module.exports = {
  findAction,
  usage,
  actionJson,
  listActions,
  recordJson,
  listRecords,
  registerAction,
};
