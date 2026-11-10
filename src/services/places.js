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

/** Bairro com esse nome (ignorando acentos e maiúsculas), ou `null`. */
function findNeighborhood(name) {
  if (name === null || name === undefined || String(name).trim() === '') return null;
  const wanted = normalize(name);
  return NEIGHBORHOODS.find((item) => normalize(item.name) === wanted) || null;
}

/** Nomes de bairros que contêm o texto: primeiro os que começam com ele. */
function searchNeighborhoods(query, limit = 12) {
  const wanted = normalize(query);
  if (!wanted) return [];
  const starts = [];
  const contains = [];
  for (const item of NEIGHBORHOODS) {
    const name = normalize(item.name);
    if (name.startsWith(wanted)) starts.push(item.name);
    else if (name.includes(wanted)) contains.push(item.name);
  }
  return [...starts, ...contains].slice(0, limit);
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
 * Bairro desconhecido cai no centro da cidade, com deslocamento maior.
 */
function approximatePosition(neighborhood, key) {
  const found = findNeighborhood(neighborhood);
  const base = found ? { lat: found.lat, lon: found.lon } : CITY_CENTER;
  const spread = found ? JITTER : JITTER * 3;
  const hash = hashKey(key);
  const dLat = ((hash % 2001) / 1000.0 - 1) * spread;
  const dLon = ((Math.floor(hash / 2001) % 2001) / 1000.0 - 1) * spread;
  return {
    lat: Number((base.lat + dLat).toFixed(5)),
    lon: Number((base.lon + dLon).toFixed(5)),
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
  NEIGHBORHOODS,
  normalize,
  findNeighborhood,
  searchNeighborhoods,
  hashKey,
  approximatePosition,
  distanceMeters,
};
