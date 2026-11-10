const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('./config');
const { migrate } = require('./migrations');

if (config.dbPath !== ':memory:') {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
}

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// O esquema é criado e atualizado por migrações numeradas (`src/migrations.js`),
// controladas por `PRAGMA user_version`.
migrate(db);

module.exports = db;
