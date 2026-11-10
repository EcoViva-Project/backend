// Dados de referência: completam, na inicialização, um banco que veio de uma
// versão antiga da API.
//
// A migração 2 cria as colunas e tabelas novas, mas um banco criado pelo seed
// do ramo `main` fica com elas vazias: parceiros sem código de conferência
// (nenhum cupom pode ser conferido), ações sem limite por dia/semana e sem
// pontos de coleta, dicas e meta coletiva. Este passo preenche só o que falta,
// a partir do mesmo catálogo do seed (`src/catalog.js`):
//
// - `collection_points`, `tips` e `community_goals` vazias recebem os dados do
//   catálogo;
// - ações do catálogo (pelo título) sem nenhum limite recebem os limites do
//   catálogo; os pontos só mudam se ainda forem o valor padrão antigo daquela
//   ação (um valor trocado à mão nunca é sobrescrito);
// - recompensas e desafios do catálogo (pelo título) passam às regras novas
//   (preço, valor, validade, limite por pessoa, bônus, prazo, modo de
//   contagem e textos), campo a campo e só quando o campo ainda tem o valor
//   antigo daquele item; o que foi trocado à mão fica como está;
// - fora de produção, parceiros do catálogo (pelo nome) sem PIN recebem o PIN
//   de demonstração. Em produção esse PIN (público) não é gravado. Parceiros
//   que continuam sem PIN ficam como estão e geram um aviso no log.
//
// Roda a cada inicialização, logo depois das migrações, numa transação. Em um
// banco já completo (inclusive um recém-criado pelo seed) não muda nada.

const catalog = require('./catalog');

/** Pontos de cada ação no catálogo antigo (seed do ramo `main`). */
const OLD_ACTION_POINTS = {
  'Fechar a torneira ao escovar os dentes': 15,
  'Separar resíduos secos e orgânicos': 30,
  'Deslocamento a pé ou de bicicleta': 40,
  'Compostagem de resíduos orgânicos': 35,
  'Apagar luzes em cômodos vazios': 20,
  'Mutirão de limpeza de praça pública': 60,
};

/**
 * Recompensas no banco antigo depois da migração 2: preço e termos do seed do
 * `main`; as colunas novas ficam com o padrão da migração (`value_cents` 0,
 * `validity_days` 30, `per_user_limit` nulo).
 */
const OLD_REWARDS = {
  'Kit de sacolas reutilizáveis': {
    points_cost: 400,
    terms: 'Retire na loja em até 30 dias após o resgate.',
  },
  'Cesta de hortifrúti orgânico': {
    points_cost: 900,
    terms: 'Entrega agendada no bairro. Sujeito à disponibilidade da safra.',
  },
  'Limpeza ecológica residencial': {
    points_cost: 1200,
    terms: 'Agendamento com antecedência mínima de 3 dias.',
  },
  'Café especial grátis': { points_cost: 150, terms: 'Válido de segunda a sexta, das 8h às 17h.' },
  '15% de desconto no combo': { points_cost: 90, terms: 'Não cumulativo com outras promoções.' },
  'Skin Guardião da Floresta': {
    points_cost: 500,
    terms: 'Código enviado por e-mail após o resgate.',
  },
  'Passe de temporada Floresta Viva': {
    points_cost: 1500,
    terms: 'Código de uso único, vinculado à sua conta no jogo.',
  },
  'Revisão básica de bicicleta': {
    points_cost: 700,
    terms: 'Peças não inclusas. Agende pelo telefone da oficina.',
  },
  'Camisa oficial EcoViva': { points_cost: 650, terms: 'Tamanhos sujeitos ao estoque disponível.' },
};
const OLD_REWARD_DEFAULTS = { value_cents: 0, validity_days: 30, per_user_limit: null };

/**
 * Desafios no banco antigo depois da migração 2: bônus e descrição do seed do
 * `main`, `step_mode` 'days' (padrão da migração) e `duration_days` como a
 * migração calcula (maior entre 7, os dias restantes antigos e as etapas).
 */
const OLD_CHALLENGES = {
  'Semana sem desperdício de água': {
    points_reward: 120,
    description: 'Feche a torneira e reduza o tempo de banho por 7 dias.',
    duration_days: 7,
  },
  'Transporte ativo no bairro': {
    points_reward: 100,
    description: 'Faça 5 trajetos curtos a pé ou de bicicleta.',
    duration_days: 7,
  },
  'Mutirão da praça central': {
    points_reward: 150,
    description: 'Participe da limpeza e do plantio de mudas na praça do bairro.',
    duration_days: 12,
  },
  'Desafio da compostagem': {
    points_reward: 180,
    description: 'Separe resíduos orgânicos por 10 dias seguidos.',
    duration_days: 10,
  },
};
const OLD_CHALLENGE_DEFAULTS = { step_mode: 'days' };

