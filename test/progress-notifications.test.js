const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  api,
  registerUser,
  insertRecord,
  startServer,
  stopServer,
  resetDatabase,
} = require('./helpers');

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

describe('API — progresso, conquistas e notificações', () => {
  before(startServer);
  after(stopServer);
  beforeEach(resetDatabase);

  it('resumo soma pontos, litros, dias ativos e ações do mês', async () => {
    const { token, user } = await registerUser();

    insertRecord({ userId: user.id, points: 15, liters: 12, createdAt: daysAgo(0) });
    insertRecord({ userId: user.id, points: 20, liters: 8, createdAt: daysAgo(0) });
    insertRecord({ userId: user.id, points: 100, liters: 0, createdAt: daysAgo(40) });

    const { status, body } = await api('/progress', { token });

    assert.equal(status, 200);
    assert.deepEqual(body.summary, {
      points: 135,
      pointsEarned: 135,
      pointsSpent: 0,
      actionsCount: 3,
      activeDays: 2,
      monthlyActions: 2,
      monthlyGoal: 17,
      monthlyGoalProgress: Math.min(2 / 17, 1),
      litersSaved: 20,
      level: 'Semente • Nível 1',
    });
  });

  it('nível acompanha a faixa de pontos', async () => {
    const { token, user } = await registerUser();

    insertRecord({ userId: user.id, points: 500, liters: 0 });

    const { body } = await api('/progress', { token });
    assert.equal(body.summary.level, 'Broto • Nível 2');
  });

  it('conquistas são calculadas a partir dos registros', async () => {
    const { token, user } = await registerUser();

    insertRecord({ userId: user.id, points: 15, liters: 20, categoryLabel: 'Água' });

    const { status, body } = await api('/progress/achievements', { token });
    assert.equal(status, 200);
    assert.equal(body.achievements.length, 10);

    const byTitle = Object.fromEntries(
      body.achievements.map((achievement) => [achievement.title, achievement]),
    );

    assert.equal(byTitle['Primeiros Passos'].isUnlocked, true);
    assert.equal(byTitle['Primeiros Passos'].progress, 1);
    assert.equal(byTitle['Guardião da Água'].isUnlocked, true);
    assert.equal(byTitle['Consistência Verde'].isUnlocked, false);
    assert.equal(byTitle['Consistência Verde'].current, 1);
    assert.equal(byTitle['Consistência Verde'].progressLabel, '1 de 4');
  });

  it('notificações listam itens não lidos e permitem marcar uma como lida', async () => {
    const { token } = await registerUser();

    const list = await api('/notifications', { token });
    assert.equal(list.status, 200);
    assert.equal(list.body.notifications.length, 1);
    assert.equal(list.body.unreadCount, 1);
    assert.equal(list.body.notifications[0].title, 'Bem-vinda ao Eco!');

    const notificationId = list.body.notifications[0].id;
    const read = await api(`/notifications/${notificationId}/read`, {
      method: 'PATCH',
      token,
    });
    assert.equal(read.status, 200);
    assert.equal(read.body.ok, true);

    const afterRead = await api('/notifications', { token });
    assert.equal(afterRead.body.unreadCount, 0);
    assert.equal(afterRead.body.notifications[0].read, true);
  });

  it('não permite alterar notificação de outro usuário', async () => {
    const first = await registerUser({ email: 'primeira@test.app' });
    const second = await registerUser({ email: 'segunda@test.app' });

    const list = await api('/notifications', { token: first.token });
    const notificationId = list.body.notifications[0].id;

    const read = await api(`/notifications/${notificationId}/read`, {
      method: 'PATCH',
      token: second.token,
    });
    assert.equal(read.status, 404);

    const missing = await api('/notifications/9999/read', {
      method: 'PATCH',
      token: second.token,
    });
    assert.equal(missing.status, 404);
  });

  it('marca todas como lidas, remove uma e limpa a lista', async () => {
    const { token } = await registerUser();

    await api('/notifications/read-all', { method: 'POST', token });
    const readAll = await api('/notifications', { token });
    assert.equal(readAll.body.unreadCount, 0);
    assert.equal(readAll.body.notifications.every((item) => item.read), true);

    const notificationId = readAll.body.notifications[0].id;
    const removed = await api(`/notifications/${notificationId}`, {
      method: 'DELETE',
      token,
    });
    assert.equal(removed.status, 200);

    const afterRemove = await api('/notifications', { token });
    assert.equal(afterRemove.body.notifications.length, 0);

    const cleared = await api('/notifications', { method: 'DELETE', token });
    assert.equal(cleared.status, 200);

    const final = await api('/notifications', { token });
    assert.equal(final.body.notifications.length, 0);
  });
});
