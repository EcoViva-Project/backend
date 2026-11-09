const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  api,
  registerUser,
  insertChallenge,
  db,
  startServer,
  stopServer,
  resetDatabase,
} = require('./helpers');

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
    assert.equal(body.challenges[0].id, challenge.id);
    assert.equal(body.challenges[0].joined, false);
    assert.equal(body.challenges[0].completedSteps, 0);
    assert.equal(body.challenges[0].completed, false);
    assert.equal(body.challenges[0].progress, 0);
    assert.equal(body.challenges[0].isWeekly, false);

    const detail = await api(`/challenges/${challenge.id}`, { token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.challenge.title, challenge.title);

    const missing = await api('/challenges/9999', { token });
    assert.equal(missing.status, 404);
  });

  it('entrar no desafio registra participação uma única vez', async () => {
    const { token } = await registerUser();
    const challenge = insertChallenge({ participants: 10 });

    const firstJoin = await api(`/challenges/${challenge.id}/join`, {
      method: 'POST',
      token,
    });
    assert.equal(firstJoin.status, 200);
    assert.equal(firstJoin.body.challenge.joined, true);
    assert.equal(firstJoin.body.challenge.participants, 11);

    const secondJoin = await api(`/challenges/${challenge.id}/join`, {
      method: 'POST',
      token,
    });
    assert.equal(secondJoin.status, 200);
    assert.equal(secondJoin.body.challenge.participants, 11);

    const missing = await api('/challenges/9999/join', { method: 'POST', token });
    assert.equal(missing.status, 404);
  });

  it('progresso exige participação prévia', async () => {
    const { token } = await registerUser();
    const challenge = insertChallenge();

    const { status, body } = await api(`/challenges/${challenge.id}/progress`, {
      method: 'POST',
      token,
      body: { steps: 1 },
    });
    assert.equal(status, 400);
    assert.match(body.error, /Entre no desafio/);

    const missing = await api('/challenges/9999/progress', {
      method: 'POST',
      token,
      body: { steps: 1 },
    });
    assert.equal(missing.status, 404);
  });

  it('avança etapas, limita à meta e credita recompensa ao concluir', async () => {
    const { token } = await registerUser();
    const challenge = insertChallenge({ targetSteps: 3, pointsReward: 100 });

    await api(`/challenges/${challenge.id}/join`, { method: 'POST', token });

    const partial = await api(`/challenges/${challenge.id}/progress`, {
      method: 'POST',
      token,
      body: { steps: 2 },
    });
    assert.equal(partial.status, 200);
    assert.equal(partial.body.challenge.completedSteps, 2);
    assert.equal(partial.body.challenge.completed, false);
    assert.equal(partial.body.challenge.progress, 2 / 3);
    assert.equal(partial.body.summary.points, 0);

    const finished = await api(`/challenges/${challenge.id}/progress`, {
      method: 'POST',
      token,
      body: { steps: 5 },
    });
    assert.equal(finished.status, 200);
    assert.equal(finished.body.challenge.completedSteps, 3);
    assert.equal(finished.body.challenge.completed, true);
    assert.equal(finished.body.challenge.progress, 1);
    assert.equal(finished.body.summary.points, 100);

    const reward = db
      .prepare('SELECT * FROM action_records WHERE title = ?')
      .get(`Desafio concluído: ${challenge.title}`);
    assert.ok(reward);
    assert.equal(reward.points, 100);
    assert.equal(reward.quantity, 1);

    const notifications = await api('/notifications', { token });
    assert.equal(
      notifications.body.notifications.some((item) => item.category === 'desafio'),
      true,
    );

    const again = await api(`/challenges/${challenge.id}/progress`, {
      method: 'POST',
      token,
      body: { steps: 1 },
    });
    assert.equal(again.status, 400);
    assert.match(again.body.error, /já concluído/);
  });
});
