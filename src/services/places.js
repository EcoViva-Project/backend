// Funções de lugar: bairros de São José do Rio Preto, posição aproximada de um
// morador e distância entre dois pontos.
//
// Espelha `eco-app/lib/core/local/places.dart` (mesmo hash, mesmo
// deslocamento e mesmo arredondamento), para a posição calculada pela API
// bater com a do modo local do app.
//
// A posição de uma pessoa nunca é o endereço dela: é o centro do bairro com um
// deslocamento fixo de algumas centenas de metros, calculado a partir de uma
// chave do usuário (o e-mail). Assim ela aparece no mapa na região certa, mas
// não na porta de casa.
//
// Bairros: `src/data/bairros-rio-preto.json`, do OpenStreetMap
// (© colaboradores do OpenStreetMap, licença ODbL).

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CITY = 'São José do Rio Preto';
const DEFAULT_STATE = 'SP';

/** Centro da cidade (bairro Centro, segundo o OpenStreetMap). */
const CITY_CENTER = { lat: -20.81085, lon: -49.37885 };

/** Deslocamento máximo aplicado à posição de uma pessoa, em graus (cerca de 350 m). */
const JITTER = 0.0032;

const NEIGHBORHOODS_FILE = path.join(__dirname, '..', 'data', 'bairros-rio-preto.json');

function loadNeighborhoods() {
  try {
    let text = fs.readFileSync(NEIGHBORHOODS_FILE, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const data = JSON.parse(text);
    return (data.bairros || [])
      .filter((item) => item && item.nome && Number.isFinite(item.lat) && Number.isFinite(item.lon))
      .map((item) => ({ name: item.nome, lat: item.lat, lon: item.lon }));
  } catch {
    return [];
  }
}

const NEIGHBORHOODS = loadNeighborhoods();

const ACCENTS = {
  'á': 'a', 'à': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a',
  'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
  'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
  'ó': 'o', 'ò': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o',
  'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
  'ç': 'c',
};

/** Minúsculas, sem acentos e sem espaços repetidos. */
function normalize(value) {
  let out = '';
  for (const char of String(value ?? '').toLowerCase().trim().split('')) {
    out += ACCENTS[char] ?? char;
  }
  return out.replace(/\s+/g, ' ');
}

/**
 * Área coberta pelo mapa-base do app (São José do Rio Preto), igual à de
 * `Places.mapArea` no app.
 */
const MAP_AREA = { south: -20.93, west: -49.5, north: -20.7, east: -49.28 };

/** Abreviações comuns em nomes de bairro ("Jd." é Jardim, "Vl" é Vila...). */
const ABBREVIATIONS = {
  jd: 'jardim',
  jdm: 'jardim',
  vl: 'vila',
  pq: 'parque',
  pqe: 'parque',
  res: 'residencial',
  resid: 'residencial',
  cj: 'conjunto',
  conj: 'conjunto',
  hab: 'habitacional',
  lot: 'loteamento',
  cond: 'condominio',
  sta: 'santa',
  sto: 'santo',
  nsa: 'nossa',
  sra: 'senhora',
  dr: 'doutor',
  prof: 'professor',
};

/** Palavras de ligação, ignoradas na comparação ("Bosque da Saúde"). */
const CONNECTIVES = new Set(['de', 'da', 'do', 'dos', 'das']);

/** Números romanos que aparecem nos nomes ("Vista Alegre II"). */
const ROMANS = { i: '1', ii: '2', iii: '3', iv: '4' };

/**
 * Palavras de um nome para comparação: sem acentos nem pontuação, com as
 * abreviações por extenso, romanos como números e sem "de/da/do/dos/das".
 */
function words(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word && !CONNECTIVES.has(word))
    .map((word) => ROMANS[word] ?? ABBREVIATIONS[word] ?? word);
}

/** Bairros com as palavras de comparação, montados uma vez. */
const INDEX = NEIGHBORHOODS.map((item) => {
  const itemWords = words(item.name);
  return { item, key: itemWords.join(' '), words: itemWords };
});

/** `a` e `b` diferem por no máximo uma letra (trocada, faltando ou sobrando). */
function withinOneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length > b.length) return withinOneEdit(b, a);
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length === b.length) i += 1;
    j += 1;
  }
  return edits + (b.length - j) + (a.length - i) <= 1;
}

