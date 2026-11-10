// Porte de `eco-app/test/local_api_test.dart`: os mesmos casos, contra a API.
// A API local do app é a implementação de referência; estes testes garantem
// que o modo online se comporta igual (regras, números e formato do JSON).

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  WEDNESDAY,
  DAY_MS,
  api,
  loginDemo,
  insertRow,
  resetDatabase,
  seedDemo,
  advanceClock,
  startServer,
  stopServer,
  clock,
  economy,
  seed,
  db,
} = require('./helpers');
const places = require('../src/services/places');

const CAP = economy.WEEKLY_CAP;

function harness() {
  const h = { token: null };
  h.call = (method, path, { body, anonymous = false } = {}) =>
    api(path, { method, body, token: anonymous ? undefined : h.token });
  h.ok = async (method, path, options) => {
    const response = await h.call(method, path, options);
    assert.ok(
      response.status >= 200 && response.status < 300,
      `${method} ${path} → ${response.status} ${JSON.stringify(response.body)}`,
    );
    return response.body;
  };
  h.status = async (method, path, options) => (await h.call(method, path, options)).status;
  h.loginDemo = async () => {
    h.token = await loginDemo();
  };
  h.summary = async () => (await h.ok('GET', '/progress')).summary;
  h.action = async (id) => (await h.ok('GET', `/actions/${id}`)).action;
  h.register = (id, quantity = 1) =>
    h.call('POST', `/actions/${id}/records`, { body: { quantity } });
  h.registerOk = async (id, quantity = 1) =>
    h.ok('POST', `/actions/${id}/records`, { body: { quantity } });
  return h;
}

describe('regras de calendário', () => {
  it('semana começa na segunda 00:00 de Brasília', () => {
    // Domingo 23:30 em Brasília ainda é a semana anterior.
    const sundayNight = new Date('2026-11-09T02:30:00Z');
    assert.equal(economy.dateKey(sundayNight), '2026-11-08');
    assert.equal(economy.weekStartKey(sundayNight), '2026-11-02');
    // Segunda 00:10 em Brasília já é a semana nova.
    const mondayEarly = new Date('2026-11-09T03:10:00Z');
    assert.equal(economy.weekStartKey(mondayEarly), '2026-11-09');
    assert.equal(economy.nextWeekReset(WEDNESDAY).toISOString(), '2026-11-16T03:00:00.000Z');
  });

  it('níveis seguem os pontos ganhos', () => {
    assert.equal(economy.levelFor(0).label, 'Semente • Nível 1');
    assert.equal(economy.levelFor(299).number, 1);
    assert.equal(economy.levelFor(300).label, 'Broto • Nível 2');
    assert.equal(economy.levelFor(1000).name, 'Muda');
    assert.equal(economy.levelFor(2500).name, 'Árvore');
    assert.equal(economy.levelFor(6000).label, 'Floresta • Nível 5');
    assert.equal(economy.levelFor(6000).next, null);
    assert.equal(economy.levelFor(450).next, 1000);
  });
});

