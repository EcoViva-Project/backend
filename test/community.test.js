const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  api,
  registerUser,
  insertRecord,
  startServer,
  stopServer,
  resetDatabase,
  db,
} = require('./helpers');

describe('API — comunidade', () => {
  before(startServer);
  after(stopServer);
  beforeEach(resetDatabase);

  it('perfil não visível: os outros veem "Alguém do bairro" no feed, comentários, aviso, ranking e mapa', async () => {
    const ana = await registerUser({ name: 'Ana Exemplo Silva', email: 'ana@test.app', neighborhood: 'Boa Vista' });
    const bia = await registerUser({ name: 'Bia Souza', email: 'bia@test.app', neighborhood: 'Boa Vista' });
    const preferences = (token, body) =>
      api('/users/me/preferences', { method: 'PATCH', token, body });
    assert.equal((await preferences(ana.token, { privacyProfile: false, privacyLocation: true })).status, 200);
    assert.equal((await preferences(bia.token, { privacyLocation: true })).status, 200);

    // Publicação e comentário da Ana; a Bia comenta e a Ana comenta na da Bia.
    const anaPost = await api('/community/posts', {
      method: 'POST',
      token: ana.token,
      body: { content: 'Publicação da Ana' },
    });
    const biaPost = await api('/community/posts', {
      method: 'POST',
      token: bia.token,
      body: { content: 'Publicação da Bia' },
    });
    await api(`/community/posts/${anaPost.body.post.id}/comments`, {
      method: 'POST',
      token: bia.token,
      body: { content: 'Comentário da Bia' },
    });
    const anaComment = await api(`/community/posts/${biaPost.body.post.id}/comments`, {
      method: 'POST',
      token: ana.token,
      body: { content: 'Comentário da Ana' },
    });
    insertRecord({ userId: ana.user.id, points: 30 });
    insertRecord({ userId: bia.user.id, points: 20 });

    const ANON = { name: 'Alguém do bairro', initials: '•' };
    const feedOf = async (token) => (await api('/community/posts', { token })).body.posts;
    const byContent = (posts, content) => posts.find((post) => post.content === content);

    // Visto pela Bia: a Ana é anônima em tudo.
    const biaFeed = await feedOf(bia.token);
    const anaPostSeen = byContent(biaFeed, 'Publicação da Ana');
    assert.deepEqual([anaPostSeen.authorName, anaPostSeen.authorInitials], [ANON.name, ANON.initials]);
    const anaCommentSeen = byContent(biaFeed, 'Publicação da Bia').comments[0];
    assert.deepEqual([anaCommentSeen.authorName, anaCommentSeen.authorInitials], [ANON.name, ANON.initials]);
    const comments = (await api(`/community/posts/${biaPost.body.post.id}/comments`, { token: bia.token })).body.comments;
    assert.equal(comments[0].authorName, ANON.name);
    // A Bia (perfil visível) continua com o nome dela.
    assert.equal(anaPostSeen.comments[0].authorName, 'Bia Souza');

    const notice = db
      .prepare("SELECT message FROM notifications WHERE user_id = ? AND title = 'Novo comentário'")
      .get(bia.user.id);
    assert.equal(notice.message, 'Alguém do bairro comentou na sua publicação.');
    assert.ok(!JSON.stringify((await api('/notifications', { token: bia.token })).body).includes('Ana'));

    const ranking = (await api('/community/stats', { token: bia.token })).body.ranking;
    const anaRank = ranking.find((row) => row.points === 30);
    assert.deepEqual([anaRank.name, anaRank.initials, anaRank.position], [ANON.name, ANON.initials, 1]);

    const map = (await api('/community/map', { token: bia.token })).body;
    const anaOnMap = map.neighbors.find((person) => person.id === ana.user.id);
    assert.deepEqual([anaOnMap.name, anaOnMap.initials], [ANON.name, ANON.initials]);
    assert.equal(anaOnMap.weeklyPoints, 30);
    assert.equal(typeof anaOnMap.lat, 'number');

    // Nada do nome real sai nas respostas para a Bia.
    for (const body of [biaFeed, ranking, map.neighbors, comments]) {
      assert.ok(!JSON.stringify(body).includes('Ana Exemplo'), JSON.stringify(body).slice(0, 200));
    }

    // A própria Ana se vê com o nome real.
    const anaFeed = await feedOf(ana.token);
    assert.equal(byContent(anaFeed, 'Publicação da Ana').authorName, 'Ana Exemplo Silva');
    assert.equal(anaComment.body.comment.authorName, 'Ana Exemplo Silva');
    const anaRanking = (await api('/community/stats', { token: ana.token })).body.ranking;
    assert.equal(anaRanking.find((row) => row.isMe).name, 'Ana Exemplo Silva');

    // Ligado de novo, o nome volta (a regra vale na hora da leitura).
    assert.equal((await preferences(ana.token, { privacyProfile: true })).status, 200);
    const again = await feedOf(bia.token);
    assert.equal(byContent(again, 'Publicação da Ana').authorName, 'Ana Exemplo Silva');
    assert.equal(byContent(again, 'Publicação da Ana').authorInitials, 'AS');
    assert.equal(byContent(again, 'Publicação da Bia').comments[0].authorName, 'Ana Exemplo Silva');
    const rankingAgain = (await api('/community/stats', { token: bia.token })).body.ranking;
    assert.equal(rankingAgain.find((row) => row.points === 30).name, 'Ana S.');
    const mapAgain = (await api('/community/map', { token: bia.token })).body;
    assert.equal(mapAgain.neighbors.find((person) => person.id === ana.user.id).name, 'Ana S.');
  });

  it('comunidade exige autenticação', async () => {
    const { status } = await api('/community/posts');
    assert.equal(status, 401);
  });

  it('valida o conteúdo da publicação', async () => {
    const { token } = await registerUser();

    const tooShort = await api('/community/posts', {
      method: 'POST',
      token,
      body: { content: 'oi' },
    });
    assert.equal(tooShort.status, 400);
    assert.match(tooShort.body.error, /pelo menos 3/);

    const tooLong = await api('/community/posts', {
      method: 'POST',
      token,
      body: { content: 'a'.repeat(1001) },
    });
    assert.equal(tooLong.status, 400);
    assert.match(tooLong.body.error, /no máximo 1000/);
  });

  it('publica e lista posts no feed', async () => {
    const { token, user } = await registerUser();

    const created = await api('/community/posts', {
      method: 'POST',
      token,
      body: { content: 'Minha primeira publicação sustentável!' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.post.authorName, user.name);
    assert.equal(created.body.post.authorInitials, user.initials);
    assert.equal(created.body.post.likes, 0);
    assert.equal(created.body.post.likedByMe, false);
    assert.deepEqual(created.body.post.comments, []);

    const feed = await api('/community/posts', { token });
    assert.equal(feed.status, 200);
    assert.equal(feed.body.posts.length, 1);
    assert.equal(feed.body.posts[0].id, created.body.post.id);
  });

  it('alterna curtida do usuário', async () => {
    const { token } = await registerUser();
    const created = await api('/community/posts', {
      method: 'POST',
      token,
      body: { content: 'Post para curtir' },
    });
    const postId = created.body.post.id;

    const liked = await api(`/community/posts/${postId}/like`, { method: 'POST', token });
    assert.equal(liked.status, 200);
    assert.equal(liked.body.likes, 1);
    assert.equal(liked.body.likedByMe, true);

    const unliked = await api(`/community/posts/${postId}/like`, { method: 'POST', token });
    assert.equal(unliked.body.likes, 0);
    assert.equal(unliked.body.likedByMe, false);

    const missing = await api('/community/posts/9999/like', { method: 'POST', token });
    assert.equal(missing.status, 404);
  });

  it('valida e cria comentários', async () => {
    const { token } = await registerUser();
    const created = await api('/community/posts', {
      method: 'POST',
      token,
      body: { content: 'Post para comentar' },
    });
    const postId = created.body.post.id;

    const missingPost = await api('/community/posts/9999/comments', { token });
    assert.equal(missingPost.status, 404);

    const empty = await api(`/community/posts/${postId}/comments`, {
      method: 'POST',
      token,
      body: { content: '   ' },
    });
    assert.equal(empty.status, 400);

    const tooLong = await api(`/community/posts/${postId}/comments`, {
      method: 'POST',
      token,
      body: { content: 'a'.repeat(501) },
    });
    assert.equal(tooLong.status, 400);

    const createdComment = await api(`/community/posts/${postId}/comments`, {
      method: 'POST',
      token,
      body: { content: 'Comentário válido' },
    });
    assert.equal(createdComment.status, 201);
    assert.equal(createdComment.body.comment.content, 'Comentário válido');

    const comments = await api(`/community/posts/${postId}/comments`, { token });
    assert.equal(comments.body.comments.length, 1);

    const feed = await api('/community/posts', { token });
    assert.equal(feed.body.posts[0].comments.length, 1);
  });

  it('comentar em post de outro usuário gera notificação', async () => {
    const author = await registerUser({ email: 'autora@test.app', name: 'Autora Silva' });
    const visitor = await registerUser({ email: 'visita@test.app', name: 'Visita Souza' });

    const created = await api('/community/posts', {
      method: 'POST',
      token: author.token,
      body: { content: 'Post da autora' },
    });

    const comment = await api(`/community/posts/${created.body.post.id}/comments`, {
      method: 'POST',
      token: visitor.token,
      body: { content: 'Muito bom!' },
    });
    assert.equal(comment.status, 201);

    const notifications = await api('/notifications', { token: author.token });
    const commentNotification = notifications.body.notifications.find(
      (item) => item.title === 'Novo comentário',
    );
    assert.ok(commentNotification);
    assert.match(commentNotification.message, /Visita Souza/);
  });

  it('comentário e notificação são gravados juntos (transação)', async () => {
    const author = await registerUser({ email: 'autora@test.app' });
    const visitor = await registerUser({ email: 'visita@test.app' });
    const created = await api('/community/posts', {
      method: 'POST',
      token: author.token,
      body: { content: 'Post da autora' },
    });

    db.exec(`CREATE TEMP TRIGGER falha_notificacao BEFORE INSERT ON notifications
             BEGIN SELECT RAISE(ABORT, 'falha simulada'); END`);
    const quiet = console.error;
    console.error = () => {};
    try {
      const comment = await api(`/community/posts/${created.body.post.id}/comments`, {
        method: 'POST',
        token: visitor.token,
        body: { content: 'Muito bom!' },
      });
      assert.equal(comment.status, 500);
    } finally {
      console.error = quiet;
      db.exec('DROP TRIGGER IF EXISTS temp.falha_notificacao');
    }
    // A notificação falhou: o comentário também não ficou gravado.
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM post_comments').get().total, 0);
  });

  it('ranking: esconde o bairro de quem não aceitou aparecer no mapa (menos o próprio)', async () => {
    const ana = await registerUser({ email: 'ana@test.app', neighborhood: 'Boa Vista' });
    const bia = await registerUser({
      email: 'bia@test.app',
      name: 'Bia Souza',
      neighborhood: 'Centro',
    });
    db.prepare('UPDATE users SET privacy_location = 0 WHERE id = ?').run(ana.user.id);
    db.prepare('UPDATE users SET privacy_location = 1 WHERE id = ?').run(bia.user.id);
    insertRecord({ userId: ana.user.id, points: 30 });
    insertRecord({ userId: bia.user.id, points: 20 });

    const entryOf = (ranking, isMe) => ranking.find((entry) => entry.isMe === isMe);

    // Ana vê o próprio bairro e o da Bia (que aceitou aparecer).
    const forAna = (await api('/community/stats', { token: ana.token })).body.ranking;
    assert.equal(forAna.length, 2);
    assert.equal(entryOf(forAna, true).neighborhood, 'Boa Vista');
    assert.equal(entryOf(forAna, false).neighborhood, 'Centro');

    // Bia não vê o bairro da Ana, que desligou "aparecer no mapa".
    const forBia = (await api('/community/stats', { token: bia.token })).body.ranking;
    assert.equal(entryOf(forBia, true).neighborhood, 'Centro');
    assert.equal(entryOf(forBia, false).neighborhood, null);
    assert.equal(entryOf(forBia, false).points, 30);
  });

  it('busca de bairros é pública (o cadastro usa antes do login); o resto do bairro não', async () => {
    const found = await api('/places/neighborhoods?search=redent');
    assert.equal(found.status, 200);
    assert.ok(found.body.neighborhoods.includes('Vila Redentora'));

    assert.equal((await api('/collection-points')).status, 401);
    assert.equal((await api('/tips/today')).status, 401);
    assert.equal((await api('/community/stats')).status, 401);
  });

  it('apenas o autor pode excluir a publicação', async () => {
    const author = await registerUser({ email: 'autora@test.app' });
    const visitor = await registerUser({ email: 'visita@test.app' });

    const created = await api('/community/posts', {
      method: 'POST',
      token: author.token,
      body: { content: 'Post a ser excluído' },
    });
    const postId = created.body.post.id;

    const forbidden = await api(`/community/posts/${postId}`, {
      method: 'DELETE',
      token: visitor.token,
    });
    assert.equal(forbidden.status, 403);

    const removed = await api(`/community/posts/${postId}`, {
      method: 'DELETE',
      token: author.token,
    });
    assert.equal(removed.status, 200);

    const missing = await api(`/community/posts/${postId}`, {
      method: 'DELETE',
      token: author.token,
    });
    assert.equal(missing.status, 404);
  });
});
