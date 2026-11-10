// Dados de demonstração da API.
//
// Espelha `eco-app/lib/core/local/local_seed.dart`: mesmo catálogo, mesmos
// parceiros e cupons, a conta Clara Mendes e 18 vizinhos fictícios em bairros
// reais de São José do Rio Preto. O histórico é gerado passando pelas MESMAS
// funções de regra usadas pelas rotas (limites por ação, teto semanal,
// desafios e conquistas), sempre relativo ao momento da carga. Com o mesmo
// instante, os números batem com os do modo local do app.
//
// Uso: `npm run seed` (apaga e recria os dados). Com NODE_ENV=production a
// carga é recusada, a não ser com `npm run seed -- --force`.

const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const config = require('./config');
const clock = require('./services/clock');
const economy = require('./services/economy');
const { ApiError } = require('./services/errors');
const { notify } = require('./services/notifications');
const { createUser } = require('./services/users');
const { weekActionPoints } = require('./services/progress');
const { registerAction } = require('./services/actions');
const { joinChallenge } = require('./services/challenges');
const { redeemReward, markRedemptionUsed } = require('./services/rewards');
const { iso } = require('./services/util');

const DEMO_EMAIL = 'clara@eco.app';
const DEMO_PASSWORD = 'eco1234';

/** Código de conferência usado por todos os parceiros de demonstração. */
const DEMO_PARTNER_PIN = '1234';

/**
 * Quantos pontos ficam livres abaixo do teto na semana atual, para a
 * apresentação conseguir mostrar o teto sendo atingido.
 */
const ROOM_BELOW_CAP = 25;

/** Meta coletiva: ações registradas por toda a comunidade na semana. */
const WEEKLY_GOAL_TARGET = 400;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ACTIONS = [
  {
    title: 'Fechar a torneira ao escovar os dentes',
    description: 'Economia estimada de 12 litros de água por escovação.',
    category: 'agua',
    category_label: 'Água',
    icon: 'water_drop',
    points: 5,
    liters: 12,
    daily_limit: 2,
    weekly_limit: null,
    info: 'Hábito diário',
    info_icon: 'schedule',
    tags: ['agua', 'torneira', 'dentes', 'banho'],
    footer_info: 'Cerca de 12 L poupados por vez',
    footer_icon: 'water_drop_outlined',
  },
  {
    title: 'Separar resíduos secos e orgânicos',
    description: 'Destino correto de plástico, papel, vidro e metal.',
    category: 'reciclagem',
    category_label: 'Reciclagem',
    icon: 'recycling',
    points: 15,
    liters: 0,
    daily_limit: 1,
    weekly_limit: null,
    info: 'Coleta seletiva',
    info_icon: 'recycling',
    tags: ['reciclagem', 'lixo', 'residuos', 'secos', 'organicos'],
    footer_info: 'Evita cerca de 0,8 kg de CO₂ equivalente',
    footer_icon: 'eco',
  },
  {
    title: 'Deslocamento a pé ou de bicicleta',
    description: 'Trajeto de até 5 km sem emissões diretas de carbono.',
    category: 'transporte',
    category_label: 'Transporte',
    icon: 'directions_bike',
    points: 30,
    liters: 0,
    daily_limit: 2,
    weekly_limit: null,
    info: 'Saúde e ar limpo',
    info_icon: 'favorite',
    tags: ['transporte', 'bicicleta', 'bike', 'caminhada', 'pe', 'mobilidade'],
    footer_info: 'Cada trajeto conta uma vez',
    footer_icon: 'route',
  },
  {
    title: 'Compostagem de resíduos orgânicos',
    description: 'Cascas, borra de café e restos vegetais viram adubo.',
    category: 'alimentacao',
    category_label: 'Alimentação',
    icon: 'compost',
    points: 25,
    liters: 0,
    daily_limit: 1,
    weekly_limit: null,
    info: 'Nutrientes de volta ao solo',
    info_icon: 'yard',
    tags: ['alimentacao', 'compostagem', 'comida', 'horta', 'adubo'],
    footer_info: 'Reduz até 45% do lixo doméstico',
    footer_icon: 'check_circle',
  },
  {
    title: 'Apagar luzes em cômodos vazios',
    description: 'Eficiência energética e menos consumo no mês.',
    category: 'energia',
    category_label: 'Energia',
    icon: 'lightbulb_outline',
    points: 5,
    liters: 0,
    daily_limit: 1,
    weekly_limit: null,
    info: 'Consumo consciente',
    info_icon: 'bolt',
    tags: ['energia', 'luz', 'comodo', 'eletricidade', 'lampada'],
    footer_info: 'Até 10% de alívio na conta de luz',
    footer_icon: 'savings',
  },
  {
    title: 'Mutirão de limpeza de praça pública',
    description: 'Cuidado com canteiros, descarte e áreas comuns do bairro.',
    category: 'publico',
    category_label: 'Espaços Públicos',
    icon: 'park',
    points: 100,
    liters: 0,
    daily_limit: null,
    weekly_limit: 1,
    info: 'Ação coletiva',
    info_icon: 'diversity_1',
    tags: ['publico', 'praca', 'parque', 'mutirao', 'comunidade', 'limpeza'],
    footer_info: 'Cerca de 2 horas de trabalho em grupo',
    footer_icon: 'groups',
  },
];