describe('API com os dados de demonstração', () => {
  let h;
  before(startServer);
  after(stopServer);
  beforeEach(async () => {
    seedDemo();
    h = harness();
    await h.loginDemo();
  });

  describe('conta de demonstração', () => {
    it('semana atual fica logo abaixo do teto', async () => {
      const summary = await h.summary();
      assert.equal(summary.weeklyCap, CAP);
      assert.equal(summary.weeklyPoints, 375);
      assert.equal(summary.weeklyRemaining, 25);
      assert.equal(summary.weekResetsAt, '2026-11-16T03:00:00.000Z');
      assert.ok(summary.points > 1600);
      assert.equal(summary.pointsSpent, 1000);
      assert.ok(summary.levelNumber >= 3);
    });

    it('nenhuma semana do histórico passa do teto', () => {
      const byWeek = new Map();
      for (const row of db.prepare("SELECT * FROM action_records WHERE kind = 'action'").all()) {
        // O teto vale por pessoa: a conta de demonstração e cada vizinho.
        const week = `${row.user_id}/${economy.weekStartKey(row.created_at)}`;
        byWeek.set(week, (byWeek.get(week) || 0) + row.points);
        assert.equal(row.local_date, economy.dateKey(row.created_at));
      }
      assert.ok([...byWeek.keys()].filter((key) => key.startsWith('1/')).length >= 9);
      for (const total of byWeek.values()) assert.ok(total <= CAP);
    });

    it('desafios, conquistas e cupons têm estados variados', async () => {
      const { challenges } = await h.ok('GET', '/challenges');
      const water = challenges.find((c) => c.id === 1);
      assert.equal(water.joined, true);
      assert.equal(water.completedSteps, 3);
      assert.equal(water.stepDoneToday, true);
      assert.equal(water.daysLeft, 5);
      assert.equal(challenges.find((c) => c.id === 2).completed, true);
      assert.equal(challenges.find((c) => c.id === 4).joined, false);

      const { achievements } = await h.ok('GET', '/progress/achievements');
      assert.equal(achievements.length, 10);
      const energy = achievements.find((a) => a.key === 'guardiao-da-energia');
      assert.equal(energy.isUnlocked, false);
      assert.equal(energy.current, 5);
      const first = achievements.find((a) => a.key === 'primeiros-passos');
      assert.equal(first.isUnlocked, true);
      assert.ok(first.unlockedOn);

      const { redemptions } = await h.ok('GET', '/rewards/redemptions');
      assert.deepEqual(
        redemptions.map((r) => r.status),
        ['active', 'used', 'expired'],
      );
    });
  });

  describe('limites por ação e teto semanal', () => {
    it('limite diário da ação', async () => {
      const tap = await h.action(1);
      assert.equal(tap.dailyLimit, 2);
      assert.equal(tap.usedToday, 1);
      assert.equal(tap.remaining, 1);

      const twice = await h.register(1, 2);
      assert.equal(twice.status, 409);
      assert.equal(twice.body.error, 'Hoje você ainda pode registrar esta ação 1 vez.');
      const ok = await h.registerOk(1);
      assert.equal(ok.record.points, 5);
      const again = await h.register(1);
      assert.equal(again.status, 409);
      assert.equal(
        again.body.error,
        'Você já registrou esta ação 2 vezes hoje. Ela volta a valer amanhã.',
      );
      assert.equal((await h.action(1)).remaining, 0);
    });

    it('limite semanal do mutirão', async () => {
      const cleanup = await h.action(6);
      assert.equal(cleanup.weeklyLimit, 1);
      assert.equal(cleanup.remaining, 0);
      const response = await h.register(6);
      assert.equal(response.status, 409);
      assert.equal(
        response.body.error,
        'Esta ação pode ser registrada 1 vez por semana. Ela volta a valer na segunda-feira.',
      );
    });

    it('quantidade precisa ser inteira e positiva', async () => {
      for (const quantity of [2.5, 0, -1, '2', 51]) {
        const response = await h.call('POST', '/actions/5/records', { body: { quantity } });
        assert.equal(response.status, 400, `quantity=${quantity}`);
        assert.equal(response.body.error, 'A quantidade deve ser um número inteiro a partir de 1.');
      }
    });

    it('ao atingir o teto a ação continua valendo, sem pontos', async () => {
      const before = await h.summary();

      // Faltam 25 pontos: a compostagem (25) fecha o teto exatamente.
      const compost = await h.registerOk(4);
      assert.equal(compost.record.points, 25);
      assert.equal(compost.capReached, true);

      // Depois do teto, a ação é registrada com zero ponto.
      const bike = await h.registerOk(3);
      assert.equal(bike.record.basePoints, 30);
      assert.equal(bike.record.points, 0);
      assert.equal(bike.record.capped, true);
      assert.equal(bike.capReached, false);

      const after = bike.summary;
      assert.equal(after.weeklyPoints, CAP);
      assert.equal(after.weeklyRemaining, 0);
      assert.equal(after.actionsCount, before.actionsCount + 2);
      assert.equal(after.pointsEarned, before.pointsEarned + 25);

      const { notifications } = await h.ok('GET', '/notifications');
      assert.ok(notifications.some((n) => n.title === 'Teto semanal atingido'));
    });

    it('crédito parcial quando a ação passa do teto', async () => {
      await h.registerOk(5); // +5 → faltam 20
      const compost = await h.registerOk(4); // vale 25, credita 20
      assert.equal(compost.record.basePoints, 25);
      assert.equal(compost.record.points, 20);
      assert.equal(compost.record.capped, true);
      assert.equal(compost.capReached, true);
    });

    it('bônus de conquista não entra no teto', async () => {
      const before = await h.summary();
      // A sexta ação de Energia destrava "Guardião da Energia" (+80).
      const lights = await h.registerOk(5);
      assert.ok(lights.newAchievements.map((a) => a.key).includes('guardiao-da-energia'));
      assert.equal(lights.summary.weeklyPoints, before.weeklyPoints + 5);
      assert.equal(lights.summary.pointsEarned, before.pointsEarned + 5 + 80);
    });

    it('o teto zera na segunda-feira', async () => {
      await h.registerOk(4);
      assert.equal((await h.summary()).weeklyRemaining, 0);

      clock.setNow('2026-11-16T03:05:00Z'); // segunda, 00:05 em Brasília
      const summary = await h.summary();
      assert.equal(summary.weeklyPoints, 0);
      assert.equal(summary.weeklyRemaining, CAP);
      const bike = await h.registerOk(3);
      assert.equal(bike.record.points, 30);
    });
  });

  describe('desafios', () => {
    it('desafio por dias avança uma etapa por dia, mesmo sem pontos', async () => {
      const joined = await h.ok('POST', '/challenges/4/join');
      assert.equal(joined.challenge.joined, true);
      assert.equal(joined.challenge.daysLeft, 14);

      await h.registerOk(5);
      await h.registerOk(4); // fecha o teto
      let { challenge } = await h.ok('GET', '/challenges/4');
      assert.equal(challenge.completedSteps, 1);
      assert.equal(challenge.stepDoneToday, true);

      advanceClock(DAY_MS);
      const next = await h.registerOk(4);
      assert.equal(next.record.points, 0);
      assert.equal(next.challengeUpdates.length, 1);
      assert.equal(next.challengeUpdates[0].id, 4);
      assert.equal(next.challengeUpdates[0].completedSteps, 2);
      ({ challenge } = await h.ok('GET', '/challenges/4'));
      assert.equal(challenge.daysLeft, 13);
    });

    it('concluir desafio credita o bônus e avisa', async () => {
      // Semana sem desperdício de água: faltam 4 dias (quinta a domingo).
      let last = null;
      for (let i = 0; i < 4; i += 1) {
        advanceClock(DAY_MS);
        last = await h.registerOk(1);
      }
      assert.equal(last.challengeUpdates.length, 1);
      const water = last.challengeUpdates[0];
      assert.equal(water.completed, true);
      assert.equal(water.completedSteps, 7);

      const { records } = await h.ok('GET', '/records');
      const bonus = records.find((r) => r.kind === 'challenge');
      assert.equal(bonus.points, 100);
      assert.match(bonus.title, /Semana sem desperdício de água/);

      const { notifications } = await h.ok('GET', '/notifications');
      const done = notifications.find((n) => n.title === 'Desafio concluído!');
      assert.equal(done.category, 'desafio');
      assert.equal(done.target, '/desafios');
    });

    it('desafio vencido pode ser recomeçado', async () => {
      await h.ok('POST', '/challenges/4/join');
      await h.registerOk(4);
      advanceClock(15 * DAY_MS);
      let { challenge } = await h.ok('GET', '/challenges/4');
      assert.equal(challenge.expired, true);
      assert.equal(challenge.daysLeft, 0);

      ({ challenge } = await h.ok('POST', '/challenges/4/join'));
      assert.equal(challenge.expired, false);
      assert.equal(challenge.completedSteps, 0);
    });

    it('avanço manual de etapa não existe mais', async () => {
      const response = await h.call('POST', '/challenges/1/progress', { body: { steps: 99 } });
      assert.equal(response.status, 410);
      assert.match(response.body.error, /avança sozinho/);
    });
  });

  describe('recompensas e cupons', () => {
    async function rewardNamed(title) {
      const { rewards } = await h.ok('GET', '/rewards');
      return rewards.find((r) => r.title === title);
    }

    it('preço segue o valor do benefício', async () => {
      const { rewards } = await h.ok('GET', '/rewards');
      assert.equal(rewards.length, seed.REWARDS.length);
      for (const reward of rewards) {
        const full = Math.trunc((reward.valueCents * economy.POINTS_PER_REAL) / 100);
        if (reward.category === 'jogo') {
          assert.equal(reward.pointsCost, Math.round(full * 0.8));
        } else {
          assert.equal(reward.pointsCost, full);
        }
      }
    });

    it('resgate gera cupom válido, debita pontos e respeita o limite', async () => {
      const before = await h.summary();
      const dish = await rewardNamed('Prato do dia vegetariano grátis');
      const result = await h.ok('POST', `/rewards/${dish.id}/redeem`);

      const coupon = result.redemption;
      assert.match(coupon.code, /^ECO-/);
      assert.equal(coupon.status, 'active');
      assert.equal(coupon.partnerName, 'Restaurante Sabor da Terra');
      assert.equal(coupon.partnerAddress, 'Rua do Mercado, 210');
      assert.equal(
        new Date(coupon.expiresAt).getTime(),
        clock.now().getTime() + 30 * DAY_MS,
      );
      assert.equal(result.summary.points, before.points - 1600);
      assert.equal(result.reward.stock, dish.stock - 1);
      assert.equal(result.reward.limitReached, true);

      // Limite de 1 resgate por pessoa a cada 30 dias.
      const again = await h.call('POST', `/rewards/${dish.id}/redeem`);
      assert.equal(again.status, 409);
      assert.equal(
        again.body.error,
        'Você já resgatou esta recompensa 1 vez nos últimos 30 dias.',
      );
    });

    it('recusa resgate sem saldo ou sem estoque', async () => {
      const cleaning = await rewardNamed('Limpeza ecológica residencial');
      const noPoints = await h.call('POST', `/rewards/${cleaning.id}/redeem`);
      assert.equal(noPoints.status, 409);
      assert.match(noPoints.body.error, /Pontos insuficientes/);
      const shirt = await rewardNamed('Camisa oficial EcoViva');
      assert.equal(shirt.available, false);
      const soldOut = await h.call('POST', `/rewards/${shirt.id}/redeem`);
      assert.equal(soldOut.status, 409);
      assert.equal(soldOut.body.error, 'Esta recompensa está esgotada.');
    });

    it('parceiro confere o cupom com o código dele', async () => {
      const { redemptions } = await h.ok('GET', '/rewards/redemptions');
      const active = redemptions.find((r) => r.status === 'active');
      const used = redemptions.find((r) => r.status === 'used');
      const expired = redemptions.find((r) => r.status === 'expired');

      const wrong = await h.call('POST', `/rewards/redemptions/${active.id}/use`, {
        body: { pin: '0000' },
      });
      assert.equal(wrong.status, 403);
      assert.equal(wrong.body.error, 'Código do parceiro incorreto.');
      const result = await h.ok('POST', `/rewards/redemptions/${active.id}/use`, {
        body: { pin: seed.DEMO_PARTNER_PIN },
      });
      assert.equal(result.redemption.status, 'used');
      assert.ok(result.redemption.usedAt);

      for (const other of [active, used, expired]) {
        const response = await h.call('POST', `/rewards/redemptions/${other.id}/use`, {
          body: { pin: seed.DEMO_PARTNER_PIN },
        });
        assert.equal(response.status, 409);
      }
      const missing = await h.call('POST', '/rewards/redemptions/9999/use', {
        body: { pin: seed.DEMO_PARTNER_PIN },
      });
      assert.equal(missing.status, 404);
    });

    it('cupom vence depois da validade', async () => {
      const combo = await rewardNamed('15% de desconto no combo');
      const result = await h.ok('POST', `/rewards/${combo.id}/redeem`);
      const { id } = result.redemption;
      advanceClock(31 * DAY_MS);
      const { redemptions } = await h.ok('GET', '/rewards/redemptions');
      assert.equal(redemptions.find((r) => r.id === id).status, 'expired');
    });
  });

  describe('conta e comunidade', () => {
    beforeEach(() => {
      h.token = null;
    });

    it('cadastro valida os dados e não vaza se o e-mail existe', async () => {
      const register = (body) => h.call('POST', '/auth/register', { body, anonymous: true });

      assert.equal((await register({ name: '  ', email: 'a@b.co', password: '123456' })).status, 400);
      assert.equal(
        (await register({ name: 'Ana', email: 'sem-arroba', password: '123456' })).status,
        400,
      );
      assert.equal(
        (await register({ name: 'Ana', email: 'ana@test.app', password: '123' })).status,
        400,
      );
      assert.equal(
        (await register({ name: 'Outra Clara', email: 'CLARA@eco.app', password: '123456' }))
          .status,
        409,
      );

      const created = await register({
        name: 'Ana Silva',
        email: 'Ana@Test.app',
        password: 'segredo1',
      });
      assert.equal(created.status, 201);
      assert.equal(created.body.user.email, 'ana@test.app');
      assert.equal(created.body.user.initials, 'AS');
      h.token = created.body.token;
      const summary = await h.summary();
      assert.equal(summary.points, 0);
      assert.equal(summary.level, 'Semente • Nível 1');

      const known = await h.ok('POST', '/auth/forgot-password', {
        body: { email: 'ana@test.app' },
        anonymous: true,
      });
      const unknown = await h.ok('POST', '/auth/forgot-password', {
        body: { email: 'ninguem@test.app' },
        anonymous: true,
      });
      assert.equal(unknown.message, known.message);
      assert.equal(unknown.expiresInMinutes, known.expiresInMinutes);
    });

    it('login e sessão', async () => {
      const wrong = await h.call('POST', '/auth/login', {
        body: { email: seed.DEMO_EMAIL, password: 'errada' },
        anonymous: true,
      });
      assert.equal(wrong.status, 401);
      assert.equal(await h.status('GET', '/progress', { anonymous: true }), 401);
      h.token = 'token-invalido';
      assert.equal(await h.status('GET', '/progress'), 401);
      await h.loginDemo();
      const me = await h.ok('GET', '/auth/me');
      assert.equal(me.user.name, 'Clara Mendes');
    });

    it('código de recuperação bloqueia depois de 5 erros', async () => {
      const forgot = await h.ok('POST', '/auth/forgot-password', {
        body: { email: seed.DEMO_EMAIL },
        anonymous: true,
      });
      const code = forgot.devCode;
      for (let i = 0; i < 5; i += 1) {
        const response = await h.call('POST', '/auth/reset-password', {
          body: {
            email: seed.DEMO_EMAIL,
            code: code === '111111' ? '222222' : '111111',
            password: 'novasenha',
          },
          anonymous: true,
        });
        assert.equal(response.status, 400);
      }
      const response = await h.call('POST', '/auth/reset-password', {
        body: { email: seed.DEMO_EMAIL, code, password: 'novasenha' },
        anonymous: true,
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.error, 'Código inválido ou expirado.');
    });

    it('publicar, curtir, comentar e excluir', async () => {
      await h.loginDemo();
      const created = await h.ok('POST', '/community/posts', {
        body: { content: 'Olá, vizinhança!' },
      });
      const { id } = created.post;
      assert.equal(created.post.isMine, true);

      assert.deepEqual(await h.ok('POST', `/community/posts/${id}/like`), {
        likes: 1,
        likedByMe: true,
      });
      assert.deepEqual(await h.ok('POST', `/community/posts/${id}/like`), {
        likes: 0,
        likedByMe: false,
      });

      const comment = await h.ok('POST', `/community/posts/${id}/comments`, {
        body: { content: 'Primeiro comentário' },
      });
      assert.equal(comment.comment.authorName, 'Clara Mendes');

      const { posts: feed } = await h.ok('GET', '/community/posts');
      assert.equal(feed[0].id, id);
      assert.equal(feed[0].comments.length, 1);
      const other = feed.find((p) => p.isMine === false);
      assert.equal(await h.status('DELETE', `/community/posts/${other.id}`), 403);
      await h.ok('DELETE', `/community/posts/${id}`);
      const { posts: after } = await h.ok('GET', '/community/posts');
      assert.equal(after.some((p) => p.id === id), false);
    });
  });

  describe('bairro: estatísticas, mapa e pontos de coleta', () => {
    it('números do bairro saem dos registros e sobem ao registrar', async () => {
      const before = await h.ok('GET', '/community/stats');
      assert.equal(before.members, seed.NEIGHBORS.length + 1);
      assert.ok(before.activeNeighbors > 12);
      assert.ok(before.actionsToday > 5);
      const { goal } = before;
      assert.equal(goal.target, seed.WEEKLY_GOAL_TARGET);
      assert.equal(goal.current, before.actionsThisWeek);
      // Quarta à tarde: perto de 40% da meta, no ritmo para fechar no domingo.
      assert.ok(goal.progress >= 0.3 && goal.progress <= 0.6);
      assert.equal(goal.daysLeft, 5);
      assert.ok(goal.contributors > 10);

      assert.equal(before.ranking.length, 5);
      assert.equal(before.ranking[0].position, 1);
      assert.ok(before.myPosition <= 3);
      assert.equal(before.myWeeklyPoints, 375);
      for (const entry of before.ranking) assert.ok(entry.points <= CAP);
      // Ninguém da comunidade aparece com e-mail ou endereço.
      for (const entry of before.ranking) {
        assert.equal(entry.email, undefined);
        assert.equal(entry.address, undefined);
      }

      await h.registerOk(5);
      const after = await h.ok('GET', '/community/stats');
      assert.equal(after.actionsThisWeek, before.actionsThisWeek + 1);
      assert.equal(after.actionsToday, before.actionsToday + 1);
      assert.equal(after.goal.current, goal.current + 1);
      assert.equal(after.myWeeklyPoints, 380);
    });

    it('números exatos da demonstração (iguais ao modo local do app)', async () => {
      const stats = await h.ok('GET', '/community/stats');
      assert.equal(stats.members, 19);
      assert.equal(stats.actionsThisWeek, 157);
    });

    it('cada ação diz quantos vizinhos registraram hoje', async () => {
      const { actions } = await h.ok('GET', '/actions');
      const tap = actions.find((a) => a.id === 1);
      assert.ok(tap.neighborsToday > 3);
      const total = actions.reduce((sum, a) => sum + a.neighborsToday, 0);
      assert.ok(total > 8);
    });

    it('participantes dos desafios são contados de verdade', async () => {
      const { challenges } = await h.ok('GET', '/challenges');
      assert.equal(challenges.find((c) => c.id === 1).participants, 10);
      const before = challenges.find((c) => c.id === 4).participants;
      const joined = await h.ok('POST', '/challenges/4/join');
      assert.equal(joined.challenge.participants, before + 1);
    });

    it('pessoa aparece no mapa na região do bairro, nunca no ponto exato', async () => {
      const { user: me } = await h.ok('GET', '/auth/me');
      assert.equal(me.neighborhood, 'Boa Vista');
      assert.equal(me.city, 'São José do Rio Preto');
      const boaVista = places.findNeighborhood('boa vista');
      const distance = places.distanceMeters(
        boaVista.lat,
        boaVista.lon,
        me.location.lat,
        me.location.lon,
      );
      assert.ok(distance >= 1 && distance <= 600, `distância ${distance}`);

      const map = await h.ok('GET', '/community/map');
      assert.equal(map.neighbors.length, seed.NEIGHBORS.length);
      assert.equal(map.me.visible, true);
      assert.match(map.attribution, /OpenStreetMap/);
      for (const neighbor of map.neighbors) {
        assert.ok(neighbor.name.endsWith('.'));
        assert.equal('email' in neighbor, false);
        assert.equal('address' in neighbor, false);
      }

      // Quem desliga a preferência some do mapa dos outros.
      await h.ok('PATCH', '/users/me/preferences', { body: { privacyLocation: false } });
      const hidden = await h.ok('GET', '/community/map');
      assert.equal(hidden.me.visible, false);
    });

    it('cadastro com endereço posiciona pelo bairro', async () => {
      const register = (body) => h.call('POST', '/auth/register', { body, anonymous: true });

      const badCep = await register({
        name: 'Ana Silva',
        email: 'ana@test.app',
        password: 'segredo1',
        cep: '123',
      });
      assert.equal(badCep.status, 400);
      assert.equal(badCep.body.error, 'Informe um CEP com 8 dígitos.');

      const created = await register({
        name: 'Ana Silva',
        email: 'ana@test.app',
        password: 'segredo1',
        cep: '15015110',
        street: 'Rua Bernardino de Campos',
        number: '3000',
        neighborhood: 'vila redentora',
        city: 'São José do Rio Preto',
        state: 'sp',
      });
      assert.equal(created.status, 201);
      const { user } = created.body;
      assert.equal(user.address.cep, '15015-110');
      assert.equal(user.address.street, 'Rua Bernardino de Campos');
      assert.equal(user.address.state, 'SP');
      const redentora = places.findNeighborhood('Vila Redentora');
      assert.ok(
        places.distanceMeters(redentora.lat, redentora.lon, user.location.lat, user.location.lon) <
          600,
      );

      const found = await h.ok('GET', '/places/neighborhoods?search=redent');
      assert.ok(found.neighborhoods.includes('Vila Redentora'));
    });

    it('pontos de coleta vêm ordenados pela distância', async () => {
      const center = places.findNeighborhood('Centro');
      const far = places.findNeighborhood('Vila Toninho');
      for (const [name, place] of [
        ['Longe', far],
        ['Perto', center],
      ]) {
        insertRow('collection_points', {
          name,
          type: 'ecoponto',
          materials: '["papel","vidro"]',
          address: 'Endereço de teste',
          neighborhood: place.name,
          lat: place.lat,
          lon: place.lon,
        });
      }
      insertRow('collection_points', { name: 'Sem coordenada', type: 'oleo', materials: '[]' });

      const { points } = await h.ok('GET', '/collection-points');
      const mine = points.filter((p) => ['Perto', 'Longe', 'Sem coordenada'].includes(p.name));
      assert.deepEqual(
        mine.map((p) => p.name),
        ['Perto', 'Longe', 'Sem coordenada'],
      );
      assert.ok(mine[0].distanceMeters < 2500);
      assert.deepEqual(mine[0].materials, ['papel', 'vidro']);
      assert.equal(mine[2].distanceMeters, null);

      const { points: filtered } = await h.ok('GET', '/collection-points?type=oleo');
      assert.ok(filtered.some((p) => p.name === 'Sem coordenada'));
      assert.equal(filtered.some((p) => p.name === 'Perto'), false);

      const { points: searched } = await h.ok('GET', '/collection-points?search=ENDERECO%20de');
      assert.deepEqual(searched.map((p) => p.name).sort(), ['Longe', 'Perto']);
    });

    it('dica do dia vem do banco e muda com o dia', async () => {
      const { tip: today } = await h.ok('GET', '/tips/today');
      assert.ok(today.text);
      advanceClock(DAY_MS);
      const { tip: tomorrow } = await h.ok('GET', '/tips/today');
      assert.notEqual(tomorrow.id, today.id);
    });
  });

  describe('persistência', () => {
    it('recriar a demonstração volta ao estado inicial', async () => {
      const initial = await h.summary();
      await h.registerOk(5);
      await h.registerOk(4);
      assert.equal((await h.summary()).weeklyRemaining, 0);

      seedDemo();
      await h.loginDemo();
      assert.deepEqual(await h.summary(), initial);
    });
  });
});

describe('pontos de coleta reais', () => {
  before(resetDatabase);

  it('a carga lê o arquivo de pontos de coleta, todos com coordenada', () => {
    seedDemo();
    const total = db.prepare('SELECT COUNT(*) AS total FROM collection_points').get().total;
    assert.ok(total > 0);
    const withoutCoordinates = db
      .prepare('SELECT COUNT(*) AS total FROM collection_points WHERE lat IS NULL OR lon IS NULL')
      .get().total;
    assert.equal(withoutCoordinates, 0);
  });
});
