// Comunidade: feed, números do bairro, mapa, pontos de coleta e dica do dia.
//
// Espelha as seções "Comunidade" e "Bairro" de `eco-app/lib/core/local/local_api.dart`.
// Nada aqui devolve e-mail nem endereço de outra pessoa: só nome curto,
// iniciais, bairro e posição aproximada (de quem aceitou aparecer no mapa).

const db = require('../db');
const clock = require('./clock');
const economy = require('./economy');
const places = require('./places');
const { fail } = require('./errors');
const { notify } = require('./notifications');
const { iso, int, flag, clean, relativeTime, shortName } = require('./util');

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

function findPost(id) {
  return db.prepare('SELECT * FROM posts WHERE id = ?').get(id) || null;
}

function requirePost(id) {
  const post = findPost(id);
  if (!post) fail(404, 'Publicação não encontrada.');
  return post;
}

function commentJson(row) {
  return {
    id: row.id,
    authorName: row.author_name,
    authorInitials: row.author_initials,
    content: row.content,
    timeLabel: relativeTime(row.created_at),
    createdAt: row.created_at,
  };
}

function commentsOf(postId) {
  return db
    .prepare('SELECT * FROM post_comments WHERE post_id = ? ORDER BY created_at ASC, id ASC')
    .all(postId)
    .map(commentJson);
}

/**
 * Publicações no formato do app. Curtidas e comentários de todas as
 * publicações vêm em três consultas no total (e não três por publicação).
 */
function postsJson(rows, user) {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const marks = ids.map(() => '?').join(', ');

  const likes = new Map();
  for (const row of db
    .prepare(
      `SELECT post_id, COUNT(*) AS total, MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS mine
       FROM post_likes WHERE post_id IN (${marks}) GROUP BY post_id`,
    )
    .all(user.id, ...ids)) {
    likes.set(row.post_id, row);
  }

  const comments = new Map(ids.map((id) => [id, []]));
  for (const row of db
    .prepare(
      `SELECT * FROM post_comments WHERE post_id IN (${marks})
       ORDER BY created_at ASC, id ASC`,
    )
    .all(...ids)) {
    comments.get(row.post_id).push(commentJson(row));
  }

  return rows.map((row) => {
    const like = likes.get(row.id);
    return {
      id: row.id,
      authorName: row.author_name,
      authorInitials: row.author_initials,
      content: row.content,
      likes: int(row.base_likes) + (like ? like.total : 0),
      likedByMe: Boolean(like && like.mine),
      isMine: row.user_id === user.id,
      timeLabel: relativeTime(row.created_at),
      createdAt: row.created_at,
      comments: comments.get(row.id),
    };
  });
}

function listPosts(user) {
  const rows = db
    .prepare('SELECT * FROM posts ORDER BY created_at DESC, id DESC LIMIT 100')
    .all();
  return postsJson(rows, user);
}