const NO_PIN = "TRIM(COALESCE(pin, '')) = ''";

/**
 * Leva cada campo de um item do catálogo (pelo título) ao valor novo, mas só
 * se a linha ainda tiver o valor antigo daquele item. Um valor trocado à mão
 * nunca é sobrescrito, e rodar de novo não muda nada. Devolve quantas linhas
 * mudaram.
 */
function updateOldDefaults(db, table, items, oldValues, columns) {
  const touched = new Set();
  for (const item of items) {
    const old = oldValues[item.title];
    if (!old) continue;
    for (const column of columns) {
      if (!(column in old)) continue;
      // `IS` compara também valores nulos.
      const rows = db
        .prepare(
          `SELECT id FROM ${table} WHERE title = ? AND ${column} IS ? AND ${column} IS NOT ?`,
        )
        .all(item.title, old[column], item[column]);
      const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);
      for (const row of rows) {
        update.run(item[column], row.id);
        touched.add(row.id);
      }
    }
  }
  return touched.size;
}

function insertRow(db, table, values) {
  const columns = Object.keys(values);
  db.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  ).run(...columns.map((column) => values[column]));
}

function isEmpty(db, table) {
  return db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total === 0;
}

/**
 * Preenche o que falta. Devolve quantas linhas foram criadas ou alteradas e
 * os parceiros que continuam sem PIN. `log` recebe o aviso (padrão: console).
 */
function withDefaults(oldValues, defaults) {
  return Object.fromEntries(
    Object.entries(oldValues).map(([title, values]) => [title, { ...defaults, ...values }]),
  );
}

function ensureReferenceData(db, { log = console, production = false } = {}) {
  const result = db.transaction(() => {
    const changes = {
      collectionPoints: 0,
      tips: 0,
      communityGoals: 0,
      actions: 0,
      partners: 0,
      rewards: 0,
      challenges: 0,
    };

    if (isEmpty(db, 'collection_points')) {
      for (const point of catalog.loadCollectionPoints()) {
        insertRow(db, 'collection_points', point);
        changes.collectionPoints += 1;
      }
    }
    if (isEmpty(db, 'tips')) {
      for (const tip of catalog.TIPS) {
        insertRow(db, 'tips', tip);
        changes.tips += 1;
      }
    }
    if (isEmpty(db, 'community_goals')) {
      insertRow(db, 'community_goals', catalog.defaultCommunityGoal());
      changes.communityGoals += 1;
    }

    const updateAction = db.prepare(
      `UPDATE actions
          SET daily_limit = ?,
              weekly_limit = ?,
              points = CASE WHEN points = ? THEN ? ELSE points END
        WHERE title = ? AND daily_limit IS NULL AND weekly_limit IS NULL`,
    );
    for (const action of catalog.ACTIONS) {
      if (action.daily_limit === null && action.weekly_limit === null) continue;
      changes.actions += updateAction.run(
        action.daily_limit,
        action.weekly_limit,
        OLD_ACTION_POINTS[action.title] ?? null,
        action.points,
        action.title,
      ).changes;
    }

    changes.rewards = updateOldDefaults(
      db,
      'rewards',
      catalog.REWARDS,
      withDefaults(OLD_REWARDS, OLD_REWARD_DEFAULTS),
      ['points_cost', 'terms', 'value_cents', 'validity_days', 'per_user_limit'],
    );
    changes.challenges = updateOldDefaults(
      db,
      'challenges',
      catalog.CHALLENGES,
      withDefaults(OLD_CHALLENGES, OLD_CHALLENGE_DEFAULTS),
      ['points_reward', 'description', 'duration_days', 'step_mode'],
    );

    // O PIN de demonstração é público (está no repositório): em produção não é
    // gravado, e os parceiros sem PIN entram no aviso abaixo.
    if (!production) {
      const updatePartner = db.prepare(`UPDATE partners SET pin = ? WHERE name = ? AND ${NO_PIN}`);
      for (const partner of catalog.PARTNERS) {
        changes.partners += updatePartner.run(catalog.DEMO_PARTNER_PIN, partner.name).changes;
      }
    }

    const withoutPin = db
      .prepare(`SELECT name FROM partners WHERE ${NO_PIN} ORDER BY id`)
      .all()
      .map((row) => row.name);
    return { changes, withoutPin };
  })();

  if (result.withoutPin.length > 0) {
    log.warn(
      `Aviso: parceiros sem código de conferência (PIN): ${result.withoutPin.join(', ')}. ` +
        'Os cupons deles não podem ser conferidos até alguém definir o PIN na tabela partners.',
    );
  }
  return result;
}

module.exports = { ensureReferenceData, OLD_ACTION_POINTS, OLD_REWARDS, OLD_CHALLENGES };
