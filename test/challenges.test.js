const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  DAY_MS,
  api,
  registerUser,
  insertAction,
  insertChallenge,
  advanceClock,
  db,
  startServer,
  stopServer,
  resetDatabase,
} = require('./helpers');

const record = (token, actionId, quantity = 1) =>
  api(`/actions/${actionId}/records`, { method: 'POST', token, body: { quantity } });

describe('API — desafios', () => {
  before(startServer);
  after(stopServer);
  beforeEach(resetDatabase);

  it('desafios exigem autenticação', async () => {
    const { status } = await api('/challenges');
    assert.equal(status, 401);
  });

  it('lista desafios com o progresso do usuário', async () => {
    const { token } = await registerUser();
    const challenge = insertChallenge({ targetSteps: 3, pointsReward: 100 });

    const { status, body } = await api('/challenges', { token });
    assert.equal(status, 200);
    assert.equal(body.challenges.length, 1);
    const [item] = body.challenges;
    assert.equal(item.id, challenge.id);
    assert.equal(item.joined, false);
    assert.equal(item.completedSteps, 0);
    assert.equal(item.completed, false);
    assert.equal(item.expired, false);
    assert.equal(item.progress, 0);
    assert.equal(item.isWeekly, false);
    assert.equal(item.stepMode, 'actions');
    assert.equal(item.durationDays, 7);
    assert.equal(item.daysLeft, 7);
    assert.equal(item.endsAt, null);

    const detail = await api(`/challenges/${challenge.id}`, { token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.challenge.title, challenge.title);

    const missing = await api('/challenges/9999', { token });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, 'Desafio não encontrado.');
  });

  it('entrar no desafio conta a participação uma única vez', async () => {
    const { token } = await registerUser();
    const challenge = insertChallenge({ baseParticipants: 10 });

    const firstJoin = await api(`/challenges/${challenge.id}/join`, { method: 'POST', token });
    assert.equal(firstJoin.status, 200);
    assert.equal(firstJoin.body.challenge.joined, true);
    assert.equal(firstJoin.body.challenge.participants, 11);
    assert.equal(firstJoin.body.challenge.endsAt, '2026-11-18T03:00:00.000Z');

    const secondJoin = await api(`/challenges/${challenge.id}/join`, { method: 'POST', token });
    assert.equal(secondJoin.status, 200);
    assert.equal(secondJoin.body.challenge.participants, 11);

    const missing = await api('/challenges/9999/join', { method: 'POST', token });
    assert.equal(missing.status, 404);
  });

  it('avanço manual responde 410 e não muda nada', async () => {
    const { token } = await registerUser();
    const challenge = insertChallenge();
    await api(`/challenges/${challenge.id}/join`, { method: 'POST', token });

    const { status, body } = await api(`/challenges/${challenge.id}/progress`, {
      method: 'POST',
      token,
      body: { steps: 9999 },
    });
    assert.equal(status, 410);
    assert.match(body.error, /avança sozinho/);
    const row = db.prepare('SELECT completed_steps FROM challenge_progress').get();
    assert.equal(row.completed_steps, 0);
  });

  it('modo por ações: avança pela quantidade e credita o bônus ao concluir', async () => {
    const { token } = await registerUser();
    const action = insertAction({ categoryLabel: 'Água', points: 10, liters: 0 });
    const other = insertAction({ title: 'Outra', categoryLabel: 'Energia', points: 10, liters: 0 });
    const challenge = insertChallenge({ targetSteps: 3, stepMode: 'actions', pointsReward: 100 });

    // Sem ter entrado, registrar não avança.
    let response = await record(token, action.id);
    assert.deepEqual(response.body.challengeUpdates, []);

    await api(`/challenges/${challenge.id}/join`, { method: 'POST', token });

    // Ação de outra categoria não avança.
    response = await record(token, other.id);
    assert.deepEqual(response.body.challengeUpdates, []);

    response = await record(token, action.id, 2);
    assert.equal(response.body.challengeUpdates[0].completedSteps, 2);
    assert.equal(response.body.challengeUpdates[0].completed, false);

    response = await record(token, action.id, 5);
    const done = response.body.challengeUpdates[0];
    assert.equal(done.completedSteps, 3);
    assert.equal(done.completed, true);
    assert.equal(done.progress, 1);
    assert.ok(done.completedAt);

    const bonus = db
      .prepare("SELECT * FROM action_records WHERE kind = 'challenge'")
      .get();
    assert.equal(bonus.title, `Desafio concluído: ${challenge.title}`);
    assert.equal(bonus.points, 100);
    assert.equal(bonus.base_points, 100);

    const notifications = await api('/notifications', { token });
    assert.ok(notifications.body.notifications.some((item) => item.category === 'desafio'));

    // Concluído não avança mais.
    response = await record(token, action.id);
    assert.deepEqual(response.body.challengeUpdates, []);
  });

  it('modo por dias: uma etapa por dia; vencido não avança', async () => {
    const { token } = await registerUser();
    const action = insertAction({ categoryLabel: 'Água', points: 5, liters: 0 });
    const challenge = insertChallenge({ targetSteps: 5, stepMode: 'days', durationDays: 2 });
    await api(`/challenges/${challenge.id}/join`, { method: 'POST', token });

    let response = await record(token, action.id);
    assert.equal(response.body.challengeUpdates[0].completedSteps, 1);
    assert.equal(response.body.challengeUpdates[0].stepDoneToday, true);
    response = await record(token, action.id);
    assert.deepEqual(response.body.challengeUpdates, []);

    advanceClock(DAY_MS);
    response = await record(token, action.id);
    assert.equal(response.body.challengeUpdates[0].completedSteps, 2);

    advanceClock(DAY_MS);
    response = await record(token, action.id);
    assert.deepEqual(response.body.challengeUpdates, []);
    const detail = await api(`/challenges/${challenge.id}`, { token });
    assert.equal(detail.body.challenge.expired, true);
    assert.equal(detail.body.challenge.daysLeft, 0);
  });
});
