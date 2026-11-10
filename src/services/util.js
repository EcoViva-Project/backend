// Pequenos utilitários usados pelos serviços (mesmos nomes de `local_api.dart`).

const clock = require('./clock');
const economy = require('./economy');

/** Instante como texto ISO 8601 em UTC. */
function iso(instant) {
  return new Date(instant instanceof Date ? instant.getTime() : instant).toISOString();
}

/** Inteiro a partir de um valor do banco (com valor padrão). */
function int(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Coluna 0/1 do SQLite como booleano. */
function flag(value) {
  return value === 1 || value === true;
}

/** Texto aparado; qualquer outro tipo vira texto vazio. */
function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Data ISO para `Date`, ou `null` se não der para ler. */
function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Minutos inteiros entre dois instantes (truncado, como `Duration.inMinutes`). */
function minutesBetween(from, to) {
  return Math.trunc((to.getTime() - from.getTime()) / 60000);
}

/** Texto como "Há 10 min", relativo ao relógio da aplicação. */
function relativeTime(value) {
  const date = parseDate(value);
  if (!date) return '';
  const minutes = minutesBetween(date, clock.now());
  if (minutes < 1) return 'Agora';
  if (minutes < 60) return `Há ${minutes} min`;
  const hours = Math.trunc(minutes / 60);
  if (hours < 24) return `Há ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  const days = Math.trunc(hours / 24);
  if (days === 1) return 'Ontem';
  if (days < 7) return `Há ${days} dias`;
  return economy.longDate(date);
}

/** "Marina L.": primeiro nome e inicial do último, para listas públicas. */
function shortName(fullName) {
  const parts = String(fullName ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** Iniciais para o avatar: "Ana Silva" → "AS"; "Ana" → "AN". */
function initialsFor(name) {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'EC';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Ordem "mais recente primeiro": data decrescente e, no empate, id decrescente. */
function newestFirst(a, b) {
  const first = String(a.created_at);
  const second = String(b.created_at);
  if (first !== second) return second > first ? 1 : -1;
  return int(b.id) - int(a.id);
}

module.exports = {
  iso,
  int,
  flag,
  clean,
  parseDate,
  minutesBetween,
  relativeTime,
  shortName,
  initialsFor,
  newestFirst,
};
