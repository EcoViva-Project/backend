// Contas: criação, formato público do usuário e atualização do perfil.

const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const clock = require('./clock');
const places = require('./places');
const { fail } = require('./errors');
const { iso, flag, clean, initialsFor } = require('./util');
const {
  validateName,
  validateNeighborhood,
  validateGoal,
  addressFrom,
} = require('./validation');

function findUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

function findUserByEmail(email) {
  return (
    db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase()) ||
    null
  );
}

function hashPassword(password) {
  return bcrypt.hashSync(password, config.bcryptRounds);
}

/**
 * Usuário como aparece para ele mesmo. Rotas de comunidade nunca usam este
 * formato: lá só vão nome curto, iniciais, bairro e posição aproximada.
 */
function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    neighborhood: user.neighborhood,
    city: user.city ?? null,
    address: {
      cep: user.cep ?? null,
      street: user.street ?? null,
      number: user.number ?? null,
      complement: user.complement ?? null,
      neighborhood: user.neighborhood,
      city: user.city ?? null,
      state: user.state ?? null,
    },
    // Posição aproximada (região do bairro), nunca o endereço exato.
    location: user.lat === null || user.lat === undefined ? null : { lat: user.lat, lon: user.lon },
    initials: user.initials,
    memberSince: user.created_at,
    monthlyGoal: user.monthly_goal,
    weeklyGoal: user.weekly_goal,
    preferences: {
      notificationsEnabled: flag(user.notifications_enabled),
      remindersEnabled: flag(user.reminders_enabled),
      privacyProfile: flag(user.privacy_profile),
      privacyLocation: flag(user.privacy_location),
    },
  };
}

/** Cria um usuário diretamente (usado pelo cadastro e pela carga de demonstração). */
function createUser({
  name,
  email,
  password,
  neighborhood = null,
  cep = null,
  street = null,
  number = null,
  complement = null,
  city = null,
  state = null,
  createdAt = null,
}) {
  const normalizedEmail = String(email).toLowerCase();
  const place = neighborhood ?? '';
  const position = places.approximatePosition(place, normalizedEmail);
  const info = db
    .prepare(
      `INSERT INTO users
        (name, email, password_hash, neighborhood, cep, street, number, complement, city, state,
         lat, lon, initials, monthly_goal, weekly_goal, notifications_enabled, reminders_enabled,
         privacy_profile, privacy_location, token_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 17, 5, 1, 1, 1, 1, 0, ?)`,
    )
    .run(
      name,
      normalizedEmail,
      hashPassword(password),
      place,
      cep,
      street,
      number,
      complement,
      city ? city : places.DEFAULT_CITY,
      state ? state : places.DEFAULT_STATE,
      position?.lat ?? null,
      position?.lon ?? null,
      initialsFor(name),
      iso(createdAt ?? clock.now()),
    );
  return findUser(info.lastInsertRowid);
}

const ADDRESS_COLUMNS = ['cep', 'street', 'number', 'complement', 'city', 'state'];
const GOAL_COLUMNS = [
  ['monthlyGoal', 'monthly_goal'],
  ['weeklyGoal', 'weekly_goal'],
];

function has(data, key) {
  return Object.prototype.hasOwnProperty.call(data, key);
}

/** PATCH /users/me: nome, bairro, endereço e metas. */
function updateProfile(user, data) {
  const values = {};

  if (has(data, 'name')) {
    const name = validateName(clean(data.name));
    values.name = name;
    values.initials = initialsFor(name);
  }
  if (has(data, 'neighborhood')) {
    const neighborhood = validateNeighborhood(data.neighborhood);
    values.neighborhood = neighborhood;
    // A posição aproximada acompanha o bairro.
    const position = places.approximatePosition(neighborhood, String(user.email));
    values.lat = position?.lat ?? null;
    values.lon = position?.lon ?? null;
  }
  const address = addressFrom(data);
  for (const key of ADDRESS_COLUMNS) {
    if (has(data, key)) values[key] = address[key];
  }
  for (const [key, column] of GOAL_COLUMNS) {
    if (has(data, key)) values[column] = validateGoal(data[key]);
  }

  const columns = Object.keys(values);
  if (columns.length === 0) fail(400, 'Nenhum campo para atualizar.');

  db.transaction(() => {
    db.prepare(`UPDATE users SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
      ...columns.map((c) => values[c]),
      user.id,
    );
    if (values.name !== undefined) {
      // Mantém o nome atualizado nas publicações e comentários já feitos.
      for (const table of ['posts', 'post_comments']) {
        db.prepare(
          `UPDATE ${table} SET author_name = ?, author_initials = ? WHERE user_id = ?`,
        ).run(values.name, values.initials, user.id);
      }
    }
  })();

  return findUser(user.id);
}

const PREFERENCE_COLUMNS = {
  notificationsEnabled: 'notifications_enabled',
  remindersEnabled: 'reminders_enabled',
  privacyProfile: 'privacy_profile',
  privacyLocation: 'privacy_location',
};

function updatePreferences(user, data) {
  const values = {};
  for (const [key, column] of Object.entries(PREFERENCE_COLUMNS)) {
    if (has(data, key)) values[column] = data[key] === true ? 1 : 0;
  }
  const columns = Object.keys(values);
  if (columns.length === 0) fail(400, 'Nenhuma preferência informada.');
  db.prepare(`UPDATE users SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
    ...columns.map((c) => values[c]),
    user.id,
  );
  return findUser(user.id);
}

module.exports = {
  findUser,
  findUserByEmail,
  hashPassword,
  publicUser,
  createUser,
  updateProfile,
  updatePreferences,
};
