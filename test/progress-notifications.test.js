const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  WEDNESDAY,
  DAY_MS,
  api,
  registerUser,
  insertRecord,
  startServer,
  stopServer,
  resetDatabase,
  db,
} = require('./helpers');

function daysAgo(days, hours = 0) {
  return new Date(WEDNESDAY.getTime() - days * DAY_MS - hours * 3600000).toISOString();
}

describe('API — progresso, conquistas e notificações', () => {
  before(startServer);
  after(stopServer);
  beforeEach(resetDatabase);

  it('resumo soma pontos, litros, dias, mês, teto e sequência', async () => {
    const { token, user } = await registerUser();

    insertRecord({ userId: user.id, points: 15, liters: 12, createdAt: daysAgo(0) });
    insertRecord({ userId: user.id, points: 20, liters: 8, createdAt: daysAgo(1) });
    insertRecord({ userId: user.id, points: 100, liters: 0, createdAt: daysAgo(40) });
    // Bônus não conta como ação, nem dia ativo, nem teto.
    insertRecord({ userId: user.id, kind: 'challenge', points: 60, liters: 0, createdAt: daysAgo(0) });

    // O resumo é lido antes de sincronizar as conquistas (como no app).
    const { status, body } = await api('/progress', { token });

    assert.equal(status, 200);
    assert.deepEqual(body.summary, {
      points: 195,
      pointsEarned: 195,
      pointsSpent: 0,
      actionsCount: 3,
      activeDays: 3,
      monthlyActions: 2,
      monthlyGoal: 17,
      monthlyGoalProgress: 2 / 17,
      litersSaved: 20,
      level: 'Semente • Nível 1',
      levelNumber: 1,
      levelName: 'Semente',
      levelFloor: 0,
      nextLevelAt: 300,
      weeklyPoints: 35,
      weeklyCap: 400,
      weeklyRemaining: 365,
      weekResetsAt: '2026-11-16T03:00:00.000Z',
      streakDays: 2,
      bestStreak: 2,
    });
  });

  it('dia e mês são os de Brasília, não os de UTC', async () => {
    const { token, user } = await registerUser();
    // 31/10 às 22h em Brasília = 01/11 01:00 UTC: conta em outubro.
    insertRecord({ userId: user.id, createdAt: '2026-11-01T01:00:00.000Z' });
    const { body } = await api('/progress', { token });
    assert.equal(body.summary.monthlyActions, 0);
    const row = db
      .prepare("SELECT local_date FROM action_records WHERE user_id = ? AND kind = 'action'")
      .get(user.id);
    assert.equal(row.local_date, '2026-10-31');
  });

  it('nível acompanha os pontos ganhos e não cai ao gastar', async () => {
    const { token, user } = await registerUser();
    insertRecord({ userId: user.id, points: 300, liters: 0, createdAt: daysAgo(10) });
    const { body } = await api('/progress', { token });
    assert.equal(body.summary.level, 'Broto • Nível 2');
    assert.equal(body.summary.nextLevelAt, 1000);
  });

  it('conquistas: critérios, crédito do bônus, data e notificação', async () => {
    const { token, user } = await registerUser();
    insertRecord({ userId: user.id, points: 15, liters: 20, categoryLabel: 'Água' });

    const { status, body } = await api('/progress/achievements', { token });
    assert.equal(status, 200);
    assert.equal(body.achievements.length, 10);
    const byKey = Object.fromEntries(body.achievements.map((a) => [a.key, a]));

    assert.equal(byKey['primeiros-passos'].isUnlocked, true);
    assert.equal(byKey['primeiros-passos'].progress, 1);
    assert.equal(byKey['primeiros-passos'].unlockedOn, '11 de novembro');
    assert.equal(byKey['guardiao-da-agua'].isUnlocked, false);
    assert.equal(byKey['guardiao-da-agua'].progressLabel, '20 de 100 litros');
    assert.equal(byKey['consistencia-verde'].current, 1);
    assert.equal(byKey['consistencia-verde'].progressLabel, '1 de 4 dias seguidos');
    assert.equal(
      byKey['consciencia-plena'].missing,
      'Ainda não experimentou: Reciclagem, Alimentação, Transporte, Energia, Espaços Públicos.',
    );

    // O bônus de 30 pontos foi creditado uma única vez, como registro próprio.
    const again = await api('/progress', { token });
    assert.equal(again.body.summary.pointsEarned, 45);
    assert.equal(again.body.summary.actionsCount, 1);
    const bonus = db
      .prepare("SELECT * FROM action_records WHERE user_id = ? AND kind = 'achievement'")
      .all(user.id);
    assert.equal(bonus.length, 1);
    assert.equal(bonus[0].points, 30);

    const { body: list } = await api('/notifications', { token });
    const unlocked = list.notifications.find((n) => n.category === 'conquista');
    assert.match(unlocked.message, /Primeiros Passos/);
    assert.equal(unlocked.target, '/conquistas');
  });

  it('conquista e bônus são gravados juntos (transação)', async () => {
    const { token, user } = await registerUser();
    insertRecord({ userId: user.id, points: 15, createdAt: daysAgo(0) });

    db.exec(`CREATE TEMP TRIGGER falha_bonus BEFORE INSERT ON action_records
             WHEN NEW.kind = 'achievement'
             BEGIN SELECT RAISE(ABORT, 'falha simulada'); END`);
    const quiet = console.error;
    console.error = () => {};
    try {
      const failed = await api('/progress/achievements', { token });
      assert.equal(failed.status, 500);
    } finally {
      console.error = quiet;
      db.exec('DROP TRIGGER IF EXISTS temp.falha_bonus');
    }
    // O bônus falhou: o selo também não ficou gravado (nem a notificação).
    const count = (table) =>
      db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE user_id = ?`).get(user.id).total;
    assert.equal(count('user_achievements'), 0);
    assert.equal(
      db
        .prepare("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND category = 'conquista'")
        .get(user.id).total,
      0,
    );

    // Sem a falha, o selo e o bônus entram juntos.
    const ok = await api('/progress/achievements', { token });
    assert.equal(ok.status, 200);
    assert.equal(count('user_achievements'), 1);
    assert.equal(
      db
        .prepare("SELECT COUNT(*) AS total FROM action_records WHERE user_id = ? AND kind = 'achievement'")
        .get(user.id).total,
      1,
    );
  });

  it('concluir desafio não conta como ação para as conquistas', async () => {
    const { token, user } = await registerUser();
    insertRecord({ userId: user.id, kind: 'challenge', points: 100, liters: 0 });
    const { body } = await api('/progress/achievements', { token });
    const first = body.achievements.find((a) => a.key === 'primeiros-passos');
    assert.equal(first.isUnlocked, false);
  });

  it('notificações listam itens não lidos e permitem marcar como lida e não lida', async () => {
    const { token } = await registerUser();

    const list = await api('/notifications', { token });
    assert.equal(list.status, 200);
    assert.equal(list.body.notifications.length, 1);
    assert.equal(list.body.unreadCount, 1);
    assert.equal(list.body.notifications[0].title, 'Boas-vindas ao EcoViva!');
    assert.equal(list.body.notifications[0].target, '/acoes');

    const notificationId = list.body.notifications[0].id;
    const read = await api(`/notifications/${notificationId}/read`, { method: 'PATCH', token });
    assert.equal(read.status, 200);
    assert.equal(read.body.ok, true);

    const afterRead = await api('/notifications', { token });
    assert.equal(afterRead.body.unreadCount, 0);
    assert.equal(afterRead.body.notifications[0].read, true);

    await api(`/notifications/${notificationId}/read`, {
      method: 'PATCH',
      token,
      body: { read: false },
    });
    const unread = await api('/notifications', { token });
    assert.equal(unread.body.unreadCount, 1);
  });

  it('unreadCount conta todas as não lidas, além das 100 listadas', async () => {
    const { token, user } = await registerUser();
    const insert = db.prepare(
      `INSERT INTO notifications (user_id, category, title, message, read, created_at)
       VALUES (?, 'sistema', 'Aviso', 'Texto', 0, ?)`,
    );
    for (let i = 0; i < 120; i += 1) insert.run(user.id, daysAgo(1, i));
    const { body } = await api('/notifications', { token });
    assert.equal(body.notifications.length, 100);
    assert.equal(body.unreadCount, 121);
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
    const removed = await api(`/notifications/${notificationId}`, { method: 'DELETE', token });
    assert.equal(removed.status, 200);

    const afterRemove = await api('/notifications', { token });
    assert.equal(afterRemove.body.notifications.length, 0);

    const cleared = await api('/notifications', { method: 'DELETE', token });
    assert.equal(cleared.status, 200);

    const final = await api('/notifications', { token });
    assert.equal(final.body.notifications.length, 0);
  });
});
