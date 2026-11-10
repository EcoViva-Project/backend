// Migrações do banco, controladas por `PRAGMA user_version`.
//
// Cada migração roda uma única vez, dentro de uma transação, e sobe a versão
// do banco. Um banco novo passa por todas, em ordem; um banco antigo passa só
// pelas que faltam. Assim os dois chegam ao mesmo esquema.
//
// Para mudar o esquema: acrescente uma migração no fim da lista. Nunca edite
// uma migração que já foi aplicada em algum banco.

const crypto = require('node:crypto');
const {
  approximatePosition,
  DEFAULT_CITY,
  DEFAULT_STATE,
} = require('./services/places');

/** Versão 1: o esquema original (antes de existir controle de versão). */
const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  neighborhood TEXT NOT NULL DEFAULT 'Jardim das Flores',
  initials TEXT NOT NULL,
  monthly_goal INTEGER NOT NULL DEFAULT 17,
  weekly_goal INTEGER NOT NULL DEFAULT 5,
  notifications_enabled INTEGER NOT NULL DEFAULT 1,
  reminders_enabled INTEGER NOT NULL DEFAULT 1,
  privacy_profile INTEGER NOT NULL DEFAULT 1,
  privacy_location INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  category_label TEXT NOT NULL,
  icon TEXT NOT NULL,
  points INTEGER NOT NULL,
  liters INTEGER NOT NULL DEFAULT 12,
  info TEXT,
  info_icon TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  footer_info TEXT,
  footer_icon TEXT
);

