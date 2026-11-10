const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { api, registerUser, startServer, stopServer, resetDatabase } = require('./helpers');
const places = require('../src/services/places');

const name = (text) => places.findNeighborhood(text)?.name ?? null;

describe('places — reconhecer o bairro digitado', () => {
  it('todo bairro da lista acha a si mesmo', () => {
    for (const item of places.NEIGHBORHOODS) {
      assert.equal(places.findNeighborhood(item.name), item, item.name);
    }
  });

  it('aceita abreviações, pontuação e "de/da/do"', () => {
    assert.equal(name('Jd. Nazareth'), 'Jardim Nazareth');
    assert.equal(name('jd nazareth'), 'Jardim Nazareth');
    assert.equal(name('Vl Ercilia'), 'Vila Ercília');
    assert.equal(name('Pq Industrial'), 'Parque Industrial');
    assert.equal(name('Res. Lago Sul'), 'Residencial Lago Sul');
    assert.equal(name('Cj Hab Cristo Rei'), 'Conjunto Habitacional Cristo Rei');
    assert.equal(name('Vila Sto Antonio'), 'Vila Santo Antônio');
    assert.equal(name('Sta Filomena'), 'Santa Filomena');
    assert.equal(name('Bosque Saude'), 'Bosque da Saúde');
    assert.equal(name('Bosque de Saúde'), 'Bosque da Saúde');
    assert.equal(name('Vista Alegre 2'), 'Vista Alegre II');
    assert.equal(name('boa  vista!'), 'Boa Vista');
  });

  it('o nome exato ganha das aproximações', () => {
    // "Jardim Americano" também contém as palavras de "Jardim América".
    assert.equal(name('Jardim América'), 'Jardim América');
    assert.equal(name('Jd America'), 'Jardim América');
    assert.equal(name('Jardim Americano'), 'Jardim Americano');
    assert.equal(name('Parque das Flores'), 'Parque das Flores');
  });

  it('aceita um único candidato próximo (palavras contidas ou uma letra)', () => {
    assert.equal(name('Ercilia'), 'Vila Ercília');
    assert.equal(name('Toninho'), 'Vila Toninho');
    assert.equal(name('jd nazaret'), 'Jardim Nazareth');
    assert.equal(name('Higienopoles'), 'Higienópolis');
  });

  it('não escolhe quando há mais de um candidato', () => {
    // Vila Redentora e Nova Redentora.
    assert.equal(name('Redentora'), null);
    // Jardim Karina 1, 2 e 3: número diferente não é erro de digitação.
    assert.equal(name('Jardim Karina'), null);
    assert.equal(name('Jardim Karina 4'), null);
    assert.equal(name('Santa Cruz'), null);
    assert.equal(name('Sul'), null);
  });

  it('bairro desconhecido fica sem posição (nada de centro da cidade)', () => {
    assert.equal(name('Bairro Inventado'), null);
    assert.equal(places.approximatePosition('Bairro Inventado', 'ana@test.app'), null);
    assert.equal(places.approximatePosition('', 'ana@test.app'), null);
    assert.equal(places.approximatePosition(null, 'ana@test.app'), null);
    const viaAbbreviation = places.approximatePosition('Jd. Nazareth', 'ana@test.app');
    assert.deepEqual(viaAbbreviation, places.approximatePosition('Jardim Nazareth', 'ana@test.app'));
  });

  it('as sugestões também acham pelo nome abreviado', () => {
    assert.ok(places.searchNeighborhoods('Jd Nazar').includes('Jardim Nazareth'));
  });
});

describe('API — bairro fora da lista', () => {
  before(startServer);
  after(stopServer);
  beforeEach(resetDatabase);

  it('sem posição no cadastro, no perfil e no mapa; volta ao corrigir o bairro', async () => {
    const { token, user } = await registerUser({ neighborhood: 'Bairro Inventado' });
    assert.equal(user.location, null);

    const map = await api('/community/map', { token });
    assert.equal(map.status, 200);
    assert.equal(map.body.me, null);
    assert.deepEqual(map.body.center, places.CITY_CENTER);
    const points = await api('/collection-points', { token });
    assert.equal(points.status, 200);
    assert.ok(points.body.points.every((point) => point.distanceMeters === null));

    const fixed = await api('/users/me', {
      method: 'PATCH',
      token,
      body: { neighborhood: 'Vl Ercilia' },
    });
    assert.equal(fixed.status, 200);
    assert.deepEqual(
      fixed.body.user.location,
      places.approximatePosition('Vila Ercília', user.email),
    );

    const unknown = await api('/users/me', {
      method: 'PATCH',
      token,
      body: { neighborhood: 'Outro Inventado' },
    });
    assert.equal(unknown.body.user.location, null);
  });
});
