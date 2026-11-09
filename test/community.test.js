const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { api, registerUser, startServer, stopServer, resetDatabase } = require('./helpers');

describe('API — comunidade', () => {
  before(startServer);
  after(stopServer);
  beforeEach(resetDatabase);

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