const CHALLENGES = [
  {
    title: 'Semana sem desperdício de água',
    description: 'Registre pelo menos uma ação de Água por dia, durante 7 dias.',
    category: 'Água',
    icon: 'water_drop',
    target_steps: 7,
    step_mode: 'days',
    points_reward: 100,
    base_participants: 0,
    duration_days: 7,
    is_weekly: 1,
  },
  {
    title: 'Transporte ativo no bairro',
    description: 'Faça 5 trajetos curtos a pé ou de bicicleta em até 7 dias.',
    category: 'Transporte',
    icon: 'directions_bike',
    target_steps: 5,
    step_mode: 'actions',
    points_reward: 100,
    base_participants: 0,
    duration_days: 7,
    is_weekly: 1,
  },
  {
    title: 'Mutirão da praça central',
    description: 'Participe de um mutirão de limpeza ou plantio na praça do bairro.',
    category: 'Espaços Públicos',
    icon: 'park',
    target_steps: 1,
    step_mode: 'actions',
    points_reward: 60,
    base_participants: 0,
    duration_days: 14,
    is_weekly: 0,
  },
  {
    title: 'Desafio da compostagem',
    description: 'Registre a compostagem em 10 dias diferentes, em até 14 dias.',
    category: 'Alimentação',
    icon: 'compost',
    target_steps: 10,
    step_mode: 'days',
    points_reward: 150,
    base_participants: 0,
    duration_days: 14,
    is_weekly: 0,
  },
];

const PARTNERS = [
  {
    name: 'Restaurante Sabor da Terra',
    description: 'Cozinha caseira com ingredientes de produtores do bairro.',
    logo_icon: 'restaurant',
    address: 'Rua do Mercado, 210',
  },
  {
    name: 'Café Raízes',
    description: 'Cafeteria de bairro com grãos de produtores locais.',
    logo_icon: 'local_cafe',
    address: 'Praça Central, 45',
  },
  {
    name: 'Mercado Verde',
    description: 'Mercearia sustentável com produtos a granel e orgânicos.',
    logo_icon: 'storefront',
    address: 'Rua das Acácias, 120',
  },
  {
    name: 'Bike Urbana',
    description: 'Oficina e loja de bicicletas para mobilidade ativa.',
    logo_icon: 'directions_bike',
    address: 'Avenida dos Ipês, 800',
  },
  {
    name: 'Floresta Games',
    description: 'Estúdio de jogos com temáticas ambientais.',
    logo_icon: 'sports_esports',
    address: 'Loja virtual',
  },
  {
    name: 'EcoClean Serviços',
    description: 'Limpeza ecológica residencial com produtos biodegradáveis.',
    logo_icon: 'cleaning_services',
    address: 'Atendimento em domicílio',
  },
];

/**
 * Preço dos cupons: valor do benefício em reais × 50 pontos.
 * Itens digitais têm 20% de desconto, porque não têm custo por unidade.
 */
