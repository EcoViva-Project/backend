// Resumo do usuário (pontos, nível, teto semanal, sequência) e conquistas.
//
// Espelha `_summary`, `_achievementStates` e `syncAchievements` de
// `eco-app/lib/core/local/local_api.dart`.

const db = require('../db');
const clock = require('./clock');
const economy = require('./economy');
const { notify } = require('./notifications');
const { iso, int, parseDate } = require('./util');

/** Pontos de ações creditados na semana local que contém o instante. */
function weekActionPoints(userId, instant) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(points), 0) AS total FROM action_records
       WHERE user_id = ? AND kind = 'action' AND local_date >= ? AND local_date <= ?`,
    )
    .get(userId, economy.weekStartKey(instant), economy.weekEndKey(instant)).total;
}

/** Sequência atual (até hoje ou ontem) e melhor sequência de dias com ação. */
function streaks(days, instant) {
  if (days.size === 0) return { current: 0, best: 0 };
  const sorted = [...days].sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    run = economy.shiftDateKey(sorted[i - 1], 1) === sorted[i] ? run + 1 : 1;
    if (run > best) best = run;
  }
  const today = economy.dateKey(instant);
  let cursor = days.has(today) ? today : economy.shiftDateKey(today, -1);
  let current = 0;
  while (days.has(cursor)) {
    current += 1;
    cursor = economy.shiftDateKey(cursor, -1);
  }
  return { current, best };
}

function actionDays(userId) {
  return new Set(
    db
      .prepare(
        `SELECT DISTINCT local_date FROM action_records WHERE user_id = ? AND kind = 'action'`,
      )
      .all(userId)
      .map((row) => row.local_date),
  );
}

function summary(user) {
  const now = clock.now();
  const userId = user.id;
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(points), 0) AS earned,
              COALESCE(SUM(CASE WHEN kind = 'action' THEN 1 ELSE 0 END), 0) AS actions,
              COALESCE(SUM(CASE WHEN kind = 'action' THEN liters ELSE 0 END), 0) AS liters,
              COALESCE(SUM(CASE WHEN kind = 'action' AND substr(local_date, 1, 7) = ? THEN 1 ELSE 0 END), 0) AS monthly
       FROM action_records WHERE user_id = ?`,
    )
    .get(economy.monthKey(now), userId);
  const spent = db
    .prepare('SELECT COALESCE(SUM(points_spent), 0) AS total FROM redemptions WHERE user_id = ?')
    .get(userId).total;
  const days = actionDays(userId);
  const goal = Math.max(1, int(user.monthly_goal, 17));
  const weekly = weekActionPoints(userId, now);
  const level = economy.levelFor(totals.earned);
  const streak = streaks(days, now);

  return {
    points: Math.max(totals.earned - spent, 0),
    pointsEarned: totals.earned,
    pointsSpent: spent,
    actionsCount: totals.actions,
    activeDays: days.size,
    monthlyActions: totals.monthly,
    monthlyGoal: goal,
    monthlyGoalProgress: Math.min(totals.monthly / goal, 1.0),
    litersSaved: totals.liters,
    level: level.label,
    levelNumber: level.number,
    levelName: level.name,
    levelFloor: level.floor,
    nextLevelAt: level.next,
    weeklyPoints: weekly,
    weeklyCap: economy.WEEKLY_CAP,
    weeklyRemaining: Math.max(economy.WEEKLY_CAP - weekly, 0),
    weekResetsAt: iso(economy.nextWeekReset(now)),
    streakDays: streak.current,
    bestStreak: streak.best,
  };
}

// ---------------------------------------------------------------------------
// Conquistas
// ---------------------------------------------------------------------------

const ALL_CATEGORIES = [
  'Água',
  'Reciclagem',
  'Alimentação',
  'Transporte',
  'Energia',
  'Espaços Públicos',
];

