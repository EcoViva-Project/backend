const express = require('express');
const { authRequired } = require('../middleware/auth');
const { bodyOf } = require('../services/errors');
const community = require('../services/community');

const router = express.Router();

router.use(authRequired);

router.get('/stats', (req, res) => {
  return res.json(community.communityStats(req.user));
});

router.get('/map', (req, res) => {
  return res.json(community.communityMap(req.user));
});

router.get('/posts', (req, res) => {
  return res.json({ posts: community.listPosts(req.user) });
});

router.post('/posts', (req, res) => {
  return res.status(201).json({ post: community.createPost(req.user, bodyOf(req)) });
});

router.post('/posts/:id/like', (req, res) => {
  return res.json(community.toggleLike(req.user, req.params.id));
});

router.get('/posts/:id/comments', (req, res) => {
  const post = community.requirePost(req.params.id);
  return res.json({ comments: community.commentsOf(post.id) });
});

router.post('/posts/:id/comments', (req, res) => {
  return res
    .status(201)
    .json({ comment: community.createComment(req.user, req.params.id, bodyOf(req)) });
});

router.delete('/posts/:id', (req, res) => {
  community.deletePost(req.user, req.params.id);
  return res.json({ ok: true });
});

module.exports = router;