/**
 * Cada palavra digitada está em `other`, com no máximo uma delas com uma letra
 * de diferença. Números precisam ser iguais.
 */
function closeWords(typed, other) {
  let typos = 0;
  for (const word of typed) {
    if (other.includes(word)) continue;
    if (word.length < 4 || /[0-9]/.test(word)) return false;
    const near = other.some((candidate) => candidate.length >= 4 && withinOneEdit(word, candidate));
    if (!near) return false;
    typos += 1;
    if (typos > 1) return false;
  }
  return typos === 1;
}

/**
 * Bairro com esse nome, ou `null`.
 *
 * Na ordem: nome igual (ignorando acentos e maiúsculas); igual depois de trocar
 * abreviações e ignorar pontuação e "de/da/do"; o único bairro que tem todas
 * as palavras digitadas; o único que bate com até uma letra trocada, faltando
 * ou sobrando. Se mais de um bairro serve, nenhum é escolhido. Mesma regra de
 * `Places.findNeighborhood` no app.
 */
function findNeighborhood(name) {
  if (name === null || name === undefined || String(name).trim() === '') return null;
  const wanted = normalize(name);
  const exact = NEIGHBORHOODS.find((item) => normalize(item.name) === wanted);
  if (exact) return exact;

  const typed = words(name);
  if (typed.length === 0) return null;
  const key = typed.join(' ');
  const only = (test) => {
    let found = null;
    for (const entry of INDEX) {
      if (!test(entry)) continue;
      if (found) return null; // mais de um: ambíguo
      found = entry.item;
    }
    return found;
  };

  const same = only((entry) => entry.key === key);
  if (same) return same;
  // Texto curto demais ("2", "Sul") casaria com qualquer coisa.
  if (key.replace(/ /g, '').length < 4) return null;
  const contained = only((entry) => typed.every((word) => entry.words.includes(word)));
  if (contained) return contained;
  return only((entry) => closeWords(typed, entry.words));
}

/**
 * Nomes de bairros que contêm o texto: primeiro os que começam com ele.
 * Também acha pelo nome abreviado ("Jd Nazar" sugere Jardim Nazareth).
 */
function searchNeighborhoods(query, limit = 12) {
  const wanted = normalize(query);
  if (!wanted) return [];
  const key = words(query).join(' ');
  const starts = [];
  const contains = [];
  const byKey = [];
  for (const entry of INDEX) {
    const name = normalize(entry.item.name);
    if (name.startsWith(wanted)) starts.push(entry.item.name);
    else if (name.includes(wanted)) contains.push(entry.item.name);
    else if (key && entry.key.includes(key)) byKey.push(entry.item.name);
  }
  return [...starts, ...contains, ...byKey].slice(0, limit);
}

/**
 * Hash FNV-1a de 31 bits sobre as unidades UTF-16 da chave.
 * No Dart a multiplicação é feita em 64 bits e depois cortada para 31; os 31
 * bits de baixo de um produto só dependem dos 31 bits de baixo dos fatores,
 * então `Math.imul` (32 bits) dá o mesmo resultado.
 */
function hashKey(key) {
  let hash = 0x811c9dc5;
  const text = String(key);
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) & 0x7fffffff;
  }
  return hash;
}

/**
 * Posição aproximada de um morador do bairro.
 * Bairro que não está na lista dá `null`: a pessoa fica sem posição (não
 * aparece para os vizinhos) em vez de cair, sem aviso, no centro da cidade.
 */
function approximatePosition(neighborhood, key) {
  const found = findNeighborhood(neighborhood);
  if (!found) return null;
  const hash = hashKey(key);
  const dLat = ((hash % 2001) / 1000.0 - 1) * JITTER;
  const dLon = ((Math.floor(hash / 2001) % 2001) / 1000.0 - 1) * JITTER;
  return {
    lat: Number((found.lat + dLat).toFixed(5)),
    lon: Number((found.lon + dLon).toFixed(5)),
  };
}

/** Distância em metros entre dois pontos (fórmula de haversine). */
function distanceMeters(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371000.0;
  const rad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

module.exports = {
  DEFAULT_CITY,
  DEFAULT_STATE,
  CITY_CENTER,
  MAP_AREA,
  NEIGHBORHOODS,
  normalize,
  findNeighborhood,
  searchNeighborhoods,
  hashKey,
  approximatePosition,
  distanceMeters,
};
