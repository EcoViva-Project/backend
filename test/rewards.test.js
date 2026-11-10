const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  DAY_MS,
  advanceClock,
  api,
  registerUser,
  insertPartner,
  insertReward,
  insertRecord,
  insertAction,
  insertChallenge,
  startServer,
  stopServer,
  resetDatabase,
  db,
} = require('./helpers');
const { resetRateLimits } = require('../src/middleware/rateLimit');

function setupReward(overrides = {}) {
  const partner = insertPartner({
    name: overrides.partnerName || 'Parceiro de teste',
  });
  const reward = insertReward({
    partnerId: partner.id,
    ...overrides,
  });
  return { partner, reward };
}

describe('API — recompensas', () => {
  before(startServer);
  after(stopServer);
  beforeEach(resetDatabase);

  it('recompensas exigem autenticação', async () => {
    const { status } = await api('/rewards');
    assert.equal(status, 401);

    const detail = await api('/rewards/1');
    assert.equal(detail.status, 401);
  });

  it('lista recompensas ativas com filtro, busca e ordenação', async () => {
    const { token } = await registerUser();
    const mercado = insertPartner({ name: 'Mercado Verde' });
    const cafe = insertPartner({ name: 'Café Raízes' });

    insertReward({
      partnerId: mercado.id,
      title: 'Cesta orgânica',
      category: 'produto',
      categoryLabel: 'Produto',
      pointsCost: 900,
      stock: 5,
      isFeatured: 1,
    });
    insertReward({
      partnerId: cafe.id,
      title: 'Café especial',
      category: 'desconto',
      categoryLabel: 'Desconto',
      pointsCost: 150,
      stock: 20,
    });
    insertReward({
      partnerId: cafe.id,
      title: 'Combo da tarde',
      category: 'desconto',
      categoryLabel: 'Desconto',
      pointsCost: 90,
      stock: 0,
    });

    const all = await api('/rewards', { token });
    assert.equal(all.status, 200);
    assert.equal(all.body.rewards.length, 3);
    // destaque primeiro, depois menor custo
    assert.equal(all.body.rewards[0].title, 'Cesta orgânica');
    assert.equal(all.body.rewards[1].title, 'Combo da tarde');
    assert.equal(all.body.rewards[2].title, 'Café especial');
    assert.equal(all.body.rewards[1].available, false);
    assert.equal(all.body.rewards[0].partnerName, 'Mercado Verde');

    const filtered = await api('/rewards?category=desconto', { token });
    assert.equal(filtered.body.rewards.length, 2);
    assert.equal(
      filtered.body.rewards.every((item) => item.category === 'desconto'),
      true,
    );

    const byLabel = await api('/rewards?category=Produto', { token });
    assert.equal(byLabel.body.rewards.length, 1);
    assert.equal(byLabel.body.rewards[0].title, 'Cesta orgânica');

    const searched = await api('/rewards?search=especial', { token });
    assert.equal(searched.status, 200);
    assert.equal(searched.body.rewards.length, 1);
    assert.equal(searched.body.rewards[0].title, 'Café especial');

    const accentInsensitive = await api('/rewards?search=cafe', { token });
    assert.equal(accentInsensitive.body.rewards.length, 2);

    const byPartner = await api('/rewards?search=raizes', { token });
    assert.equal(byPartner.body.rewards.length, 2);

    const cheapest = await api('/rewards?sort=points', { token });
    assert.deepEqual(
      cheapest.body.rewards.map((item) => item.pointsCost),
      [90, 150, 900],
    );

    const expensive = await api('/rewards?sort=points_desc', { token });
    assert.deepEqual(
      expensive.body.rewards.map((item) => item.pointsCost),
      [900, 150, 90],
    );

    const alphabetical = await api('/rewards?sort=alphabetical', { token });
    assert.deepEqual(
      alphabetical.body.rewards.map((item) => item.title),
      ['Café especial', 'Cesta orgânica', 'Combo da tarde'],
    );
  });

  it('detalha recompensa e devolve 404 quando não existe ou está inativa', async () => {
    const { token } = await registerUser();
    const { reward } = setupReward({ title: 'Sacola reutilizável' });

    const detail = await api(`/rewards/${reward.id}`, { token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.reward.title, 'Sacola reutilizável');
    assert.equal(detail.body.reward.pointsCost, reward.points_cost);

    const missing = await api('/rewards/9999', { token });
    assert.equal(missing.status, 404);
    assert.match(missing.body.error, /não encontrada/i);

    const inactive = insertReward({
      partnerId: reward.partner_id,
      title: 'Inativa',
      active: 0,
    });
    const inactiveDetail = await api(`/rewards/${inactive.id}`, { token });
    assert.equal(inactiveDetail.status, 404);
  });

  it('recusa resgate sem pontos suficientes', async () => {
    const { token, user } = await registerUser();
    const { reward } = setupReward({ pointsCost: 500 });

    insertRecord({ userId: user.id, points: 100 });

    const { status, body } = await api(`/rewards/${reward.id}/redeem`, {
      method: 'POST',
      token,
    });
    assert.equal(status, 409);
    assert.match(body.error, /Pontos insuficientes/);
    assert.match(body.error, /100/);
  });

  it('recusa resgate de recompensa esgotada', async () => {
    const { token } = await registerUser();
    const { reward } = setupReward({ pointsCost: 0, stock: 0 });

    const { status, body } = await api(`/rewards/${reward.id}/redeem`, {
      method: 'POST',
      token,
    });
    assert.equal(status, 409);
    assert.match(body.error, /esgotada/i);
  });

  it('resgata recompensa, debita pontos, reduz estoque e registra histórico', async () => {
    const { token, user } = await registerUser();
    const { reward } = setupReward({
      title: 'Café especial',
      pointsCost: 150,
      stock: 3,
    });

    insertRecord({ userId: user.id, points: 400 });

    const { status, body } = await api(`/rewards/${reward.id}/redeem`, {
      method: 'POST',
      token,
    });

    assert.equal(status, 201);
    assert.equal(body.redemption.rewardTitle, 'Café especial');
    assert.equal(body.redemption.pointsSpent, 150);
    assert.match(body.redemption.code, /^ECO-[A-F0-9]{8}$/);
    assert.equal(body.reward.stock, 2);
    assert.equal(body.reward.available, true);
    assert.equal(body.summary.points, 250);
    assert.equal(body.summary.pointsEarned, 400);
    assert.equal(body.summary.pointsSpent, 150);

    const history = await api('/rewards/redemptions', { token });
    assert.equal(history.status, 200);
    assert.equal(history.body.redemptions.length, 1);
    assert.equal(history.body.redemptions[0].code, body.redemption.code);
    assert.equal(history.body.summary.points, 250);

    const notifications = await api('/notifications', { token });
    const redeemNotification = notifications.body.notifications.find((item) =>
      item.title.includes('Resgate confirmado'),
    );
    assert.ok(redeemNotification);
    assert.equal(redeemNotification.category, 'recompensa');
    assert.equal(redeemNotification.target, '/recompensas');
    assert.match(redeemNotification.message, new RegExp(body.redemption.code));

    const detail = await api(`/rewards/${reward.id}`, { token });
    assert.equal(detail.body.reward.stock, 2);
  });

  it('cupom traz valor, validade, limite por pessoa e endereço do parceiro', async () => {
    const { token, user } = await registerUser();
    const { reward } = setupReward({
      pointsCost: 100,
      valueCents: 200,
      validityDays: 10,
      perUserLimit: 2,
    });
    insertRecord({ userId: user.id, points: 1000 });

    const before = await api(`/rewards/${reward.id}`, { token });
    assert.equal(before.body.reward.valueCents, 200);
    assert.equal(before.body.reward.validityDays, 10);
    assert.equal(before.body.reward.perUserLimit, 2);
    assert.equal(before.body.reward.redeemedByMe, 0);
    assert.equal(before.body.reward.limitReached, false);
    assert.equal(before.body.reward.partnerAddress, 'Rua de Teste, 10');

    const first = await api(`/rewards/${reward.id}/redeem`, { method: 'POST', token });
    assert.equal(first.status, 201);
    assert.equal(first.body.redemption.status, 'active');
    assert.equal(first.body.redemption.valueCents, 200);
    assert.equal(first.body.redemption.usedAt, null);
    assert.equal(
      new Date(first.body.redemption.expiresAt) - new Date(first.body.redemption.dateTime),
      10 * DAY_MS,
    );
    const second = await api(`/rewards/${reward.id}/redeem`, { method: 'POST', token });
    assert.equal(second.body.reward.redeemedByMe, 2);
    assert.equal(second.body.reward.limitReached, true);

    const third = await api(`/rewards/${reward.id}/redeem`, { method: 'POST', token });
    assert.equal(third.status, 409);
    assert.equal(third.body.error, 'Você já resgatou esta recompensa 2 vezes nos últimos 30 dias.');

    // Passados 30 dias, o limite volta (e os cupons antigos venceram).
    advanceClock(31 * DAY_MS);
    const later = await api(`/rewards/${reward.id}/redeem`, { method: 'POST', token });
    assert.equal(later.status, 201);
    const history = await api('/rewards/redemptions', { token });
    assert.deepEqual(
      history.body.redemptions.map((item) => item.status),
      ['active', 'expired', 'expired'],
    );
  });

  it('conferência do cupom pelo parceiro', async () => {
    const owner = await registerUser({ email: 'dona@test.app' });
    const other = await registerUser({ email: 'outra@test.app' });
    const { reward } = setupReward({ pointsCost: 100 });
    insertRecord({ userId: owner.user.id, points: 500 });
    const { body } = await api(`/rewards/${reward.id}/redeem`, {
      method: 'POST',
      token: owner.token,
    });
    const path = `/rewards/redemptions/${body.redemption.id}/use`;

    const notMine = await api(path, { method: 'POST', token: other.token, body: { pin: '4321' } });
    assert.equal(notMine.status, 404);
    assert.equal(notMine.body.error, 'Cupom não encontrado.');

    for (const pin of [undefined, '', '0000', 4321]) {
      const wrong = await api(path, { method: 'POST', token: owner.token, body: { pin } });
      assert.equal(wrong.status, 403, `pin=${pin}`);
    }

    const used = await api(path, { method: 'POST', token: owner.token, body: { pin: '4321' } });
    assert.equal(used.status, 200);
    assert.equal(used.body.redemption.status, 'used');
    assert.ok(used.body.redemption.usedAt);

    const again = await api(path, { method: 'POST', token: owner.token, body: { pin: '4321' } });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'Este cupom já foi utilizado.');
  });

  async function redeemedCoupon(email = 'dona@test.app') {
    const owner = await registerUser({ email });
    const { reward } = setupReward({ pointsCost: 100 });
    insertRecord({ userId: owner.user.id, points: 500 });
    const { body } = await api(`/rewards/${reward.id}/redeem`, {
      method: 'POST',
      token: owner.token,
    });
    return { owner, redemption: body.redemption };
  }

  it('código do parceiro: 5 tentativas erradas por cupom, depois 429', async () => {
    const { owner, redemption } = await redeemedCoupon();
    const path = `/rewards/redemptions/${redemption.id}/use`;
    const use = (pin) => api(path, { method: 'POST', token: owner.token, body: { pin } });

    for (let i = 0; i < 5; i += 1) {
      assert.equal((await use(`000${i}`)).status, 403);
    }
    // Esgotadas as tentativas, nem o código certo passa até a janela acabar.
    const blocked = await use('4321');
    assert.equal(blocked.status, 429);
    assert.equal(
      blocked.body.error,
      'Muitas tentativas erradas do código do parceiro. Aguarde alguns minutos e tente novamente.',
    );
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.equal(
      db.prepare('SELECT used_at FROM redemptions WHERE id = ?').get(redemption.id).used_at,
      null,
    );

    // Zerado o limitador (fim da janela), o código certo funciona.
    resetRateLimits();
    assert.equal((await use('4321')).status, 200);
  });

  it('código do parceiro: o limite é por cupom e o código certo não gasta tentativa', async () => {
    const { owner, redemption } = await redeemedCoupon();
    const second = await api(`/rewards/${redemption.rewardId}/redeem`, {
      method: 'POST',
      token: owner.token,
    });
    const use = (id, pin) =>
      api(`/rewards/redemptions/${id}/use`, { method: 'POST', token: owner.token, body: { pin } });

    for (let i = 0; i < 4; i += 1) assert.equal((await use(redemption.id, '0000')).status, 403);
    // Dentro da franquia, o código certo funciona na primeira tentativa.
    assert.equal((await use(redemption.id, '4321')).status, 200);

    // O outro cupom tem as próprias 5 tentativas.
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await use(second.body.redemption.id, '0000')).status, 403);
    }
    assert.equal((await use(second.body.redemption.id, '4321')).status, 429);
  });

  it('código do parceiro: escrever o id de outro jeito (03, 3.0, +3) não dá tentativas novas', async () => {
    const { owner, redemption } = await redeemedCoupon();
    const id = redemption.id;
    const use = (path, pin) =>
      api(`/rewards/redemptions/${path}/use`, { method: 'POST', token: owner.token, body: { pin } });

    for (let i = 0; i < 5; i += 1) assert.equal((await use(id, '0000')).status, 403);
    assert.equal((await use(id, '0000')).status, 429);

    // Outras grafias do mesmo número: a mesma resposta de um cupom inexistente,
    // sem conferir o código (nem o certo) e sem contador próprio.
    for (const other of [`0${id}`, `00${id}`, `${id}.0`, `+${id}`, `${id}e0`, ` ${id}`]) {
      const response = await use(encodeURIComponent(other), '4321');
      assert.equal(response.status, 404, other);
      assert.equal(response.body.error, 'Cupom não encontrado.', other);
    }
    assert.equal(
      db.prepare('SELECT used_at FROM redemptions WHERE id = ?').get(id).used_at,
      null,
    );
  });

  it('ids fora da forma canônica respondem como id inexistente em todas as rotas', async () => {
    const { token, user } = await registerUser();
    const { reward } = setupReward({ pointsCost: 100 });
    const notification = db
      .prepare('SELECT id FROM notifications WHERE user_id = ? ORDER BY id LIMIT 1')
      .get(user.id);
    const post = await api('/community/posts', {
      method: 'POST',
      token,
      body: { content: 'Publicação de teste' },
    });
    const actionId = insertAction().id;
    const challengeId = insertChallenge().id;

    const weird = (id) => [`0${id}`, `${id}.0`, `+${id}`, '0', '-1', '99999999999999999999'];
    const cases = [
      ['GET', (id) => `/rewards/${id}`, reward.id, 'Recompensa não encontrada.'],
      ['POST', (id) => `/rewards/${id}/redeem`, reward.id, 'Recompensa não encontrada.'],
      ['GET', (id) => `/community/posts/${id}/comments`, post.body.post.id, 'Publicação não encontrada.'],
      ['POST', (id) => `/community/posts/${id}/like`, post.body.post.id, 'Publicação não encontrada.'],
      ['DELETE', (id) => `/community/posts/${id}`, post.body.post.id, 'Publicação não encontrada.'],
      ['PATCH', (id) => `/notifications/${id}/read`, notification.id, 'Notificação não encontrada.'],
      ['GET', (id) => `/actions/${id}`, actionId, 'Ação não encontrada.'],
      ['POST', (id) => `/actions/${id}/records`, actionId, 'Ação não encontrada.'],
      ['GET', (id) => `/challenges/${id}`, challengeId, 'Desafio não encontrado.'],
      ['POST', (id) => `/challenges/${id}/join`, challengeId, 'Desafio não encontrado.'],
    ];
    for (const [method, url, id, message] of cases) {
      for (const form of weird(id)) {
        const body = method === 'GET' ? undefined : {};
        const response = await api(url(encodeURIComponent(form)), { method, token, body });
        assert.equal(response.status, 404, `${method} ${url(form)}`);
        assert.equal(response.body.error, message, `${method} ${url(form)}`);
      }
    }

    // DELETE de notificação responde 200 para id inexistente; com outra grafia
    // também, mas sem apagar a notificação de verdade.
    const deleted = await api(`/notifications/0${notification.id}`, { method: 'DELETE', token });
    assert.equal(deleted.status, 200);
    assert.ok(db.prepare('SELECT id FROM notifications WHERE id = ?').get(notification.id));

    // A forma canônica continua funcionando.
    assert.equal((await api(`/rewards/${reward.id}`, { token })).status, 200);
    assert.equal((await api(`/community/posts/${post.body.post.id}/comments`, { token })).status, 200);
  });

  it('cupom usado e notificação são gravados juntos (transação)', async () => {
    const { owner, redemption } = await redeemedCoupon();
    db.exec(`CREATE TEMP TRIGGER falha_notificacao BEFORE INSERT ON notifications
             BEGIN SELECT RAISE(ABORT, 'falha simulada'); END`);
    const quiet = console.error;
    console.error = () => {};
    try {
      const response = await api(`/rewards/redemptions/${redemption.id}/use`, {
        method: 'POST',
        token: owner.token,
        body: { pin: '4321' },
      });
      assert.equal(response.status, 500);
    } finally {
      console.error = quiet;
      db.exec('DROP TRIGGER IF EXISTS temp.falha_notificacao');
    }
    // A notificação falhou: o cupom continua ativo.
    assert.equal(
      db.prepare('SELECT used_at FROM redemptions WHERE id = ?').get(redemption.id).used_at,
      null,
    );
  });

  it('não permite resgatar recompensa inexistente', async () => {
    const { token } = await registerUser();
    const { status, body } = await api('/rewards/9999/redeem', {
      method: 'POST',
      token,
    });
    assert.equal(status, 404);
    assert.match(body.error, /não encontrada/i);
  });
});
