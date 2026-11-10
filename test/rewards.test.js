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
  startServer,
  stopServer,
  resetDatabase,
} = require('./helpers');

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
