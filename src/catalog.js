// Catálogo de referência: ações, desafios, parceiros, recompensas, dicas,
// meta coletiva e pontos de coleta.
//
// É o mesmo catálogo do modo local do app (`eco-app/lib/core/local/local_seed.dart`).
// Usado pela carga de demonstração (`src/seed.js`) e pelos dados de
// referência que completam um banco antigo na inicialização
// (`src/referenceData.js`). Só dados: não abre o banco.

const fs = require('node:fs');
const path = require('node:path');

/** Código de conferência usado por todos os parceiros de demonstração. */
const DEMO_PARTNER_PIN = '1234';

/** Meta coletiva: ações registradas por toda a comunidade na semana. */
const WEEKLY_GOAL_TARGET = 400;

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

/** Meta coletiva padrão da semana. */
function defaultCommunityGoal() {
  return {
    title: 'Meta coletiva da semana',
    description: `Juntos, vamos registrar ${WEEKLY_GOAL_TARGET} ações sustentáveis até domingo.`,
    target_actions: WEEKLY_GOAL_TARGET,
    active: 1,
  };
}

module.exports = {
  DEMO_PARTNER_PIN,
  WEEKLY_GOAL_TARGET,
  ACTIONS,
  CHALLENGES,
  PARTNERS,
  REWARDS,
  TIPS,
  COLLECTION_POINTS_FILE,
  loadCollectionPoints,
  defaultCommunityGoal,
};
