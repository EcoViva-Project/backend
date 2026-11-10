// Notificações do usuário.

const db = require('../db');
const clock = require('./clock');
const { iso, flag, relativeTime } = require('./util');

/**
 * Cria uma notificação. `target` é a tela do app aberta ao tocar nela;
 * `at` e `read` existem para a carga dos dados de demonstração.
 */
function notify(userId, category, title, message, { target = null, at = null, read = false } = {}) {
  db.prepare(
    `INSERT INTO notifications (user_id, category, title, message, target, read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, category, title, message, target, read ? 1 : 0, iso(at ?? clock.now()));
}

function notificationJson(row) {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    message: row.message,
    target: row.target ?? null,
    read: flag(row.read),
    timeLabel: relativeTime(row.created_at),
    createdAt: row.created_at,
  };
}

/** As 100 mais recentes e o total de não lidas (de todas, não só das 100). */
function listNotifications(userId) {
  const rows = db
    .prepare(
      `SELECT * FROM notifications WHERE user_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 100`,
    )
    .all(userId);
  const unread = db
    .prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND read = 0')
    .get(userId).total;
  return { notifications: rows.map(notificationJson), unreadCount: unread };
}

module.exports = { notify, notificationJson, listNotifications };
