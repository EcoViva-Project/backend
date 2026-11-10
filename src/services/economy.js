// Regras da economia de pontos do EcoViva.
//
// Este arquivo é a fonte única das regras na API e espelha
// `eco-app/lib/core/local/economy.dart`. O raciocínio por trás de cada número
// está em `ECONOMIA-DE-PONTOS.md` (pasta acima dos dois repositórios).

const config = require('../config');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Teto semanal de pontos ganhos com ações do dia a dia.
 *
 * Bônus de desafio concluído e de conquista são prêmios únicos e não entram
 * no teto. Configurável por `WEEKLY_POINTS_CAP`.
 */
const WEEKLY_CAP = config.weeklyPointsCap;

/** Referência de preço dos cupons: quantos pontos valem R$ 1 de benefício. */
const POINTS_PER_REAL = 50;

/** Horário de Brasília (sem horário de verão desde 2019). */
const UTC_OFFSET_HOURS = -3;
const UTC_OFFSET_MS = UTC_OFFSET_HOURS * HOUR_MS;

const LEVELS = [
  { floor: 0, name: 'Semente' },
  { floor: 300, name: 'Broto' },
  { floor: 1000, name: 'Muda' },
  { floor: 2500, name: 'Árvore' },
  { floor: 6000, name: 'Floresta' },
];

const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/**
 * Nível correspondente aos pontos ganhos.
 * `number` vai de 1 a 5; `next` é `null` no último nível.
 */
function levelFor(pointsEarned) {
  let index = 0;
  for (let i = 0; i < LEVELS.length; i += 1) {
    if (pointsEarned >= LEVELS[i].floor) index = i;
  }
  const number = index + 1;
  const { name, floor } = LEVELS[index];
  return {
    number,
    name,
    floor,
    next: index + 1 < LEVELS.length ? LEVELS[index + 1].floor : null,
    label: `${name} • Nível ${number}`,
  };
}

function toMs(instant) {
  const ms = instant instanceof Date ? instant.getTime() : new Date(instant).getTime();
  if (Number.isNaN(ms)) throw new Error(`Instante inválido: ${instant}`);
  return ms;
}

/** Relógio de parede de Brasília, representado como `Date` em UTC. */
function wallClock(instant) {
  return new Date(toMs(instant) + UTC_OFFSET_MS);
}

/** Converte um relógio de parede de Brasília de volta para o instante real. */
function instantFromWall(wall) {
  return new Date(toMs(wall) - UTC_OFFSET_MS);
}

function two(value) {
  return String(value).padStart(2, '0');
}

function keyOf(wall) {
  return `${String(wall.getUTCFullYear()).padStart(4, '0')}-${two(wall.getUTCMonth() + 1)}-${two(wall.getUTCDate())}`;
}

/** Dia local (Brasília) no formato `AAAA-MM-DD`. */
function dateKey(instant) {
  return keyOf(wallClock(instant));
}

/** Mês local no formato `AAAA-MM`. */
function monthKey(instant) {
  return dateKey(instant).slice(0, 7);
}

/** Dia da semana local: 1 = segunda-feira … 7 = domingo. */
function weekday(instant) {
  return ((wallClock(instant).getUTCDay() + 6) % 7) + 1;
}

function weekStartWall(instant) {
  const wall = wallClock(instant);
  const midnight = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
  return new Date(midnight - (weekday(instant) - 1) * DAY_MS);
}

/** Segunda-feira da semana local, no formato `AAAA-MM-DD`. */
function weekStartKey(instant) {
  return keyOf(weekStartWall(instant));
}

/** Domingo da semana local, no formato `AAAA-MM-DD`. */
function weekEndKey(instant) {
  return keyOf(new Date(weekStartWall(instant).getTime() + 6 * DAY_MS));
}

/** Instante em que o teto semanal zera: próxima segunda, 00:00 de Brasília. */
function nextWeekReset(instant) {
  return instantFromWall(new Date(weekStartWall(instant).getTime() + 7 * DAY_MS));
}

/** Início (00:00 de Brasília) do dia local que contém o instante. */
function startOfLocalDay(instant) {
  const wall = wallClock(instant);
  return instantFromWall(
    new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate())),
  );
}

/** Dia local deslocado em `days` dias, no formato `AAAA-MM-DD`. */
function shiftDateKey(key, days) {
  const [year, month, day] = key.split('-').map(Number);
  return keyOf(new Date(Date.UTC(year, month - 1, day) + days * DAY_MS));
}

/** "9 de novembro". */
function longDate(instant) {
  const wall = wallClock(instant);
  return `${wall.getUTCDate()} de ${MONTH_NAMES[wall.getUTCMonth()]}`;
}

/** "09/11/2026". */
function shortDate(instant) {
  const wall = wallClock(instant);
  return `${two(wall.getUTCDate())}/${two(wall.getUTCMonth() + 1)}/${wall.getUTCFullYear()}`;
}

module.exports = {
  WEEKLY_CAP,
  POINTS_PER_REAL,
  UTC_OFFSET_HOURS,
  HOUR_MS,
  DAY_MS,
  LEVELS,
  MONTH_NAMES,
  levelFor,
  wallClock,
  instantFromWall,
  dateKey,
  monthKey,
  weekday,
  weekStartKey,
  weekEndKey,
  nextWeekReset,
  startOfLocalDay,
  shiftDateKey,
  longDate,
  shortDate,
};