const REWARDS = [
  {
    partner: 'Restaurante Sabor da Terra',
    title: '20% de desconto no almoço executivo',
    description: 'Desconto de 20% em um almoço executivo, de segunda a sexta.',
    category: 'desconto',
    category_label: 'Desconto',
    icon: 'percent',
    value_cents: 700,
    points_cost: 350,
    stock: 80,
    terms: 'Um cupom por mesa. Não vale em feriados.',
    validity_days: 30,
    per_user_limit: 2,
    is_featured: 1,
  },
  {
    partner: 'Restaurante Sabor da Terra',
    title: 'Sobremesa da casa grátis',
    description: 'Uma sobremesa da casa no almoço ou no jantar.',
    category: 'gastronomia',
    category_label: 'Gastronomia',
    icon: 'restaurant',
    value_cents: 1200,
    points_cost: 600,
    stock: 40,
    terms: 'Válido com o pedido de um prato principal.',
    validity_days: 30,
    per_user_limit: 2,
    is_featured: 0,
  },
  {
    partner: 'Restaurante Sabor da Terra',
    title: 'Prato do dia vegetariano grátis',
    description: 'Um prato do dia vegetariano, com ingredientes da estação.',
    category: 'gastronomia',
    category_label: 'Gastronomia',
    icon: 'restaurant',
    value_cents: 3200,
    points_cost: 1600,
    stock: 20,
    terms: 'Válido no almoço, de segunda a sábado.',
    validity_days: 30,
    per_user_limit: 1,
    is_featured: 1,
  },
  {
    partner: 'Café Raízes',
    title: '15% de desconto no combo',
    description: 'Desconto em qualquer combo de café com pão artesanal.',
    category: 'desconto',
    category_label: 'Desconto',
    icon: 'percent',
    value_cents: 400,
    points_cost: 200,
    stock: 100,
    terms: 'Não cumulativo com outras promoções.',
    validity_days: 30,
    per_user_limit: 2,
    is_featured: 0,
  },
  {
    partner: 'Café Raízes',
    title: 'Café especial grátis',
    description: 'Um café coado especial de 200 ml na unidade do bairro.',
    category: 'gastronomia',
    category_label: 'Gastronomia',
    icon: 'local_cafe',
    value_cents: 900,
    points_cost: 450,
    stock: 60,
    terms: 'Válido de segunda a sexta, das 8h às 17h.',
    validity_days: 30,
    per_user_limit: 2,
    is_featured: 0,
  },
  {
    partner: 'Mercado Verde',
    title: 'Kit de sacolas reutilizáveis',
    description: 'Três sacolas de algodão orgânico para as compras do dia a dia.',
    category: 'produto',
    category_label: 'Produto',
    icon: 'shopping_bag',
    value_cents: 3000,
    points_cost: 1500,
    stock: 25,
    terms: 'Retire na loja dentro da validade do cupom.',
    validity_days: 30,
    per_user_limit: 1,
    is_featured: 1,
  },
  {
    partner: 'Mercado Verde',
    title: 'Cesta de hortifrúti orgânico',
    description: 'Seleção de frutas e verduras cultivadas por produtores locais.',
    category: 'produto',
    category_label: 'Produto',
    icon: 'eco',
    value_cents: 6000,
    points_cost: 3000,
    stock: 10,
    terms: 'Retirada agendada. Sujeito à disponibilidade da safra.',
    validity_days: 30,
    per_user_limit: 1,
    is_featured: 0,
  },
  {
    partner: 'Floresta Games',
    title: 'Skin Guardião da Floresta',
    description: 'Pacote de cosméticos digitais do jogo Floresta Viva.',
    category: 'jogo',
    category_label: 'Jogo',
    icon: 'sports_esports',
    value_cents: 2000,
    points_cost: 800,
    stock: 40,
    terms: 'Código de uso único, vinculado à sua conta no jogo.',
    validity_days: 60,
    per_user_limit: 1,
    is_featured: 0,
  },
  {
    partner: 'Floresta Games',
    title: 'Passe de temporada Floresta Viva',
    description: 'Passe de temporada com missões e recompensas temáticas.',
    category: 'jogo',
    category_label: 'Jogo',
    icon: 'sports_esports',
    value_cents: 4000,
    points_cost: 1600,
    stock: 5,
    terms: 'Código de uso único, vinculado à sua conta no jogo.',
    validity_days: 60,
    per_user_limit: 1,
    is_featured: 0,
  },
  {
    partner: 'Bike Urbana',
    title: 'Revisão básica de bicicleta',
    description: 'Ajuste de freios, transmissão e calibragem dos pneus.',
    category: 'servico',
    category_label: 'Serviço',
    icon: 'directions_bike',
    value_cents: 6000,
    points_cost: 3000,
    stock: 12,
    terms: 'Peças não inclusas. Agende pelo telefone da oficina.',
    validity_days: 45,
    per_user_limit: 1,
    is_featured: 0,
  },
  {
    partner: 'Bike Urbana',
    title: 'Camisa oficial EcoViva',
    description: 'Camisa de algodão reciclado das pedaladas comunitárias.',
    category: 'produto',
    category_label: 'Produto',
    icon: 'checkroom',
    value_cents: 5000,
    points_cost: 2500,
    stock: 0,
    terms: 'Tamanhos sujeitos ao estoque disponível.',
    validity_days: 30,
    per_user_limit: 1,
    is_featured: 0,
  },
  {
    partner: 'EcoClean Serviços',
    title: 'Limpeza ecológica residencial',
    description: 'Duas horas de limpeza com produtos biodegradáveis.',
    category: 'servico',
    category_label: 'Serviço',
    icon: 'cleaning_services',
    value_cents: 16000,
    points_cost: 8000,
    stock: 8,
    terms: 'Agendamento com antecedência mínima de 3 dias.',
    validity_days: 60,
    per_user_limit: 1,
    is_featured: 0,
  },
];