CREATE TABLE IF NOT EXISTS action_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  action_id INTEGER,
  title TEXT NOT NULL,
  category_label TEXT NOT NULL,
  icon TEXT NOT NULL,
  points INTEGER NOT NULL,
  liters INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (action_id) REFERENCES actions(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_action_records_user_date
  ON action_records(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_date
  ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  icon TEXT NOT NULL,
  target_steps INTEGER NOT NULL,
  points_reward INTEGER NOT NULL,
  participants INTEGER NOT NULL DEFAULT 0,
  days_left INTEGER NOT NULL DEFAULT 0,
  is_weekly INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS challenge_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  challenge_id INTEGER NOT NULL,
  completed_steps INTEGER NOT NULL DEFAULT 0,
  joined INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, challenge_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  logo_icon TEXT NOT NULL DEFAULT 'storefront',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  category_label TEXT NOT NULL,
  icon TEXT NOT NULL,
  points_cost INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  terms TEXT,
  is_featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rewards_category
  ON rewards(category, points_cost);

CREATE TABLE IF NOT EXISTS redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  reward_id INTEGER NOT NULL,
  code TEXT NOT NULL UNIQUE,
  points_spent INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reward_id) REFERENCES rewards(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_redemptions_user_date
  ON redemptions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  author_name TEXT NOT NULL,
  author_initials TEXT NOT NULL,
  content TEXT NOT NULL,
  base_likes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS post_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER,
  author_name TEXT NOT NULL,
  author_initials TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_post_comments_post
  ON post_comments(post_id, created_at ASC);
`;

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

/**
 * Versão 2: economia de pontos (teto, limites, bônus), desafios com prazo,
 * cupons com validade e conferência, conquistas com data e as colunas de
 * segurança. Os nomes das colunas são os de `localSchema`, no app
 * (`eco-app/lib/core/local/local_store.dart`).
 */
function migrateToV2(db, { now }) {
  const nowIso = now.toISOString();

  db.exec(`
    -- Sessões: trocar a senha invalida os tokens antigos.
    ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;

    -- Endereço e posição aproximada (centro do bairro com deslocamento fixo).
    ALTER TABLE users ADD COLUMN cep TEXT;
    ALTER TABLE users ADD COLUMN street TEXT;
    ALTER TABLE users ADD COLUMN number TEXT;
    ALTER TABLE users ADD COLUMN complement TEXT;
    ALTER TABLE users ADD COLUMN city TEXT;
    ALTER TABLE users ADD COLUMN state TEXT;
    ALTER TABLE users ADD COLUMN lat REAL;
    ALTER TABLE users ADD COLUMN lon REAL;

    -- Recuperação de senha: tentativas por código.
    ALTER TABLE password_resets ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;

    -- Limites por ação.
    ALTER TABLE actions ADD COLUMN daily_limit INTEGER;
    ALTER TABLE actions ADD COLUMN weekly_limit INTEGER;

    -- Registros: tipo (ação, bônus de desafio, bônus de conquista), pontos
    -- cheios antes do teto e o dia local de Brasília (UTC-3).
    ALTER TABLE action_records ADD COLUMN kind TEXT NOT NULL DEFAULT 'action';
    ALTER TABLE action_records ADD COLUMN base_points INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE action_records ADD COLUMN local_date TEXT NOT NULL DEFAULT '';
    UPDATE action_records
       SET base_points = points,
           local_date = COALESCE(date(created_at, '-3 hours'), substr(created_at, 1, 10)),
           kind = CASE
             WHEN action_id IS NULL AND title LIKE 'Desafio concluído: %' THEN 'challenge'
             ELSE 'action'
           END;
    CREATE INDEX IF NOT EXISTS idx_action_records_user_kind_date
      ON action_records(user_id, kind, local_date);

    -- Notificações: tela de destino.
    ALTER TABLE notifications ADD COLUMN target TEXT;

    -- Desafios: modo de contagem, prazo pessoal e participantes calculados.
    ALTER TABLE challenges ADD COLUMN step_mode TEXT NOT NULL DEFAULT 'days';
    ALTER TABLE challenges ADD COLUMN base_participants INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE challenges ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 7;
    UPDATE challenges
       SET base_participants = MAX(
             participants - (
               SELECT COUNT(*) FROM challenge_progress cp
                WHERE cp.challenge_id = challenges.id AND cp.joined = 1
             ),
             0
           ),
           duration_days = MAX(7, days_left, target_steps);
    ALTER TABLE challenges DROP COLUMN participants;
    ALTER TABLE challenges DROP COLUMN days_left;

    ALTER TABLE challenge_progress ADD COLUMN joined_at TEXT;
    ALTER TABLE challenge_progress ADD COLUMN completed_at TEXT;
    ALTER TABLE challenge_progress ADD COLUMN last_step_date TEXT;

    -- Parceiros: endereço e código de conferência do cupom.
    ALTER TABLE partners ADD COLUMN address TEXT;
    ALTER TABLE partners ADD COLUMN pin TEXT NOT NULL DEFAULT '';

    -- Recompensas: valor do benefício, validade e limite por pessoa.
    ALTER TABLE rewards ADD COLUMN value_cents INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE rewards ADD COLUMN validity_days INTEGER NOT NULL DEFAULT 30;
    ALTER TABLE rewards ADD COLUMN per_user_limit INTEGER;

    -- Cupons: validade e data de uso; a situação passa a ser calculada.
    ALTER TABLE redemptions ADD COLUMN expires_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE redemptions ADD COLUMN used_at TEXT;
    UPDATE redemptions
       SET expires_at = COALESCE(
             strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+30 days'),
             created_at
           ),
           used_at = CASE WHEN status = 'used' THEN created_at ELSE NULL END;
    ALTER TABLE redemptions DROP COLUMN status;

    -- Conquistas desbloqueadas, com a data.
    CREATE TABLE user_achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      achievement_key TEXT NOT NULL,
      unlocked_at TEXT NOT NULL,
      UNIQUE (user_id, achievement_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Bairro: pontos de coleta, meta coletiva da semana e dicas do dia.
    CREATE TABLE collection_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      materials TEXT NOT NULL DEFAULT '[]',
      address TEXT,
      neighborhood TEXT,
      cep TEXT,
      hours TEXT,
      phone TEXT,
      responsible TEXT,
      lat REAL,
      lon REAL,
      coord_precision TEXT,
      source_url TEXT,
      source_date TEXT,
      confidence TEXT,
      notes TEXT
    );

    CREATE TABLE community_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      target_actions INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE tips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      category_label TEXT NOT NULL,
      icon TEXT NOT NULL
    );

    CREATE INDEX idx_action_records_kind_date ON action_records(kind, local_date);
  `);

  // Posição aproximada de quem já tinha conta (pelo bairro e pelo e-mail).
  // A preferência de aparecer no mapa é mantida como estava.
  const setPlace = db.prepare(
    'UPDATE users SET city = ?, state = ?, lat = ?, lon = ? WHERE id = ?',
  );
  for (const user of db.prepare('SELECT id, email, neighborhood FROM users').all()) {
    const position = approximatePosition(user.neighborhood, String(user.email).toLowerCase());
    setPlace.run(
      DEFAULT_CITY,
      DEFAULT_STATE,
      position?.lat ?? null,
      position?.lon ?? null,
      user.id,
    );
  }

  // Quem já estava em um desafio começa o prazo pessoal agora.
  db.prepare('UPDATE challenge_progress SET joined_at = ? WHERE joined = 1').run(nowIso);
  db.prepare(
    `UPDATE challenge_progress
        SET completed_at = COALESCE(
              (SELECT MAX(r.created_at)
                 FROM action_records r
                 JOIN challenges c ON c.id = challenge_progress.challenge_id
                WHERE r.user_id = challenge_progress.user_id
                  AND r.kind = 'challenge'
                  AND r.title = 'Desafio concluído: ' || c.title),
              ?
            )
      WHERE completed = 1`,
  ).run(nowIso);

  // Códigos de recuperação pendentes deixam de ficar em texto puro.
  const update = db.prepare('UPDATE password_resets SET code = ? WHERE id = ?');
  for (const row of db.prepare('SELECT id, code FROM password_resets').all()) {
    update.run(sha256(row.code), row.id);
  }
}

const MIGRATIONS = [
  { version: 1, name: 'esquema original', up: (db) => db.exec(SCHEMA_V1) },
  { version: 2, name: 'economia de pontos, cupons e segurança', up: migrateToV2 },
];

const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/**
 * Aplica as migrações pendentes. Devolve as versões de partida e de chegada.
 * `now` só existe para os testes fixarem a data usada no preenchimento.
 */
function migrate(db, { now = new Date() } = {}) {
  const from = db.pragma('user_version', { simple: true });
  if (from > SCHEMA_VERSION) {
    throw new Error(
      `O banco está na versão ${from}, mais nova que a deste código (${SCHEMA_VERSION}). Atualize a API.`,
    );
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;
    db.transaction(() => {
      migration.up(db, { now });
      db.pragma(`user_version = ${migration.version}`);
    })();
  }

  return { from, to: SCHEMA_VERSION };
}

module.exports = { migrate, MIGRATIONS, SCHEMA_VERSION, sha256 };
