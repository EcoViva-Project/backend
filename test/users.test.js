const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { api, registerUser, startServer, stopServer, resetDatabase } = require('./helpers');

describe('API — usuários e preferências', () => {
  before(startServer);
  after(stopServer);
  beforeEach(resetDatabase);

  it('rotas de usuário exigem autenticação', async () => {
    const me = await api('/users/me');
    assert.equal(me.status, 401);

    const patch = await api('/users/me', { method: 'PATCH', body: { name: 'Ana' } });
    assert.equal(patch.status, 401);

    const preferences = await api('/users/me/preferences', {
      method: 'PATCH',
      body: { notificationsEnabled: false },
    });
    assert.equal(preferences.status, 401);
  });

  it('GET /users/me devolve usuário, resumo zerado e conquistas', async () => {
    const { token, user } = await registerUser();
    const { status, body } = await api('/users/me', { token });

    assert.equal(status, 200);
    assert.equal(body.user.id, user.id);
    assert.deepEqual(body.summary, {
      points: 0,
      pointsEarned: 0,
      pointsSpent: 0,
      actionsCount: 0,
      activeDays: 0,
      monthlyActions: 0,
      monthlyGoal: 17,
      monthlyGoalProgress: 0,
      litersSaved: 0,
      level: 'Semente • Nível 1',
    });
    assert.equal(body.achievements.length, 10);
    assert.equal(body.achievements.every((item) => item.isUnlocked === false), true);
    assert.equal(body.achievements[0].title, 'Primeiros Passos');
  });

  it('PATCH /users/me atualiza nome, iniciais, bairro e metas', async () => {
    const { token } = await registerUser();
    const { status, body } = await api('/users/me', {
      method: 'PATCH',
      token,
      body: {
        name: '  Ana Paula Souza ',
        neighborhood: 'Vila Nova',
        monthlyGoal: 25,
        weeklyGoal: 0,
      },
    });

    assert.equal(status, 200);
    assert.equal(body.user.name, 'Ana Paula Souza');
    assert.equal(body.user.initials, 'AS');
    assert.equal(body.user.neighborhood, 'Vila Nova');
    assert.equal(body.user.monthlyGoal, 25);
    assert.equal(body.user.weeklyGoal, 1);
  });

  it('PATCH /users/me valida entradas', async () => {
    const { token } = await registerUser();

    const empty = await api('/users/me', { method: 'PATCH', token, body: {} });
    assert.equal(empty.status, 400);
    assert.match(empty.body.error, /Nenhum campo/);

    const shortName = await api('/users/me', {
      method: 'PATCH',
      token,
      body: { name: 'A' },
    });
    assert.equal(shortName.status, 400);
    assert.match(shortName.body.error, /nome válido/);
  });

  it('PATCH /users/me/preferences persiste apenas os campos enviados', async () => {
    const { token } = await registerUser();

    const updated = await api('/users/me/preferences', {
      method: 'PATCH',
      token,
      body: { notificationsEnabled: false, privacyLocation: true },
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.user.preferences, {
      notificationsEnabled: false,
      remindersEnabled: true,
      privacyProfile: true,
      privacyLocation: true,
    });

    const reloaded = await api('/users/me', { token });
    assert.deepEqual(reloaded.body.user.preferences, updated.body.user.preferences);
  });

  it('PATCH /users/me/preferences exige ao menos uma preferência', async () => {
    const { token } = await registerUser();
    const { status, body } = await api('/users/me/preferences', {
      method: 'PATCH',
      token,
      body: { outroCampo: true },
    });
    assert.equal(status, 400);
    assert.match(body.error, /Nenhuma preferência/);
  });
});
