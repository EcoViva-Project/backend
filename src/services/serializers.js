const db = require('../db');

function parseFlags(row) {
  return {
    notificationsEnabled: Boolean(row.notifications_enabled),
    remindersEnabled: Boolean(row.reminders_enabled),
    privacyProfile: Boolean(row.privacy_profile),
    privacyLocation: Boolean(row.privacy_location),
  };
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    neighborhood: user.neighborhood,
    initials: user.initials,
    memberSince: user.created_at,
    monthlyGoal: user.monthly_goal,
    weeklyGoal: user.weekly_goal,
    preferences: parseFlags(user),
  };
}

function actionFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    categoryLabel: row.category_label,
    icon: row.icon,
    points: row.points,
    liters: row.liters,
    info: row.info,
    infoIcon: row.info_icon,
    tags: JSON.parse(row.tags || '[]'),
    footerInfo: row.footer_info,
    footerIcon: row.footer_icon,
  };
}

function recordFromRow(row) {
  return {
    id: row.id,
    actionId: row.action_id,
    title: row.title,
    categoryLabel: row.category_label,
    icon: row.icon,
    points: row.points,
    liters: row.liters,
    quantity: row.quantity,
    notes: row.notes,
    dateTime: row.created_at,
  };
}

function relativeTime(iso) {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  if (Number.isNaN(diffMs)) return '';
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Agora';
  if (minutes < 60) return `Há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Há ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Ontem';
  if (days < 7) return `Há ${days} dias`;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function notificationFromRow(row) {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    message: row.message,
    read: Boolean(row.read),
    timeLabel: relativeTime(row.created_at),
    createdAt: row.created_at,
  };
}

function challengeFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    icon: row.icon,
    targetSteps: row.target_steps,
    pointsReward: row.points_reward,
    participants: row.participants,
    daysLeft: row.days_left,
    isWeekly: Boolean(row.is_weekly),
    joined: Boolean(row.joined || 0),
    completedSteps: row.completed_steps || 0,
    completed: Boolean(row.completed || 0),
    progress: Math.min((row.completed_steps || 0) / row.target_steps, 1),
  };
}

function rewardFromRow(row) {
  return {
    id: row.id,
    partnerId: row.partner_id,
    partnerName: row.partner_name || '',
    partnerDescription: row.partner_description || null,
    partnerIcon: row.partner_icon || 'storefront',
    title: row.title,
    description: row.description,
    category: row.category,
    categoryLabel: row.category_label,
    icon: row.icon,
    pointsCost: row.points_cost,
    stock: row.stock,
    terms: row.terms,
    isFeatured: Boolean(row.is_featured),
    available: row.stock > 0,
    createdAt: row.created_at,
  };
}

function redemptionFromRow(row) {
  return {
    id: row.id,
    rewardId: row.reward_id,
    rewardTitle: row.reward_title || '',
    partnerName: row.partner_name || '',
    icon: row.reward_icon || 'redeem',
    code: row.code,
    pointsSpent: row.points_spent,
    status: row.status,
    dateTime: row.created_at,
  };
}

function commentFromRow(row) {
  return {
    id: row.id,
    authorName: row.author_name,
    authorInitials: row.author_initials,
    content: row.content,
    timeLabel: relativeTime(row.created_at),
    createdAt: row.created_at,
  };
}

function postFromRow(row, currentUserId) {
  const comments = db
    .prepare('SELECT * FROM post_comments WHERE post_id = ? ORDER BY created_at ASC')
    .all(row.id)
    .map(commentFromRow);
  const extraLikes = db
    .prepare('SELECT COUNT(*) AS total FROM post_likes WHERE post_id = ?')
    .get(row.id).total;
  const likedByMe = Boolean(
    db
      .prepare('SELECT 1 AS liked FROM post_likes WHERE post_id = ? AND user_id = ?')
      .get(row.id, currentUserId),
  );

  return {
    id: row.id,
    authorName: row.author_name,
    authorInitials: row.author_initials,
    content: row.content,
    likes: row.base_likes + extraLikes,
    likedByMe,
    timeLabel: relativeTime(row.created_at),
    createdAt: row.created_at,
    comments,
  };
}

function createNotification(userId, category, title, message) {
  db.prepare(
    `INSERT INTO notifications (user_id, category, title, message, read, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  ).run(userId, category, title, message, new Date().toISOString());
}

module.exports = {
  publicUser,
  actionFromRow,
  recordFromRow,
  notificationFromRow,
  challengeFromRow,
  rewardFromRow,
  redemptionFromRow,
  commentFromRow,
  postFromRow,
  createNotification,
  relativeTime,
};