/** Situação de cada uma das 10 conquistas para o usuário. */
function achievementStates(user) {
  const userId = user.id;
  const actions = db
    .prepare(
      `SELECT category_label, quantity, liters, local_date FROM action_records
       WHERE user_id = ? AND kind = 'action' ORDER BY id`,
    )
    .all(userId);
  const days = new Set(actions.map((row) => row.local_date));
  const countByCategory = new Map();
  const waterDays = new Set();
  let liters = 0;
  for (const row of actions) {
    const category = String(row.category_label);
    countByCategory.set(category, (countByCategory.get(category) || 0) + int(row.quantity, 1));
    liters += int(row.liters);
    if (category === 'Água') waterDays.add(row.local_date);
  }
  const categories = new Set(countByCategory.keys());
  const completedChallenges = db
    .prepare(
      'SELECT COUNT(*) AS total FROM challenge_progress WHERE user_id = ? AND completed = 1',
    )
    .get(userId).total;
  const bestStreak = streaks(days, clock.now()).best;
  const missing = ALL_CATEGORIES.filter((category) => !categories.has(category));

  return [
    {
      key: 'primeiros-passos',
      icon: 'eco',
      title: 'Primeiros Passos',
      points: 30,
      description: 'Registre sua primeira ação sustentável no aplicativo.',
      current: actions.length,
      target: 1,
    },
    {
      key: 'guardiao-da-agua',
      icon: 'water_drop',
      title: 'Guardião da Água',
      points: 50,
      description: 'Poupe 100 litros de água com hábitos diários.',
      current: liters,
      target: 100,
      unit: 'litros',
    },
    {
      key: 'consistencia-verde',
      icon: 'calendar_month',
      title: 'Consistência Verde',
      points: 60,
      description: 'Registre ações por 4 dias seguidos.',
      current: bestStreak,
      target: 4,
      unit: 'dias seguidos',
    },
    {
      key: 'forca-coletiva',
      icon: 'diversity_1',
      title: 'Força Coletiva',
      points: 80,
      description: 'Conclua seu primeiro desafio coletivo do bairro.',
      current: completedChallenges,
      target: 1,
      unit: 'desafio',
    },
    {
      key: 'consciencia-plena',
      icon: 'category',
      title: 'Consciência Plena',
      points: 100,
      description: 'Experimente hábitos em 4 categorias diferentes.',
      current: categories.size,
      target: 4,
      unit: 'categorias',
      missing:
        missing.length === 0 || categories.size >= 4
          ? null
          : `Ainda não experimentou: ${missing.join(', ')}.`,
    },
    {
      key: 'mestre-da-compostagem',
      icon: 'compost',
      title: 'Mestre da Compostagem',
      points: 70,
      description: 'Registre 5 ações de Alimentação, como a compostagem.',
      current: countByCategory.get('Alimentação') || 0,
      target: 5,
      unit: 'ações',
    },
    {
      key: 'vizinho-exemplar',
      icon: 'handshake',
      title: 'Vizinho Exemplar',
      points: 150,
      description: 'Conclua 3 desafios coletivos com a comunidade.',
      current: completedChallenges,
      target: 3,
      unit: 'desafios',
    },
    {
      key: 'economizador-de-agua',
      icon: 'water_drop_outlined',
      title: 'Economizador de Água',
      points: 90,
      description: 'Registre ações de Água em 7 dias diferentes.',
      current: waterDays.size,
      target: 7,
      unit: 'dias',
    },
    {
      key: 'mobilidade-ativa',
      icon: 'directions_bike',
      title: 'Mobilidade Ativa',
      points: 60,
      description: 'Faça 5 trajetos curtos a pé ou de bicicleta.',
      current: countByCategory.get('Transporte') || 0,
      target: 5,
      unit: 'trajetos',
    },
    {
      key: 'guardiao-da-energia',
      icon: 'bolt',
      title: 'Guardião da Energia',
      points: 80,
      description: 'Registre 6 ações de economia de energia.',
      current: countByCategory.get('Energia') || 0,
      target: 6,
      unit: 'ações',
    },
  ];
}

function achievementJson(state, unlock) {
  const unlockedAt = parseDate(unlock?.unlocked_at);
  const isUnlocked = Boolean(unlock);
  const shown = state.current > state.target ? state.target : state.current;
  return {
    key: state.key,
    icon: state.icon,
    title: state.title,
    points: state.points,
    description: state.description,
    current: isUnlocked ? state.target : shown,
    target: state.target,
    missing: isUnlocked ? null : (state.missing ?? null),
    isUnlocked,
    progress: isUnlocked ? 1.0 : Math.min(Math.max(shown / state.target, 0), 1),
    unlockedAt: unlock?.unlocked_at ?? null,
    unlockedOn: unlockedAt ? economy.longDate(unlockedAt) : null,
    progressLabel: isUnlocked
      ? null
      : `${shown} de ${state.target}${state.unit ? ` ${state.unit}` : ''}`,
  };
}

function unlocksOf(userId) {
  const map = new Map();
  for (const row of db
    .prepare('SELECT * FROM user_achievements WHERE user_id = ?')
    .all(userId)) {
    map.set(row.achievement_key, row);
  }
  return map;
}

/**
 * Grava as conquistas recém-atingidas, credita o bônus (registro do tipo
 * `achievement`, fora do teto semanal) e avisa o usuário.
 * `at` e `silent` existem para a carga dos dados de demonstração.
 */
function syncAchievements(user, { at = null, silent = false } = {}) {
  const when = at ?? clock.now();
  const unlocked = unlocksOf(user.id);
  const unlockedNow = [];
  for (const state of achievementStates(user)) {
    if (state.current < state.target || unlocked.has(state.key)) continue;
    const info = db
      .prepare(
        'INSERT INTO user_achievements (user_id, achievement_key, unlocked_at) VALUES (?, ?, ?)',
      )
      .run(user.id, state.key, iso(when));
    db.prepare(
      `INSERT INTO action_records
        (user_id, action_id, kind, title, category_label, icon, points, base_points,
         liters, quantity, notes, created_at, local_date)
       VALUES (?, NULL, 'achievement', ?, 'Conquista', ?, ?, ?, 0, 1, 'Bônus de conquista', ?, ?)`,
    ).run(
      user.id,
      `Conquista: ${state.title}`,
      state.icon,
      state.points,
      state.points,
      iso(when),
      economy.dateKey(when),
    );
    if (!silent) {
      notify(
        user.id,
        'conquista',
        'Novo selo desbloqueado!',
        `Você conquistou o selo "${state.title}" e ganhou +${state.points} pontos de bônus.`,
        { target: '/conquistas', at: when },
      );
    }
    const unlock = db
      .prepare('SELECT * FROM user_achievements WHERE id = ?')
      .get(info.lastInsertRowid);
    unlockedNow.push(achievementJson(state, unlock));
  }
  return unlockedNow;
}

/** Lista das conquistas (sincronizando antes as recém-atingidas). */
function achievements(user) {
  syncAchievements(user);
  const unlocked = unlocksOf(user.id);
  return achievementStates(user).map((state) =>
    achievementJson(state, unlocked.get(state.key)),
  );
}

module.exports = {
  ALL_CATEGORIES,
  weekActionPoints,
  streaks,
  summary,
  achievementStates,
  syncAchievements,
  achievements,
};
