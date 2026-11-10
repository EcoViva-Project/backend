const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  api,
  registerUser,
  insertAction,
  startServer,
  stopServer,
  resetDatabase,
} = require('./helpers');

function seedActions() {
  return [
    insertAction({
      title: 'Fechar a torneira',
      description: 'Economia de água ao escovar os dentes',
      category: 'agua',
      categoryLabel: 'Água',
      points: 10,
      liters: 12,
      tags: ['torneira', 'agua'],
    }),
    insertAction({
      title: 'Separar o lixo',
      description: 'Separação de resíduos recicláveis',
      category: 'reciclagem',
      categoryLabel: 'Reciclagem',
      icon: 'recycling',
      points: 30,
      liters: 0,
      dailyLimit: 1,
      tags: ['lixo', 'reciclagem'],
    }),
    insertAction({
      title: 'Andar de bicicleta',
      description: 'Mobilidade ativa no bairro',
      category: 'transporte',
      categoryLabel: 'Transporte',
      icon: 'directions_bike',
      points: 20,
      liters: 0,
      tags: ['bike', 'mobilidade'],
    }),
  ];
}

const post = (token, actionId, body) =>
  api(`/actions/${actionId}/records`, { method: 'POST', token, body });

describe('API — catálogo de ações e registros', () => {
  before(startServer);
  after(stopServer);
  beforeEach(resetDatabase);

  it('catálogo exige autenticação', async () => {
    const { status } = await api('/actions');
    assert.equal(status, 401);
  });

  it('lista ações ordenadas por id, com limites e uso', async () => {
    const { token } = await registerUser();
    const actions = seedActions();

    const { status, body } = await api('/actions', { token });
    assert.equal(status, 200);
    assert.deepEqual(
      body.actions.map((action) => action.id),
      actions.map((action) => action.id),
    );
    assert.deepEqual(body.actions[0].tags, ['torneira', 'agua']);
    assert.equal(body.actions[0].dailyLimit, null);
    assert.equal(body.actions[0].remaining, null);
    assert.equal(body.actions[1].dailyLimit, 1);
    assert.equal(body.actions[1].remaining, 1);
    assert.equal(body.actions[1].usedToday, 0);
    assert.equal(body.actions[1].neighborsToday, 0);
  });

  it('filtra por categoria e por busca textual', async () => {
    const { token } = await registerUser();
    seedActions();

    const titles = async (query) =>
      (await api(`/actions?${query}`, { token })).body.actions.map((action) => action.title);

    assert.deepEqual(await titles('category=agua'), ['Fechar a torneira']);
    assert.deepEqual(await titles('category=Reciclagem'), ['Separar o lixo']);
    assert.deepEqual(await titles('search=bike'), ['Andar de bicicleta']);
    assert.deepEqual(await titles('search=torneira'), ['Fechar a torneira']);
    assert.deepEqual(await titles('search=inexistente'), []);
  });

  it('ordena por pontos e alfabeticamente', async () => {
    const { token } = await registerUser();
    seedActions();

    const byPoints = await api('/actions?sort=points', { token });
    assert.deepEqual(
      byPoints.body.actions.map((action) => action.points),
      [30, 20, 10],
    );

    const alphabetical = await api('/actions?sort=alphabetical', { token });
    assert.deepEqual(
      alphabetical.body.actions.map((action) => action.title),
      ['Andar de bicicleta', 'Fechar a torneira', 'Separar o lixo'],
    );
  });

  it('consulta detalhe da ação e devolve 404 para id inexistente', async () => {
    const { token } = await registerUser();
    const [action] = seedActions();

    const found = await api(`/actions/${action.id}`, { token });
    assert.equal(found.status, 200);
    assert.equal(found.body.action.title, 'Fechar a torneira');
    assert.equal(found.body.action.categoryLabel, 'Água');

    const missing = await api('/actions/9999', { token });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, 'Ação não encontrada.');
  });

  it('registra ação multiplicando pontos e litros pela quantidade', async () => {
    const { token } = await registerUser();
    const [action] = seedActions();

    const { status, body } = await post(token, action.id, {
      quantity: 2,
      notes: 'Registro de teste',
    });

    assert.equal(status, 201);
    assert.equal(body.record.actionId, action.id);
    assert.equal(body.record.kind, 'action');
    assert.equal(body.record.points, 20);
    assert.equal(body.record.basePoints, 20);
    assert.equal(body.record.capped, false);
    assert.equal(body.record.liters, 24);
    assert.equal(body.record.quantity, 2);
    assert.equal(body.record.notes, 'Registro de teste');
    assert.equal(body.capReached, false);
    assert.deepEqual(body.challengeUpdates, []);
    assert.equal(body.summary.actionsCount, 1);
    assert.equal(body.summary.weeklyPoints, 20);
    // 20 da ação + 30 do selo "Primeiros Passos" (o bônus não entra no teto).
    assert.equal(body.summary.points, 50);
    assert.equal(body.summary.litersSaved, 24);
    assert.equal(body.summary.level, 'Semente • Nível 1');
    assert.equal(body.newAchievements.length, 1);
    assert.equal(body.newAchievements[0].key, 'primeiros-passos');
    assert.equal(body.achievements.length, 10);

    const records = await api('/records', { token });
    assert.deepEqual(
      records.body.records.map((record) => record.kind).sort(),
      ['achievement', 'action'],
    );

    const notifications = await api('/notifications', { token });
    const registered = notifications.body.notifications.find(
      (item) => item.title === 'Ação registrada!',
    );
    assert.equal(registered.message, 'Você registrou "Fechar a torneira" e ganhou +20 pontos.');
    assert.equal(registered.target, '/meu-historico');
    assert.ok(notifications.body.notifications.some((item) => item.category === 'conquista'));
  });

  it('quantidade inteira de 1 a 50 e notas truncadas em 500 caracteres', async () => {
    const { token } = await registerUser();
    const [action] = seedActions();

    for (const quantity of [0, -3, 51, 2.5, '3']) {
      const response = await post(token, action.id, { quantity });
      assert.equal(response.status, 400, `quantity=${quantity}`);
      assert.equal(
        response.body.error,
        'A quantidade deve ser um número inteiro a partir de 1.',
      );
    }

    const ok = await post(token, action.id, { notes: 'x'.repeat(600) });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.record.quantity, 1);
    assert.equal(ok.body.record.notes.length, 500);
  });

  it('respeita o limite diário da ação', async () => {
    const { token } = await registerUser();
    const [, recycling] = seedActions();

    assert.equal((await post(token, recycling.id, {})).status, 201);
    const second = await post(token, recycling.id, {});
    assert.equal(second.status, 409);
    assert.equal(
      second.body.error,
      'Você já registrou esta ação 1 vez hoje. Ela volta a valer amanhã.',
    );
  });

  it('registro de ação inexistente devolve 404', async () => {
    const { token } = await registerUser();
    const { status, body } = await post(token, 9999, { quantity: 1 });
    assert.equal(status, 404);
    assert.equal(body.error, 'Ação não encontrada.');
  });

  it('histórico respeita o limite informado', async () => {
    const { token } = await registerUser();
    const [action] = seedActions();

    for (let index = 0; index < 3; index += 1) {
      await post(token, action.id, { quantity: 1, notes: `Registro ${index}` });
    }

    const limited = await api('/records?limit=1', { token });
    assert.equal(limited.status, 200);
    assert.equal(limited.body.records.length, 1);

    // 3 ações + o bônus do selo "Primeiros Passos".
    const invalid = await api('/records?limit=abc', { token });
    assert.equal(invalid.body.records.length, 4);
  });
});
