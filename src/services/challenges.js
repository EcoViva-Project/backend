// Desafios coletivos: prazo pessoal, avanço automático e bônus.
//
// Espelha a seção "Desafios" de `eco-app/lib/core/local/local_api.dart`.
// Um desafio avança sozinho quando a pessoa registra uma ação da categoria dele:
// no modo `days`, uma etapa por dia; no modo `actions`, uma etapa por unidade.

const db = require('../db');
const clock = require('./clock');
const economy = require('./economy');
const { notify } = require('./notifications');
const { iso, int, flag, parseDate, minutesBetween } = require('./util');

function progressOf(userId, challengeId) {
  return (
    db
      .prepare('SELECT * FROM challenge_progress WHERE user_id = ? AND challenge_id = ?')
      .get(userId, challengeId) || null
  );
}

/** Fim do prazo pessoal: `duration_days` dias contando o dia em que entrou. */
function challengeEnd(challenge, progress) {
  const joinedAt = parseDate(progress?.joined_at);
  if (!joinedAt) return null;
  return new Date(
    economy.startOfLocalDay(joinedAt).getTime() +
      int(challenge.duration_days, 7) * economy.DAY_MS,
  );
}

function isExpired(challenge, progress, instant) {
  if (!progress || !flag(progress.joined) || flag(progress.completed)) return false;
  const end = challengeEnd(challenge, progress);
  return end !== null && instant.getTime() >= end.getTime();
}

function participantsOf(challenge) {
  const joined = db
    .prepare(
      'SELECT COUNT(*) AS total FROM challenge_progress WHERE challenge_id = ? AND joined = 1',
    )
    .get(challenge.id).total;
  return int(challenge.base_participants) + joined;
}

function challengeJson(row, user, instant = clock.now()) {
  const progress = progressOf(user.id, row.id);
  const joined = Boolean(progress) && flag(progress.joined);
  const completed = Boolean(progress) && flag(progress.completed);
  const expired = isExpired(row, progress, instant);
  const end = challengeEnd(row, progress);
  const target = Math.max(1, int(row.target_steps, 1));
  const steps = joined ? int(progress.completed_steps) : 0;
  const duration = int(row.duration_days, 7);
  const daysLeft =
    joined && !completed && end !== null
      ? Math.max(0, Math.ceil(minutesBetween(instant, end) / 1440))
      : duration;

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    icon: row.icon,
    targetSteps: target,
    stepMode: row.step_mode,
    pointsReward: row.points_reward,
    participants: participantsOf(row),
    durationDays: duration,
    daysLeft,
    isWeekly: flag(row.is_weekly),
    joined,
    completedSteps: steps,
    completed,
    expired,
    stepDoneToday:
      joined && row.step_mode === 'days' && progress.last_step_date === economy.dateKey(instant),
    endsAt: end === null ? null : iso(end),
    completedAt: progress?.completed_at ?? null,
    progress: Math.min(steps / target, 1.0),
  };
}

function findChallenge(id) {
  return db.prepare('SELECT * FROM challenges WHERE id = ?').get(id) || null;
}

function listChallenges(user) {
  const rows = db.prepare('SELECT * FROM challenges ORDER BY is_weekly DESC, id ASC').all();
  const now = clock.now();
  return rows.map((row) => challengeJson(row, user, now));
}

/** Entra no desafio (ou recomeça um desafio vencido). */
function joinChallenge(user, challenge, { at = null } = {}) {
  const when = at ?? clock.now();
  const existing = progressOf(user.id, challenge.id);
  if (!existing) {
    db.prepare(
      `INSERT INTO challenge_progress
        (user_id, challenge_id, completed_steps, joined, completed, joined_at, completed_at, last_step_date)
       VALUES (?, ?, 0, 1, 0, ?, NULL, NULL)`,
    ).run(user.id, challenge.id, iso(when));
    return progressOf(user.id, challenge.id);
  }
  if (isExpired(challenge, existing, when) || !flag(existing.joined)) {
    db.prepare(
      `UPDATE challenge_progress
          SET completed_steps = 0, joined = 1, joined_at = ?, last_step_date = NULL
        WHERE id = ?`,
    ).run(iso(when), existing.id);
  }
  return progressOf(user.id, challenge.id);
}

/** Avança os desafios em andamento da mesma categoria da ação registrada. */
function advanceChallenges(user, action, quantity, when, { silent = false } = {}) {
  const updated = [];
  const today = economy.dateKey(when);
  const challenges = db
    .prepare('SELECT * FROM challenges WHERE category = ? ORDER BY id')
    .all(action.category_label);

  for (const challenge of challenges) {
    const progress = progressOf(user.id, challenge.id);
    if (
      !progress ||
      !flag(progress.joined) ||
      flag(progress.completed) ||
      isExpired(challenge, progress, when)
    ) {
      continue;
    }

    const target = Math.max(1, int(challenge.target_steps, 1));
    let steps = int(progress.completed_steps);
    if (challenge.step_mode === 'actions') {
      steps = Math.min(steps + quantity, target);
    } else {
      if (progress.last_step_date === today) continue;
      steps = Math.min(steps + 1, target);
    }
    const completed = steps >= target;
    if (completed) {
      db.prepare(
        `UPDATE challenge_progress
            SET completed_steps = ?, last_step_date = ?, completed = 1, completed_at = ?
          WHERE id = ?`,
      ).run(steps, today, iso(when), progress.id);
    } else {
      db.prepare(
        'UPDATE challenge_progress SET completed_steps = ?, last_step_date = ? WHERE id = ?',
      ).run(steps, today, progress.id);
    }

    if (completed) {
      const reward = int(challenge.points_reward);
      db.prepare(
        `INSERT INTO action_records
          (user_id, action_id, kind, title, category_label, icon, points, base_points,
           liters, quantity, notes, created_at, local_date)
         VALUES (?, NULL, 'challenge', ?, ?, ?, ?, ?, 0, 1, 'Bônus de desafio coletivo', ?, ?)`,
      ).run(
        user.id,
        `Desafio concluído: ${challenge.title}`,
        challenge.category,
        challenge.icon,
        reward,
        reward,
        iso(when),
        today,
      );
      if (!silent) {
        notify(
          user.id,
          'desafio',
          'Desafio concluído!',
          `Você concluiu "${challenge.title}" e ganhou +${reward} pontos de bônus.`,
          { target: '/desafios', at: when },
        );
      }
    }
    updated.push(challengeJson(challenge, user, when));
  }
  return updated;
}

module.exports = {
  progressOf,
  challengeEnd,
  isExpired,
  challengeJson,
  findChallenge,
  listChallenges,
  joinChallenge,
  advanceChallenges,
};
