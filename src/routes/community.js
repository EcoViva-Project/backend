const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const {
  postFromRow,
  commentFromRow,
  createNotification,
} = require('../services/serializers');

const router = express.Router();

router.use(authRequired);

function findPost(postId) {
  return db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
}

router.get('/posts', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM posts ORDER BY created_at DESC, id DESC LIMIT 100')
    .all();
  return res.json({ posts: rows.map((row) => postFromRow(row, req.user.id)) });
});

router.post('/posts', (req, res) => {
  const content = String(req.body?.content || '').trim();
  if (content.length < 3) {
    return res.status(400).json({ error: 'Escreva uma mensagem com pelo menos 3 caracteres.' });
  }
  if (content.length > 1000) {
    return res.status(400).json({ error: 'A mensagem deve ter no máximo 1000 caracteres.' });
  }

  const info = db
    .prepare(
      `INSERT INTO posts (user_id, author_name, author_initials, content, base_likes, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
    )
    .run(req.user.id, req.user.name, req.user.initials, content, new Date().toISOString());

  const post = findPost(info.lastInsertRowid);
  return res.status(201).json({ post: postFromRow(post, req.user.id) });
});

router.post('/posts/:id/like', (req, res) => {
  const post = findPost(req.params.id);
  if (!post) {
    return res.status(404).json({ error: 'Publicação não encontrada.' });
  }

  const liked = db
    .prepare('SELECT 1 AS liked FROM post_likes WHERE post_id = ? AND user_id = ?')
    .get(post.id, req.user.id);

  if (liked) {
    db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(
      post.id,
      req.user.id,
    );
  } else {
    db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)').run(
      post.id,
      req.user.id,
    );
  }

  const updated = postFromRow(post, req.user.id);
  return res.json({ likes: updated.likes, likedByMe: updated.likedByMe });
});

router.get('/posts/:id/comments', (req, res) => {
  const post = findPost(req.params.id);
  if (!post) {
    return res.status(404).json({ error: 'Publicação não encontrada.' });
  }
  const rows = db
    .prepare('SELECT * FROM post_comments WHERE post_id = ? ORDER BY created_at ASC, id ASC')
    .all(post.id);
  return res.json({ comments: rows.map(commentFromRow) });
});

router.post('/posts/:id/comments', (req, res) => {
  const post = findPost(req.params.id);
  if (!post) {
    return res.status(404).json({ error: 'Publicação não encontrada.' });
  }

  const content = String(req.body?.content || '').trim();
  if (content.length < 1) {
    return res.status(400).json({ error: 'Escreva um comentário.' });
  }
  if (content.length > 500) {
    return res.status(400).json({ error: 'O comentário deve ter no máximo 500 caracteres.' });
  }

  const info = db
    .prepare(
      `INSERT INTO post_comments
        (post_id, user_id, author_name, author_initials, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      post.id,
      req.user.id,
      req.user.name,
      req.user.initials,
      content,
      new Date().toISOString(),
    );

  if (post.user_id && post.user_id !== req.user.id) {
    createNotification(
      post.user_id,
      'comunidade',
      'Novo comentário',
      `${req.user.name} comentou na sua publicação.`,
    );
  }

  const comment = commentFromRow(
    db.prepare('SELECT * FROM post_comments WHERE id = ?').get(info.lastInsertRowid),
  );
  return res.status(201).json({ comment });
});

router.delete('/posts/:id', (req, res) => {
  const post = findPost(req.params.id);
  if (!post) {
    return res.status(404).json({ error: 'Publicação não encontrada.' });
  }
  if (post.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Você só pode excluir suas publicações.' });
  }
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  return res.json({ ok: true });
});

module.exports = router;
