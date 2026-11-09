const db = require('../db');

const ALL_CATEGORIES = [
  'Água',
  'Reciclagem',
  'Alimentação',
  'Transporte',
  'Energia',
  'Espaços Públicos',
];

const CATEGORY_FRIENDLY_NAMES = {
  'Água': 'Água',
  'Reciclagem': 'Reciclagem',
  'Alimentação': 'Alimentação',
  'Transporte': 'Mobilidade Urbana / Transporte sustentável',
  'Energia': 'Energia',
  'Espaços Públicos': 'Espaços Públicos',
};

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function levelFromPoints(points) {
  if (points < 500) return 'Semente • Nível 1';
  if (points < 1000) return 'Broto • Nível 2';
  if (points < 1500) return 'Guardiã Verde • Nível 3';
  if (points < 2500) return 'Guardiã do Bairro • Nível 4';
  return 'Guardiã do Planeta • Nível 5';
}

function getSummary(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return null;

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS actionsCount,
              COALESCE(SUM(points), 0) AS points,
              COALESCE(SUM(liters), 0) AS litersSaved
       FROM action_records WHERE user_id = ?`,
    )
    .get(userId);

  const activeDays = db
    .prepare(
      `SELECT COUNT(DISTINCT substr(created_at, 1, 10)) AS activeDays
       FROM action_records WHERE user_id = ?`,
    )
    .get(userId).activeDays;

  const monthlyActions = db
    .prepare(
      `SELECT COUNT(*) AS total FROM action_records
       WHERE user_id = ? AND substr(created_at, 1, 7) = ?`,
    )
    .get(userId, currentMonth()).total;

  const monthlyGoal = user.monthly_goal || 17;

  const pointsSpent = db
    .prepare(
      `SELECT COALESCE(SUM(points_spent), 0) AS total
       FROM redemptions WHERE user_id = ?`,
    )
    .get(userId).total;
  const pointsEarned = totals.points;
  const availablePoints = Math.max(pointsEarned - pointsSpent, 0);

  return {
    points: availablePoints,
    pointsEarned,
    pointsSpent,
    actionsCount: totals.actionsCount,
    activeDays,
    monthlyActions,
    monthlyGoal,
    monthlyGoalProgress: Math.min(monthlyActions / monthlyGoal, 1),
    litersSaved: totals.litersSaved,
    level: levelFromPoints(pointsEarned),
  };
}

function getAchievements(userId) {
  const summary = getSummary(userId);
  if (!summary) return [];

  const categoryRows = db
    .prepare(
      `SELECT category_label AS category, COUNT(*) AS total
       FROM action_records WHERE user_id = ? GROUP BY category_label`,
    )
    .all(userId);
  const categories = new Set(categoryRows.map((row) => row.category));
  const countByCategory = Object.fromEntries(
    categoryRows.map((row) => [row.category, row.total]),
  );

  const completedChallenges = db
    .prepare(
      `SELECT COUNT(*) AS total FROM challenge_progress
       WHERE user_id = ? AND completed = 1`,
    )
    .get(userId).total;

  const missingCategory = ALL_CATEGORIES.find((category) => !categories.has(category));

  const definitions = [
    {
      icon: 'eco',
      title: 'Primeiros Passos',
      points: 30,
      description: 'Registrou sua primeira ação sustentável no aplicativo.',
      current: summary.actionsCount,
      target: 1,
    },
    {
      icon: 'water_drop',
      title: 'Guardião da Água',
      points: 50,
      description: 'Poupou mais de 20 litros de água em hábitos diários.',
      current: summary.litersSaved,
      target: 20,
    },
    {
      icon: 'calendar_month',
      title: 'Consistência Verde',
      points: 60,
      description: 'Realizou ações ecológicas por 4 dias seguidos na semana.',
      current: summary.activeDays,
      target: 4,
    },
    {
      icon: 'diversity_1',
      title: 'Força Coletiva',
      points: 80,
      description: 'Participou de 1 desafio coletivo do seu bairro.',
      current: completedChallenges,
      target: 1,
    },
    {
      icon: 'category',
      title: 'Consciência Plena',
      points: 100,
      description: 'Experimente hábitos em 4 categorias diferentes.',
      current: categories.size,
      target: 4,
      missing: missingCategory
        ? `Falta apenas: ${CATEGORY_FRIENDLY_NAMES[missingCategory]}.`
        : null,
    },
    {
      icon: 'compost',
      title: 'Mestre da Compostagem',
      points: 70,
      description: 'Registre 5 ações de compostagem ou separação orgânica.',
      current: countByCategory['Alimentação'] || 0,
      target: 5,
    },
    {
      icon: 'handshake',
      title: 'Vizinho Exemplar',
      points: 150,
      description: 'Complete 3 desafios coletivos com a comunidade.',
      current: completedChallenges,
      target: 3,
    },
    {
      icon: 'water_drop_outlined',
      title: 'Economizador de Água',
      points: 90,
      description: 'Reduza 30% do consumo de água por 7 dias.',
      current: summary.activeDays,
      target: 7,
    },
    {
      icon: 'directions_bike',
      title: 'Mobilidade Ativa',
      points: 60,
      description: 'Faça 5 trajetos curtos a pé ou de bicicleta.',
      current: countByCategory['Transporte'] || 0,
      target: 5,
    },
    {
      icon: 'bolt',
      title: 'Guardião da Energia',
      points: 80,
      description: 'Registre 6 ações de economia de energia.',
      current: countByCategory['Energia'] || 0,
      target: 6,
    },
  ];

  return definitions.map((definition) => {
    const isUnlocked = definition.current >= definition.target;
    const progress = Math.min(definition.current / definition.target, 1);
    return {
      ...definition,
      isUnlocked,
      progress,
      unlockedOn: isUnlocked ? null : null,
      progressLabel: isUnlocked
        ? null
        : `${definition.current} de ${definition.target}`,
    };
  });
}

module.exports = { getSummary, getAchievements, levelFromPoints };
