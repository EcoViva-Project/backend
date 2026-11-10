const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('./config');
const { migrate } = require('./migrations');
const { ensureReferenceData } = require('./referenceData');

if (config.dbPath !== ':memory:') {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
}

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// O esquema é criado e atualizado por migrações numeradas (`src/migrations.js`),
// controladas por `PRAGMA user_version`. Depois, os dados de referência
// completam o que um banco de versão antiga deixou vazio (`src/referenceData.js`).
migrate(db);
ensureReferenceData(db);

module.exports = db;