const TIPS = [
  ['Aproveite a água do enxágue de frutas e verduras para regar as plantas.', 'Água', 'water_drop'],
  [
    'Lave as embalagens antes de separar para a reciclagem: material limpo vale mais para a cooperativa.',
    'Reciclagem',
    'recycling',
  ],
  [
    'Trajetos de até 2 km costumam ser mais rápidos a pé ou de bicicleta do que procurando vaga.',
    'Transporte',
    'directions_bike',
  ],
  [
    'Cascas de frutas, borra de café e folhas secas são a base de uma boa composteira.',
    'Alimentação',
    'compost',
  ],
  [
    'Tire da tomada os aparelhos que ficam em espera: eles consomem energia mesmo desligados.',
    'Energia',
    'bolt',
  ],
  [
    'Leve uma sacola extra na caminhada e recolha o que encontrar pelo caminho.',
    'Espaços Públicos',
    'park',
  ],
  ['Um banho de 5 minutos gasta cerca de um terço da água de um banho de 15.', 'Água', 'water_drop'],
  [
    'Óleo de cozinha usado não vai na pia: guarde em uma garrafa e leve a um ponto de coleta.',
    'Reciclagem',
    'recycling',
  ],
  [
    'Combine carona com quem faz o mesmo trajeto: um carro a menos na rua todos os dias.',
    'Transporte',
    'groups',
  ],
  [
    'Planeje as refeições da semana antes de ir ao mercado e evite jogar comida fora.',
    'Alimentação',
    'eco',
  ],
  [
    'Aproveite a luz natural: abrir a cortina de manhã adia a hora de acender a lâmpada.',
    'Energia',
    'lightbulb_outline',
  ],
  [
    'Pilhas, baterias e lâmpadas têm ponto de coleta próprio: nunca vão no lixo comum.',
    'Reciclagem',
    'recycling',
  ],
  [
    'Adote um canteiro ou uma árvore da sua rua: regar uma vez por semana já ajuda.',
    'Espaços Públicos',
    'park',
  ],
  [
    'Feche a torneira ao ensaboar a louça e economize dezenas de litros por lavagem.',
    'Água',
    'water_drop',
  ],
].map(([text, category_label, icon]) => ({ text, category_label, icon }));

/**
 * Moradores fictícios da demonstração, em bairros reais de Rio Preto.
 * O terceiro valor é o ritmo: 1 = casual, 2 = regular, 3 = dedicado.
 */
const NEIGHBORS = [
  ['Marina Lopes', 'Vila Redentora', 3],
  ['Rafael Souza', 'Higienópolis', 2],
  ['João Ferreira', 'Jardim Alto Rio Preto', 2],
  ['Beatriz Nunes', 'Vila Imperial', 3],
  ['Carlos Eduardo Lima', 'Eldorado', 1],
  ['Fernanda Rocha', 'Solo Sagrado', 2],
  ['Gustavo Almeida', 'Jardim Nazareth', 1],
  ['Helena Barros', 'Vila Maceno', 2],
  ['Igor Santana', 'Jardim Yolanda', 1],
  ['Juliana Prado', 'Vila Anchieta', 3],
  ['Lucas Teixeira', 'Jardim Canaã', 2],
  ['Mariana Costa', 'Jardim Soraia', 1],
  ['Nelson Ribeiro', 'Parque Industrial', 2],
  ['Olívia Martins', 'Vila Ercília', 2],
  ['Paulo Henrique Dias', 'São Francisco', 1],
  ['Renata Cardoso', 'Vila Toninho', 2],
  ['Sérgio Moura', 'Jardim Vetorasso', 1],
  ['Tatiane Freitas', 'Centro', 3],
];

const COLLECTION_POINTS_FILE = path.join(__dirname, 'data', 'pontos-de-coleta-rio-preto.json');

/** Texto do JSON de pontos de coleta (vazio vira `null`, como no gerador do app). */
function text(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).replace(/[\n\r]/g, ' ');
}

function number(value) {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
}

/**
 * Observações para mostrar ao usuário: ficam as frases sobre o uso do ponto e
 * saem as anotações de método do levantamento (origem da coordenada, fontes).
 * Mesma regra de `eco-app/tool/gerar_dados_locais.js`; a observação completa
 * continua no arquivo JSON.
 */
