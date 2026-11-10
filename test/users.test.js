const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  api,
  registerUser,
  startServer,
  stopServer,
  resetDatabase,
  db,
} = require('./helpers');
const places = require('../src/services/places');

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
    assert.equal(body.user.city, 'São José do Rio Preto');
    assert.equal(body.user.address.state, 'SP');
    assert.equal(body.user.preferences.privacyLocation, true);
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
      levelNumber: 1,
      levelName: 'Semente',
      levelFloor: 0,
      nextLevelAt: 300,
      weeklyPoints: 0,
      weeklyCap: 400,
      weeklyRemaining: 400,
      weekResetsAt: '2026-11-16T03:00:00.000Z',
      streakDays: 0,
      bestStreak: 0,
    });
    assert.equal(body.achievements.length, 10);
    assert.equal(body.achievements.every((item) => item.isUnlocked === false), true);
    assert.equal(body.achievements[0].title, 'Primeiros Passos');
  });

  it('PATCH /users/me atualiza nome, iniciais, bairro, posição, endereço e metas', async () => {
    const { token, user } = await registerUser();
    const { status, body } = await api('/users/me', {
      method: 'PATCH',
      token,
      body: {
        name: '  Ana Paula Souza ',
        neighborhood: 'Vila Redentora',
        cep: '15015-110',
        street: 'Rua Bernardino de Campos',
        monthlyGoal: 25,
        weeklyGoal: 1,
      },
    });

    assert.equal(status, 200);
    assert.equal(body.user.name, 'Ana Paula Souza');
    assert.equal(body.user.initials, 'AS');
    assert.equal(body.user.neighborhood, 'Vila Redentora');
    assert.equal(body.user.address.cep, '15015-110');
    assert.equal(body.user.monthlyGoal, 25);
    assert.equal(body.user.weeklyGoal, 1);
    // A posição aproximada acompanha o bairro (mesmo cálculo do app).
    assert.deepEqual(
      body.user.location,
      places.approximatePosition('Vila Redentora', user.email),
    );
  });

  it('PATCH /users/me valida entradas', async () => {
    const { token } = await registerUser();
    const patch = (body) => api('/users/me', { method: 'PATCH', token, body });

    const empty = await patch({});
    assert.equal(empty.status, 400);
    assert.match(empty.body.error, /Nenhum campo/);

    for (const name of ['A', '   ', 'x'.repeat(81), { nome: 'objeto' }]) {
      const response = await patch({ name });
      assert.equal(response.status, 400);
      assert.equal(response.body.error, 'Informe um nome com 2 a 80 caracteres.');
    }
    for (const neighborhood of ['', 'x'.repeat(81)]) {
      const response = await patch({ neighborhood });
      assert.equal(response.status, 400);
      assert.equal(response.body.error, 'Informe um bairro com até 80 caracteres.');
    }
    for (const goal of [0, 101, 2.5, 'Infinity', '10', null]) {
      const response = await patch({ monthlyGoal: goal });
      assert.equal(response.status, 400, `monthlyGoal=${goal}`);
      assert.equal(response.body.error, 'As metas devem ser números inteiros entre 1 e 100.');
    }
    const cep = await patch({ cep: '1234' });
    assert.equal(cep.status, 400);
    assert.equal(cep.body.error, 'Informe um CEP com 8 dígitos.');
  });

  it('trocar o nome atualiza publicações e comentários já feitos', async () => {
    const { token } = await registerUser();
    const post = await api('/community/posts', {
      method: 'POST',
      token,
      body: { content: 'Minha publicação' },
    });
    await api(`/community/posts/${post.body.post.id}/comments`, {
      method: 'POST',
      token,
      body: { content: 'Meu comentário' },
    });

    await api('/users/me', { method: 'PATCH', token, body: { name: 'Ana Paula Souza' } });
    const feed = await api('/community/posts', { token });
    assert.equal(feed.body.posts[0].authorName, 'Ana Paula Souza');
    assert.equal(feed.body.posts[0].comments[0].authorName, 'Ana Paula Souza');
    assert.equal(
      db.prepare('SELECT author_initials FROM posts').get().author_initials,
      'AS',
    );
  });

  it('PATCH /users/me/preferences persiste apenas os campos enviados', async () => {
    const { token } = await registerUser();

    const updated = await api('/users/me/preferences', {
      method: 'PATCH',
      token,
      body: { notificationsEnabled: false, privacyLocation: false },
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.user.preferences, {
      notificationsEnabled: false,
      remindersEnabled: true,
      privacyProfile: true,
      privacyLocation: false,
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
