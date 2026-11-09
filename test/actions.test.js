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

describe('API — catálogo de ações e registros', () => {
  before(startServer);
  after(stopServer);
  beforeEach(resetDatabase);

  it('catálogo exige autenticação', async () => {
    const { status } = await api('/actions');
    assert.equal(status, 401);
  });

  it('lista ações ordenadas por id por padrão', async () => {
    const { token } = await registerUser();
    const actions = seedActions();

    const { status, body } = await api('/actions', { token });
    assert.equal(status, 200);
    assert.deepEqual(
      body.actions.map((action) => action.id),
      actions.map((action) => action.id),
    );
    assert.deepEqual(body.actions[0].tags, ['torneira', 'agua']);
  });

  it('filtra por categoria e por busca textual', async () => {
    const { token } = await registerUser();
    seedActions();

    const byCategory = await api('/actions?category=agua', { token });
    assert.deepEqual(
      byCategory.body.actions.map((action) => action.title),
      ['Fechar a torneira'],
    );

    const byLabel = await api('/actions?category=Reciclagem', { token });
    assert.deepEqual(
      byLabel.body.actions.map((action) => action.title),
      ['Separar o lixo'],
    );

    const byTag = await api('/actions?search=bike', { token });
    assert.deepEqual(
      byTag.body.actions.map((action) => action.title),
      ['Andar de bicicleta'],
    );

    const byTitle = await api('/actions?search=torneira', { token });
    assert.deepEqual(
      byTitle.body.actions.map((action) => action.title),
      ['Fechar a torneira'],
    );

    const noMatch = await api('/actions?search=inexistente', { token });
    assert.equal(noMatch.body.actions.length, 0);
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
    assert.match(missing.body.error, /não encontrada/);
  });

  it('registra ação multiplicando pontos e litros pela quantidade', async () => {
    const { token } = await registerUser();
    const [action] = seedActions();

    const { status, body } = await api(`/actions/${action.id}/records`, {
      method: 'POST',
      token,
      body: { quantity: 2, notes: 'Registro de teste' },
    });

    assert.equal(status, 201);
    assert.equal(body.record.actionId, action.id);
    assert.equal(body.record.points, 20);
    assert.equal(body.record.liters, 24);
    assert.equal(body.record.quantity, 2);
    assert.equal(body.record.notes, 'Registro de teste');
    assert.equal(body.summary.actionsCount, 1);
    assert.equal(body.summary.points, 20);
    assert.equal(body.summary.litersSaved, 24);
    assert.equal(body.summary.level, 'Semente • Nível 1');
    assert.equal(
      body.newAchievements.some((achievement) => achievement.title === 'Primeiros Passos'),
      true,
    );

    const records = await api('/records', { token });
    assert.equal(records.body.records.length, 1);
    assert.equal(records.body.records[0].points, 20);

    const notifications = await api('/notifications', { token });
    assert.equal(
      notifications.body.notifications.some((item) => item.title === 'Ação registrada!'),
      true,
    );
    assert.equal(
      notifications.body.notifications.some((item) => item.category === 'conquista'),
      true,
    );
  });

  it('limita a quantidade entre 1 e 50 e trunca notas longas', async () => {
    const { token } = await registerUser();
    const [action] = seedActions();

    const minimum = await api(`/actions/${action.id}/records`, {
      method: 'POST',
      token,
      body: { quantity: 0, notes: 'x'.repeat(600) },
    });
    assert.equal(minimum.status, 201);
    assert.equal(minimum.body.record.quantity, 1);
    assert.equal(minimum.body.record.points, 10);
    assert.equal(minimum.body.record.notes.length, 500);

    const maximum = await api(`/actions/${action.id}/records`, {
      method: 'POST',
      token,
      body: { quantity: 999 },
    });
    assert.equal(maximum.status, 201);
    assert.equal(maximum.body.record.quantity, 50);
    assert.equal(maximum.body.record.points, 500);
    assert.equal(maximum.body.record.liters, 600);
  });

  it('registro de ação inexistente devolve 404', async () => {
    const { token } = await registerUser();
    const { status, body } = await api('/actions/9999/records', {
      method: 'POST',
      token,
      body: { quantity: 1 },
    });
    assert.equal(status, 404);
    assert.match(body.error, /não encontrada/);
  });

  it('histórico respeita o limite informado', async () => {
    const { token } = await registerUser();
    const [action] = seedActions();

    for (let index = 0; index < 3; index += 1) {
      await api(`/actions/${action.id}/records`, {
        method: 'POST',
        token,
        body: { quantity: 1, notes: `Registro ${index}` },
      });
    }

    const limited = await api('/records?limit=1', { token });
    assert.equal(limited.status, 200);
    assert.equal(limited.body.records.length, 1);

    const invalid = await api('/records?limit=abc', { token });
    assert.equal(invalid.body.records.length, 3);
  });
});