function publicNotes(value) {
  if (!value) return null;
  const method =
    /(coordenad|openstreetmap|\bosm\b|google|mapa oficial|pol[ií]gono|geocod|confere|fonte|lista[s]? da prefeitura|nominatim|precis[aã]o|levantamento|consta n|posi[cç][aã]o na via|interpola|listado em|nome conforme|n[aã]o cita|logmed|green eletron|reciclus|tamb[eé]m lista)/i;
  // Abreviações ("Av.", "R.") não encerram frase.
  const guarded = String(value).replace(
    /\b(Av|R|Dr|Dra|Prof|Jd|Pq|Vl|Sto|Sta|S|Cel|Cap|Gal|Eng|Pe|n|nº|tel)\.(\s)/gi,
    '$1§$2',
  );
  const kept = guarded
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !method.test(sentence));
  return kept.join(' ').replace(/§/g, '.').replace(/[\n\r]/g, ' ').trim() || null;
}

/** Pontos de coleta de `src/data/pontos-de-coleta-rio-preto.json` (vazio se não existir). */
function loadCollectionPoints() {
  if (!fs.existsSync(COLLECTION_POINTS_FILE)) return [];
  let raw = fs.readFileSync(COLLECTION_POINTS_FILE, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const data = JSON.parse(raw);
  const list = Array.isArray(data) ? data : (data && (data.pontos || data.points)) || [];
  return list
    .filter((point) => point && point.nome)
    .map((point) => {
      const materials = Array.isArray(point.materiais)
        ? point.materiais
        : point.materiais
          ? [point.materiais]
          : [];
      return {
        name: text(point.nome),
        type: text(point.tipo || 'outros'),
        materials: JSON.stringify(materials.map((item) => text(item))),
        address: text(point.endereco),
        neighborhood: text(point.bairro),
        cep: text(point.cep),
        hours: text(point.horario),
        phone: text(point.telefone),
        responsible: text(point.responsavel),
        lat: number(point.lat),
        lon: number(point.lon),
        coord_precision: text(point.precisao_coordenada),
        source_url: text(point.fonte_url),
        source_date: text(point.fonte_data),
        confidence: text(point.confianca),
        notes: publicNotes(point.observacoes),
      };
    });
}

/** Tabelas na ordem em que podem ser apagadas sem ferir as chaves estrangeiras. */
const TABLES = [
  'user_achievements',
  'redemptions',
  'rewards',
  'partners',
  'post_comments',
  'post_likes',
  'posts',
  'challenge_progress',
  'challenges',
  'notifications',
  'action_records',
  'actions',
  'password_resets',
  'users',
  'collection_points',
  'community_goals',
  'tips',
];

/** Apaga todos os dados e zera as sequências de id. */
function wipe() {
  for (const table of TABLES) db.prepare(`DELETE FROM ${table}`).run();
  db.prepare('DELETE FROM sqlite_sequence').run();
}

function insert(table, values) {
  const columns = Object.keys(values);
  const info = db
    .prepare(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    )
    .run(...columns.map((column) => values[column]));
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid);
}

/** Só o catálogo (ações, desafios, parceiros, recompensas, meta, dicas e pontos de coleta). */
function seedCatalog(createdAt) {
  const created = iso(createdAt);
  for (const action of ACTIONS) insert('actions', { ...action, tags: JSON.stringify(action.tags) });
  for (const challenge of CHALLENGES) insert('challenges', challenge);
  const partnerIds = new Map();
  for (const partner of PARTNERS) {
    const row = insert('partners', { ...partner, pin: DEMO_PARTNER_PIN, created_at: created });
    partnerIds.set(partner.name, row.id);
  }
  for (const { partner, ...reward } of REWARDS) {
    insert('rewards', {
      ...reward,
      partner_id: partnerIds.get(partner),
      active: 1,
      created_at: created,
    });
  }
  insert('community_goals', {
    title: 'Meta coletiva da semana',
    description: `Juntos, vamos registrar ${WEEKLY_GOAL_TARGET} ações sustentáveis até domingo.`,
    target_actions: WEEKLY_GOAL_TARGET,
    active: 1,
  });
  for (const tip of TIPS) insert('tips', tip);
  for (const point of loadCollectionPoints()) insert('collection_points', point);
}

const byId = (table, id) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
const freshUser = (user) => byId('users', user.id);

/** Tenta registrar; um registro que esbarra em limite é simplesmente ignorado. */
function tryRegister(user, actionId, at, quantity = 1) {
  try {
    registerAction(freshUser(user), byId('actions', actionId), { quantity, at, silent: true });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }
}

function tryRedeem(user, reward, at, now) {
  if (at.getTime() > now.getTime()) return null;
  try {
    return redeemReward(freshUser(user), reward, { at, silent: true });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return null;
  }
}

