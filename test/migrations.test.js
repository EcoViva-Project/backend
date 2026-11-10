// Migrações do banco: um banco antigo (esquema do ramo `main`, sem versão)
// chega ao mesmo esquema de um banco criado do zero, com os dados preenchidos.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

process.env.DB_PATH = ':memory:';
const { migrate, MIGRATIONS, SCHEMA_VERSION, sha256 } = require('../src/migrations');
const places = require('../src/services/places');

function schemaOf(db) {
  const objects = db
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`,
    )
    .all()
    .map((row) => ({ ...row, sql: String(row.sql).replace(/\s+/g, ' ') }));
  const columns = {};
  for (const { name } of objects.filter((item) => item.type === 'table')) {
    columns[name] = db.prepare(`PRAGMA table_info(${name})`).all();
  }
  return { objects, columns };
}

function oldDatabase() {
  // Banco como era no ramo `main`: só o esquema original, sem user_version.
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  MIGRATIONS[0].up(db);
  assert.equal(db.pragma('user_version', { simple: true }), 0);

  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, neighborhood, initials, created_at)
     VALUES (1, 'Ana Silva', 'ana@test.app', 'hash', 'Boa Vista', 'AS', '2026-10-01T12:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO actions (id, title, description, category, category_label, icon, points)
     VALUES (1, 'Torneira', 'Fechar', 'agua', 'Água', 'water_drop', 15)`,
  ).run();
  db.prepare(
    `INSERT INTO challenges (id, title, description, category, icon, target_steps, points_reward,
                             participants, days_left, is_weekly)
     VALUES (1, 'Semana da água', 'Desc', 'Água', 'water_drop', 7, 120, 25, 3, 1)`,
  ).run();
  db.prepare(
    `INSERT INTO challenge_progress (user_id, challenge_id, completed_steps, joined, completed)
     VALUES (1, 1, 7, 1, 1)`,
  ).run();
  const record = db.prepare(
    `INSERT INTO action_records (user_id, action_id, title, category_label, icon, points, created_at)
     VALUES (1, ?, ?, 'Água', 'water_drop', ?, ?)`,
  );
  // 22h do dia 31/10 em Brasília (01/11 em UTC).
  record.run(1, 'Torneira', 15, '2026-11-01T01:00:00.000Z');
  record.run(null, 'Desafio concluído: Semana da água', 120, '2026-11-02T15:00:00.000Z');
  db.prepare(
    `INSERT INTO partners (id, name, logo_icon, created_at)
     VALUES (1, 'Café', 'local_cafe', '2026-10-01T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO rewards (id, partner_id, title, description, category, category_label, icon,
                          points_cost, stock, created_at)
     VALUES (1, 1, 'Café', 'Um café', 'gastronomia', 'Gastronomia', 'local_cafe', 150, 5,
             '2026-10-01T00:00:00.000Z')`,
  ).run();
  const redemption = db.prepare(
    `INSERT INTO redemptions (user_id, reward_id, code, points_spent, status, created_at)
     VALUES (1, 1, ?, 150, ?, '2026-11-03T10:00:00.000Z')`,
  );
  redemption.run('ECO-AAAA0001', 'active');
  redemption.run('ECO-AAAA0002', 'used');
  db.prepare(
    `INSERT INTO password_resets (user_id, code, expires_at) VALUES (1, '123456', '2026-11-03T10:30:00.000Z')`,
  ).run();
  return db;
}

test('banco novo chega à versão atual com todas as tabelas', () => {
  const db = new Database(':memory:');
  const result = migrate(db);
  assert.deepEqual(result, { from: 0, to: SCHEMA_VERSION });
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  const tables = schemaOf(db).objects.filter((item) => item.type === 'table').map((t) => t.name);
  for (const name of [
    'user_achievements',
    'collection_points',
    'community_goals',
    'tips',
    'redemptions',
  ]) {
    assert.ok(tables.includes(name), name);
  }
  // Rodar de novo não muda nada.
  assert.deepEqual(migrate(db), { from: SCHEMA_VERSION, to: SCHEMA_VERSION });
});

test('banco antigo migrado fica com o mesmo esquema de um banco novo', () => {
  const fresh = new Database(':memory:');
  migrate(fresh);
  const old = oldDatabase();
  const now = new Date('2026-11-11T18:00:00.000Z');
  assert.deepEqual(migrate(old, { now }), { from: 0, to: SCHEMA_VERSION });
  assert.deepEqual(schemaOf(old), schemaOf(fresh));
});

test('a migração preenche os dados existentes', () => {
  const db = oldDatabase();
  const now = new Date('2026-11-11T18:00:00.000Z');
  migrate(db, { now });

  const records = db.prepare('SELECT * FROM action_records ORDER BY id').all();
  assert.equal(records[0].kind, 'action');
  assert.equal(records[0].base_points, 15);
  assert.equal(records[0].local_date, '2026-10-31');
  assert.equal(records[1].kind, 'challenge');
  assert.equal(records[1].local_date, '2026-11-02');

  const challenge = db.prepare('SELECT * FROM challenges').get();
  assert.equal(challenge.base_participants, 24);
  assert.equal(challenge.duration_days, 7);
  assert.equal(challenge.step_mode, 'days');
  assert.equal('participants' in challenge, false);

  const progress = db.prepare('SELECT * FROM challenge_progress').get();
  assert.equal(progress.joined_at, now.toISOString());
  assert.equal(progress.completed_at, '2026-11-02T15:00:00.000Z');

  const [active, used] = db.prepare('SELECT * FROM redemptions ORDER BY id').all();
  assert.equal(active.expires_at, '2026-12-03T10:00:00.000Z');
  assert.equal(active.used_at, null);
  assert.equal(used.used_at, '2026-11-03T10:00:00.000Z');
  assert.equal('status' in active, false);

  const user = db.prepare('SELECT * FROM users').get();
  assert.equal(user.token_version, 0);
  assert.equal(user.city, places.DEFAULT_CITY);
  assert.deepEqual(
    { lat: user.lat, lon: user.lon },
    places.approximatePosition('Boa Vista', 'ana@test.app'),
  );

  const reset = db.prepare('SELECT * FROM password_resets').get();
  assert.equal(reset.code, sha256('123456'));
  assert.equal(reset.attempts, 0);
});

test('banco mais novo que o código é recusado', () => {
  const db = new Database(':memory:');
  db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
  assert.throws(() => migrate(db), /mais nova/);
});

test('os dados sobrevivem a fechar e abrir o banco em arquivo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-db-'));
  const file = path.join(dir, 'eco.db');
  try {
    let db = new Database(file);
    migrate(db);
    db.prepare(
      `INSERT INTO tips (text, category_label, icon) VALUES ('Gravado no disco', 'Água', 'water_drop')`,
    ).run();
    db.close();

    db = new Database(file);
    assert.deepEqual(migrate(db), { from: SCHEMA_VERSION, to: SCHEMA_VERSION });
    assert.equal(db.prepare('SELECT text FROM tips').get().text, 'Gravado no disco');
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
