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
// - parceiros do catálogo (pelo nome) sem PIN recebem o PIN do catálogo;
//   outros parceiros sem PIN ficam como estão e geram um aviso no log.
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

const NO_PIN = "TRIM(COALESCE(pin, '')) = ''";

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
function ensureReferenceData(db, { log = console } = {}) {
  const result = db.transaction(() => {
    const changes = { collectionPoints: 0, tips: 0, communityGoals: 0, actions: 0, partners: 0 };

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

    const updatePartner = db.prepare(`UPDATE partners SET pin = ? WHERE name = ? AND ${NO_PIN}`);
    for (const partner of catalog.PARTNERS) {
      changes.partners += updatePartner.run(catalog.DEMO_PARTNER_PIN, partner.name).changes;
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

module.exports = { ensureReferenceData, OLD_ACTION_POINTS };