const plus = (instant, ms) => new Date(instant.getTime() + ms);
const same = (a, b) => a.getTime() === b.getTime();

function seedClara(now, today, weekStart, firstDay) {
  const clara = createUser({
    name: 'Clara Mendes',
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    neighborhood: 'Boa Vista',
    createdAt: plus(firstDay, 7 * HOUR),
  });
  // Meta mensal compatível com o ritmo da conta de demonstração.
  db.prepare('UPDATE users SET monthly_goal = 120, weekly_goal = 25 WHERE id = ?').run(clara.id);

  const reward = (title) => db.prepare('SELECT * FROM rewards WHERE title = ?').get(title);

  function register(actionId, at, { quantity = 1, currentWeek = false } = {}) {
    if (at.getTime() > now.getTime()) return;
    if (currentWeek) {
      const points = byId('actions', actionId).points * quantity;
      if (weekActionPoints(clara.id, at) + points > economy.WEEKLY_CAP - ROOM_BELOW_CAP) return;
    }
    tryRegister(clara, actionId, at, quantity);
  }

  // ----- Semanas anteriores: ritmo de uma usuária regular -----
  const transportChallengeWeek = plus(weekStart, -35 * DAY);
  const expiredCouponDay = plus(weekStart, -40 * DAY);
  const usedCouponDay = plus(weekStart, -18 * DAY);

  for (let d = firstDay; d.getTime() < weekStart.getTime(); d = plus(d, DAY)) {
    const weekday = economy.weekday(d);
    const weeksAgo = Math.floor(Math.floor((weekStart - d) / DAY) / 7) + 1;
    const inChallengeWeek =
      d.getTime() >= transportChallengeWeek.getTime() &&
      d.getTime() < plus(transportChallengeWeek, 7 * DAY).getTime();

    if (same(d, transportChallengeWeek)) {
      joinChallenge(clara, byId('challenges', 2), { at: plus(d, 7 * HOUR) });
    }

    register(1, plus(d, 7 * HOUR + 30 * MINUTE));
    register(1, plus(d, 21 * HOUR + 40 * MINUTE));
    register(2, plus(d, 12 * HOUR + 10 * MINUTE));
    if (weekday === 1 || weekday === 3 || weekday === 5) {
      register(3, plus(d, 18 * HOUR + 20 * MINUTE), { quantity: inChallengeWeek ? 2 : 1 });
    }
    if (weekday === 2 || weekday === 6) register(4, plus(d, 19 * HOUR + 40 * MINUTE));
    if (weekday === 4 && weeksAgo % 2 === 0) register(5, plus(d, 22 * HOUR));
    if (weekday === 7 && weeksAgo % 3 === 0) register(6, plus(d, 9 * HOUR));

    if (same(d, expiredCouponDay)) {
      tryRedeem(clara, reward('15% de desconto no combo'), plus(d, 13 * HOUR), now);
    }
    if (same(d, usedCouponDay)) {
      const redemption = tryRedeem(clara, reward('Café especial grátis'), plus(d, 13 * HOUR), now);
      if (redemption) markRedemptionUsed(redemption, { at: plus(d, 2 * DAY + 9 * HOUR) });
    }
  }

  // ----- Semana atual: dias cheios em ritmo forte, para chegar perto do teto -----
  if (weekStart.getTime() <= now.getTime()) {
    joinChallenge(clara, byId('challenges', 1), { at: plus(weekStart, 5 * MINUTE) });
  }
  const yesterday = plus(today, -DAY);
  for (let d = weekStart; d.getTime() < today.getTime(); d = plus(d, DAY)) {
    const isMonday = economy.weekday(d) === 1;
    register(1, plus(d, 7 * HOUR + 30 * MINUTE), { currentWeek: true });
    register(1, plus(d, 21 * HOUR + 40 * MINUTE), { currentWeek: true });
    register(2, plus(d, 12 * HOUR + 10 * MINUTE), { currentWeek: true });
    register(4, plus(d, 19 * HOUR + 40 * MINUTE), { currentWeek: true });
    register(3, plus(d, 18 * HOUR + 20 * MINUTE), { quantity: 2, currentWeek: true });
    if (isMonday) register(5, plus(d, 22 * HOUR), { currentWeek: true });
    if (same(d, yesterday)) register(6, plus(d, 9 * HOUR), { currentWeek: true });
  }

  // ----- Hoje: poucas ações, espalhadas pelo tempo já decorrido do dia -----
  const elapsedSeconds = Math.trunc((now - today) / 1000);
  const todayAt = (fraction) => plus(today, Math.round(elapsedSeconds * fraction) * 1000);
  register(1, todayAt(0.3), { currentWeek: true });
  register(2, todayAt(0.5), { currentWeek: true });
  register(3, todayAt(0.7), { currentWeek: true });

  // Um cupom ainda válido, resgatado há três dias.
  tryRedeem(
    clara,
    reward('20% de desconto no almoço executivo'),
    plus(now, -(3 * DAY + 2 * HOUR)),
    now,
  );

  return freshUser(clara);
}