function createPost(user, data) {
  const content = clean(data.content);
  if (content.length < 3) fail(400, 'Escreva uma mensagem com pelo menos 3 caracteres.');
  if (content.length > 1000) fail(400, 'A mensagem deve ter no máximo 1000 caracteres.');
  const info = db
    .prepare(
      `INSERT INTO posts (user_id, author_name, author_initials, content, base_likes, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
    )
    .run(user.id, user.name, user.initials, content, iso(clock.now()));
  return postsJson([findPost(info.lastInsertRowid)], user)[0];
}

function toggleLike(user, id) {
  const post = requirePost(id);
  const liked = db
    .prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?')
    .get(post.id, user.id);
  if (liked) {
    db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(post.id, user.id);
  } else {
    db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)').run(post.id, user.id);
  }
  const json = postsJson([post], user)[0];
  return { likes: json.likes, likedByMe: json.likedByMe };
}

function createComment(user, id, data) {
  const post = requirePost(id);
  const content = clean(data.content);
  if (!content) fail(400, 'Escreva um comentário.');
  if (content.length > 500) fail(400, 'O comentário deve ter no máximo 500 caracteres.');
  // Comentário e aviso ao autor juntos: se um falhar, nada é gravado.
  const commentId = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO post_comments (post_id, user_id, author_name, author_initials, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(post.id, user.id, user.name, user.initials, content, iso(clock.now()));
    if (post.user_id !== null && post.user_id !== user.id) {
      const owner = db.prepare('SELECT id FROM users WHERE id = ?').get(post.user_id);
      if (owner) {
        notify(owner.id, 'comunidade', 'Novo comentário', `${user.name} comentou na sua publicação.`, {
          target: '/comunidade',
        });
      }
    }
    return info.lastInsertRowid;
  })();
  return commentJson(db.prepare('SELECT * FROM post_comments WHERE id = ?').get(commentId));
}

function deletePost(user, id) {
  const post = requirePost(id);
  if (post.user_id !== user.id) fail(403, 'Você só pode excluir suas publicações.');
  db.transaction(() => {
    db.prepare('DELETE FROM post_comments WHERE post_id = ?').run(post.id);
    db.prepare('DELETE FROM post_likes WHERE post_id = ?').run(post.id);
    db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  })();
}

// ---------------------------------------------------------------------------
// Bairro: estatísticas, meta coletiva, ranking, mapa e pontos de coleta
// ---------------------------------------------------------------------------

/** Pontos de ações por pessoa na semana local que contém o instante. */
function weekPointsByUser(instant) {
  const map = new Map();
  for (const row of db
    .prepare(
      `SELECT user_id, SUM(points) AS points FROM action_records
       WHERE kind = 'action' AND local_date >= ? AND local_date <= ?
       GROUP BY user_id`,
    )
    .all(economy.weekStartKey(instant), economy.weekEndKey(instant))) {
    map.set(row.user_id, row.points);
  }
  return map;
}

function communityStats(user) {
  const now = clock.now();
  const today = economy.dateKey(now);
  const week = db
    .prepare(
      `SELECT COUNT(*) AS actions, COALESCE(SUM(liters), 0) AS liters,
              COALESCE(SUM(points), 0) AS points
       FROM action_records
       WHERE kind = 'action' AND local_date >= ? AND local_date <= ?`,
    )
    .get(economy.weekStartKey(now), economy.weekEndKey(now));
  const pointsByUser = weekPointsByUser(now);
  const activeNeighbors = db
    .prepare(
      `SELECT COUNT(DISTINCT user_id) AS total FROM action_records
       WHERE kind = 'action' AND local_date >= ?`,
    )
    .get(economy.shiftDateKey(today, -6)).total;

  const ranked = [...pointsByUser.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const top = ranked.slice(0, 5);
  const people = new Map();
  if (top.length > 0) {
    for (const person of db
      .prepare(
        `SELECT id, name, initials, neighborhood, privacy_location FROM users
         WHERE id IN (${top.map(() => '?').join(', ')})`,
      )
      .all(...top.map(([id]) => id))) {
      people.set(person.id, person);
    }
  }
  const ranking = top.map(([id, points], index) => {
    const person = people.get(id);
    const isMe = id === user.id;
    // O bairro de outra pessoa só aparece se ela aceitou aparecer no mapa.
    const showNeighborhood = isMe || flag(person?.privacy_location);
    return {
      position: index + 1,
      name: isMe ? String(user.name) : shortName(person?.name),
      initials: person?.initials ?? '?',
      neighborhood: showNeighborhood ? (person?.neighborhood ?? null) : null,
      points,
      isMe,
    };
  });
  const myIndex = ranked.findIndex(([id]) => id === user.id);

  let goal = null;
  const goalRow = db
    .prepare('SELECT * FROM community_goals WHERE active = 1 ORDER BY id LIMIT 1')
    .get();
  if (goalRow) {
    const target = Math.max(1, int(goalRow.target_actions, 1));
    const reset = economy.nextWeekReset(now);
    goal = {
      title: goalRow.title,
      description: goalRow.description,
      target,
      current: week.actions,
      progress: Math.min(week.actions / target, 1.0),
      reached: week.actions >= target,
      contributors: pointsByUser.size,
      daysLeft: Math.max(0, Math.ceil(Math.trunc((reset - now) / 60000) / 1440)),
      endsAt: iso(reset),
    };
  }

  return {
    city: user.city ?? places.DEFAULT_CITY,
    neighborhood: user.neighborhood,
    members: db.prepare('SELECT COUNT(*) AS total FROM users').get().total,
    activeNeighbors,
    actionsToday: db
      .prepare(`SELECT COUNT(*) AS total FROM action_records WHERE kind = 'action' AND local_date = ?`)
      .get(today).total,
    actionsThisWeek: week.actions,
    litersThisWeek: week.liters,
    pointsThisWeek: week.points,
    goal,
    ranking,
    myPosition: myIndex < 0 ? null : myIndex + 1,
    myWeeklyPoints: pointsByUser.get(user.id) || 0,
  };
}

function collectionPointJson(row, user) {
  const lat = row.lat ?? null;
  const lon = row.lon ?? null;
  const myLat = user.lat ?? null;
  const myLon = user.lon ?? null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    materials: JSON.parse(row.materials || '[]'),
    address: row.address,
    neighborhood: row.neighborhood,
    cep: row.cep,
    hours: row.hours,
    phone: row.phone,
    responsible: row.responsible,
    lat,
    lon,
    coordPrecision: row.coord_precision,
    sourceUrl: row.source_url,
    sourceDate: row.source_date,
    confidence: row.confidence,
    notes: row.notes,
    // Distância a partir da posição aproximada do usuário.
    distanceMeters:
      lat === null || lon === null || myLat === null || myLon === null
        ? null
        : places.distanceMeters(myLat, myLon, lat, lon),
  };
}

/** Pontos de coleta, do mais perto ao mais longe; filtros `type` e `search`. */
function listCollectionPoints(user, query = {}) {
  const type = String(query.type ?? '').toLowerCase();
  const search = places.normalize(query.search ?? '');
  const points = db
    .prepare('SELECT * FROM collection_points ORDER BY id')
    .all()
    .filter(
      (row) =>
        (!type || String(row.type).toLowerCase() === type) &&
        (!search ||
          places
            .normalize(`${row.name} ${row.address} ${row.neighborhood} ${row.materials}`)
            .includes(search)),
    )
    .map((row) => collectionPointJson(row, user));
  points.sort((a, b) => {
    const first = a.distanceMeters;
    const second = b.distanceMeters;
    if (first === null && second === null) {
      return a.name === b.name ? 0 : String(a.name) < String(b.name) ? -1 : 1;
    }
    if (first === null) return 1;
    if (second === null) return -1;
    return first - second;
  });
  return points;
}

function communityMap(user) {
  const pointsByUser = weekPointsByUser(clock.now());
  const myLat = user.lat ?? null;
  const myLon = user.lon ?? null;
  const neighbors = db
    .prepare(
      `SELECT id, name, initials, neighborhood, lat, lon FROM users
       WHERE id != ? AND privacy_location = 1 AND lat IS NOT NULL AND lon IS NOT NULL
       ORDER BY id`,
    )
    .all(user.id)
    .map((person) => ({
      id: person.id,
      name: shortName(person.name),
      initials: person.initials,
      neighborhood: person.neighborhood,
      lat: person.lat,
      lon: person.lon,
      weeklyPoints: pointsByUser.get(person.id) || 0,
    }));
  return {
    center: {
      lat: myLat ?? places.CITY_CENTER.lat,
      lon: myLon ?? places.CITY_CENTER.lon,
    },
    me:
      myLat === null || myLon === null
        ? null
        : {
            lat: myLat,
            lon: myLon,
            initials: user.initials,
            visible: flag(user.privacy_location),
          },
    // Só quem aceitou aparecer no mapa, sempre em posição aproximada.
    neighbors,
    points: listCollectionPoints(user).filter((point) => point.lat !== null && point.lon !== null),
    attribution: '© colaboradores do OpenStreetMap',
  };
}

/** Dica do dia: muda à meia-noite de Brasília, em rodízio pela tabela `tips`. */
function tipOfTheDay() {
  const tips = db.prepare('SELECT * FROM tips ORDER BY id').all();
  if (tips.length === 0) return null;
  const wall = economy.wallClock(clock.now());
  const dayOfYear = Math.floor(
    (wall.getTime() - Date.UTC(wall.getUTCFullYear(), 0, 1)) / economy.DAY_MS,
  );
  const tip = tips[dayOfYear % tips.length];
  return {
    id: tip.id,
    text: tip.text,
    categoryLabel: tip.category_label,
    icon: tip.icon,
  };
}

module.exports = {
  requirePost,
  commentsOf,
  listPosts,
  createPost,
  toggleLike,
  createComment,
  deletePost,
  communityStats,
  listCollectionPoints,
  communityMap,
  tipOfTheDay,
};