/**
 * Cria os moradores fictícios e as duas últimas semanas de ações deles,
 * passando pelas mesmas regras de qualquer usuário. É daqui que saem os
 * números do bairro: vizinhos ativos, ações da semana, meta coletiva, ranking
 * e "quantos registraram hoje".
 */
function seedNeighbors(now, today, weekStart) {
  const firstDay = plus(today, -13 * DAY);
  const people = new Map();

  // Gerador simples e determinístico (o mesmo do app): a demonstração é sempre a mesma.
  let state = 20261111;
  function next(max) {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return (state >> 8) % max;
  }

  const elapsedToday = Math.trunc((now - today) / 1000);

  NEIGHBORS.forEach(([name, neighborhood, pace], i) => {
    const person = createUser({
      name,
      email: `vizinho${i + 1}@demo.ecoviva`,
      // Contas de figuração: ninguém entra com elas.
      password: `figurante-${state + i}-${Math.random().toString(36).slice(2)}`,
      neighborhood,
      createdAt: plus(firstDay, -(20 + i) * DAY),
    });
    people.set(name, person);

    const register = (actionId, at, quantity = 1) => {
      if (at.getTime() > now.getTime()) return;
      tryRegister(person, actionId, at, quantity);
    };

    // Entradas em desafios, para a contagem de participantes ser real.
    const joins = [];
    if (i < 9) joins.push([1, plus(weekStart, (10 + i) * MINUTE)]);
    if (i >= 3 && i < 10) joins.push([2, plus(today, -5 * DAY)]);
    if (i >= 10 && i < 14) joins.push([3, plus(today, -6 * DAY)]);
    if (i >= 12) joins.push([4, plus(today, -4 * DAY)]);
    for (const [challengeId, at] of joins) {
      if (at.getTime() > now.getTime()) continue;
      joinChallenge(person, byId('challenges', challengeId), { at });
    }

    for (let d = firstDay; d.getTime() <= today.getTime(); d = plus(d, DAY)) {
      const isToday = same(d, today);
      const activeChance = pace === 3 ? 95 : pace === 2 ? 75 : 45;
      const roll = next(100);
      if (roll >= activeChance) continue;

      // Hoje as ações se espalham pelo tempo já decorrido do dia.
      const at = (hour, minute) => {
        if (!isToday) return plus(d, hour * HOUR + minute * MINUTE);
        const fraction = Math.min(Math.max((hour - 6) / 17, 0.05), 0.95);
        return plus(today, Math.round(elapsedToday * fraction) * 1000);
      };

      register(1, at(7, 20 + i));
      if (pace >= 2) register(1, at(21, 10 + i));
      if (next(100) < 40 + pace * 15) register(2, at(12, i));
      if (next(100) < 15 + pace * 15) register(3, at(18, i), pace === 3 ? 2 : 1);
      if (next(100) < 10 + pace * 12) register(4, at(19, 30));
      if (next(100) < 20 + pace * 10) register(5, at(22, 0));
      if (pace === 3 && economy.weekday(d) === 7) register(6, at(9, 0));
    }
  });
  return people;
}

function seedCommunity(clara, now, people) {
  const ago = (ms) => iso(plus(now, -ms));

  function post({ name, initials, content, likes, age, userId = null, comments = [] }) {
    const row = insert('posts', {
      // As publicações dos vizinhos pertencem às contas deles.
      user_id: userId ?? people.get(name)?.id ?? null,
      author_name: name,
      author_initials: initials,
      content,
      base_likes: likes,
      created_at: ago(age),
    });
    for (const [author, authorInitials, body, commentAge] of comments) {
      insert('post_comments', {
        post_id: row.id,
        user_id: null,
        author_name: author,
        author_initials: authorInitials,
        content: body,
        created_at: ago(commentAge),
      });
    }
    if (userId !== null) {
      db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)').run(row.id, userId);
    }
  }

  post({
    name: 'Marina Lopes',
    initials: 'ML',
    content:
      'Comecei a compostar na varanda e em duas semanas o lixo orgânico da casa caiu pela metade. Quem quiser dicas, chama!',
    likes: 34,
    age: 3 * HOUR,
    comments: [['Rafael Souza', 'RS', 'Adorei! Vou tentar aqui também.', 2 * HOUR]],
  });
  post({
    name: 'Rafael Souza',
    initials: 'RS',
    content:
      'Mutirão de limpeza da praça neste sábado às 9h. Levem luvas e sacolas, a prefeitura recolhe o material no fim da manhã.',
    likes: 51,
    age: 8 * HOUR,
    comments: [['Marina Lopes', 'ML', 'Vou levar as crianças para ajudar.', 4 * HOUR]],
  });
  post({
    name: 'João Ferreira',
    initials: 'JF',
    content:
      'Troquei o carro pela bike em trajetos de até 5 km. Em um mês foram 18 trajetos e muita disposição a mais.',
    likes: 28,
    age: 26 * HOUR,
  });
  post({
    name: clara.name,
    initials: clara.initials,
    userId: clara.id,
    content:
      'Fechando a torneira todos os dias já passei de mil litros de água poupados. Pequenas atitudes somam muito!',
    likes: 19,
    age: 50 * HOUR,
    comments: [['João Ferreira', 'JF', 'Excelente, Clara! Bora manter o ritmo.', 48 * HOUR]],
  });
}

function seedNotifications(clara, now, firstDay) {
  notify(
    clara.id,
    'sistema',
    'Boas-vindas ao EcoViva!',
    'Sua conta de demonstração está pronta, com histórico, desafios, comunidade e cupons.',
    { target: '/acoes', at: plus(firstDay, 7 * HOUR), read: true },
  );
  notify(
    clara.id,
    'recompensa',
    'Resgate confirmado!',
    'Você resgatou "20% de desconto no almoço executivo" com Restaurante Sabor da Terra.',
    { target: '/recompensas', at: plus(now, -(3 * DAY + 2 * HOUR)), read: true },
  );
  notify(clara.id, 'comunidade', 'Novo comentário', 'João Ferreira comentou na sua publicação.', {
    target: '/comunidade',
    at: plus(now, -48 * HOUR),
  });
  notify(
    clara.id,
    'desafio',
    'Desafio em andamento',
    'Continue registrando ações de Água para concluir "Semana sem desperdício de água".',
    { target: '/desafios', at: plus(now, -5 * HOUR) },
  );
  notify(
    clara.id,
    'sistema',
    'Você está perto do teto da semana',
    `Faltam poucos pontos para os ${economy.WEEKLY_CAP} desta semana. As ações continuam valendo para desafios e conquistas.`,
    { target: '/progresso', at: plus(now, -40 * MINUTE) },
  );
}

/**
 * Apaga tudo e recria os dados de demonstração, relativos a `now`.
 * Enquanto a carga roda, o relógio da aplicação fica parado em `now`.
 */
function runSeed({ now = clock.now() } = {}) {
  const previous = clock.fixedAt();
  clock.setNow(now);
  try {
    db.transaction(() => {
      wipe();
      const today = economy.startOfLocalDay(now);
      const weekStart = plus(today, -(economy.weekday(now) - 1) * DAY);
      const firstDay = plus(today, -63 * DAY);

      seedCatalog(firstDay);
      const clara = seedClara(now, today, weekStart, firstDay);
      const people = seedNeighbors(now, today, weekStart);
      seedCommunity(clara, now, people);
      seedNotifications(clara, now, firstDay);
    })();
  } finally {
    clock.setNow(previous);
  }
}

function counts() {
  const one = (sql) => db.prepare(sql).get().total;
  return {
    users: one('SELECT COUNT(*) AS total FROM users'),
    actions: one('SELECT COUNT(*) AS total FROM actions'),
    records: one("SELECT COUNT(*) AS total FROM action_records WHERE kind = 'action'"),
    rewards: one('SELECT COUNT(*) AS total FROM rewards'),
    collectionPoints: one('SELECT COUNT(*) AS total FROM collection_points'),
  };
}

if (require.main === module) {
  const force = process.argv.includes('--force');
  if (config.isProduction && !force) {
    console.error(
      'Recusado: NODE_ENV=production. O seed APAGA todos os dados. Se é isso mesmo, rode `npm run seed -- --force`.',
    );
    process.exit(1);
  }
  runSeed();
  const total = counts();
  console.log(
    `Dados de demonstração criados: ${total.users} usuários, ${total.actions} ações, ` +
      `${total.records} registros, ${total.rewards} recompensas, ${total.collectionPoints} pontos de coleta.`,
  );
  console.log(`Conta de demonstração: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  db.close();
}

module.exports = {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_PARTNER_PIN,
  WEEKLY_GOAL_TARGET,
  ACTIONS,
  CHALLENGES,
  PARTNERS,
  REWARDS,
  TIPS,
  NEIGHBORS,
  runSeed,
  seedCatalog,
  wipe,
};
