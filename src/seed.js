const bcrypt = require('bcryptjs');
const db = require('./db');

const DEMO_EMAIL = 'clara@eco.app';
const DEMO_PASSWORD = 'eco1234';

const ACTIONS = [
  {
    title: 'Fechar a torneira ao escovar os dentes',
    description: 'Economia estimada de ~12L de água por ciclo',
    category: 'agua',
    categoryLabel: 'Água',
    icon: 'water_drop',
    points: 15,
    liters: 12,
    info: 'Hábito diário',
    infoIcon: 'schedule',
    tags: ['agua', 'torneira', 'dentes', 'banho'],
    footerInfo: '432 vizinhos registraram hoje',
    footerIcon: 'groups',
  },
  {
    title: 'Separar resíduos secos e orgânicos',
    description: 'Destino correto de plástico, papel, vidro e metal',
    category: 'reciclagem',
    categoryLabel: 'Reciclagem',
    icon: 'recycling',
    points: 30,
    liters: 0,
    info: 'Coleta seletiva',
    infoIcon: 'recycling',
    tags: ['reciclagem', 'lixo', 'residuos', 'secos', 'organicos'],
    footerInfo: 'Evita 0.8kg de CO₂ equivalente',
    footerIcon: 'eco',
  },
  {
    title: 'Deslocamento a pé ou de bicicleta',
    description: 'Mobilidade ativa sem emissões diretas de carbono',
    category: 'transporte',
    categoryLabel: 'Transporte',
    icon: 'directions_bike',
    points: 40,
    liters: 0,
    info: 'Saúde & Ar Limpo',
    infoIcon: 'favorite',
    tags: ['transporte', 'bicicleta', 'bike', 'caminha', 'pe', 'mobilidade'],
    footerInfo: 'Distâncias de até 5 km',
    footerIcon: 'route',
  },
  {
    title: 'Compostagem de resíduos orgânicos',
    description: 'Cascas, borra de café e restos vegetais transformados em adubo',
    category: 'alimentacao',
    categoryLabel: 'Alimentação',
    icon: 'compost',
    points: 35,
    liters: 0,
    info: 'Nutrientes de volta ao solo',
    infoIcon: 'yard',
    tags: ['alimentacao', 'compostagem', 'comida', 'horta', 'adubo'],
    footerInfo: 'Reduz 45% do lixo doméstico',
    footerIcon: 'check_circle',
  },
  {
    title: 'Apagar luzes em cômodos vazios',
    description: 'Eficiência energética e redução no consumo mensal',
    category: 'energia',
    categoryLabel: 'Energia',
    icon: 'lightbulb_outline',
    points: 20,
    liters: 0,
    info: 'Consumo Consciente',
    infoIcon: 'bolt',
    tags: ['energia', 'luz', 'comodo', 'eletricidade', 'lampada'],
    footerInfo: 'Até 10% de alívio na fatura',
    footerIcon: 'savings',
  },
  {
    title: 'Mutirão de limpeza de praça pública',
    description: 'Cuidado com os canteiros, descarte e conservação de áreas comuns',
    category: 'publico',
    categoryLabel: 'Espaços Públicos',
    icon: 'park',
    points: 60,
    liters: 0,
    info: 'Coletivo',
    infoIcon: 'diversity_1',
    tags: ['publico', 'praca', 'parque', 'mutirao', 'comunidade', 'limpeza'],
    footerInfo: 'Insígnia de Zelador Cívico',
    footerIcon: 'military_tech',
  },
];

const CHALLENGES = [
  {
    title: 'Semana sem desperdício de água',
    description: 'Feche a torneira e reduza o tempo de banho por 7 dias.',
    category: 'Água',
    icon: 'water_drop',
    targetSteps: 7,
    pointsReward: 120,
    participants: 184,
    daysLeft: 4,
    isWeekly: 1,
  },
  {
    title: 'Transporte ativo no bairro',
    description: 'Faça 5 trajetos curtos a pé ou de bicicleta.',
    category: 'Transporte',
    icon: 'directions_bike',
    targetSteps: 5,
    pointsReward: 100,
    participants: 97,
    daysLeft: 6,
    isWeekly: 1,
  },
  {
    title: 'Mutirão da praça central',
    description: 'Participe da limpeza e do plantio de mudas na praça do bairro.',
    category: 'Espaços Públicos',
    icon: 'park',
    targetSteps: 1,
    pointsReward: 150,
    participants: 63,
    daysLeft: 12,
    isWeekly: 0,
  },
  {
    title: 'Desafio da compostagem',
    description: 'Separe resíduos orgânicos por 10 dias seguidos.',
    category: 'Alimentação',
    icon: 'compost',
    targetSteps: 10,
    pointsReward: 180,
    participants: 128,
    daysLeft: 9,
    isWeekly: 0,
  },
];

const PARTNERS = [
  {
    name: 'Mercado Verde',
    description: 'Mercearia sustentável com produtos a granel e orgânicos.',
    logoIcon: 'storefront',
  },
  {
    name: 'EcoClean Serviços',
    description: 'Limpeza ecológica residencial com produtos biodegradáveis.',
    logoIcon: 'cleaning_services',
  },
  {
    name: 'Café Raízes',
    description: 'Cafeteria de bairro com grãos de produtores locais.',
    logoIcon: 'local_cafe',
  },
  {
    name: 'Floresta Games',
    description: 'Estúdio de jogos com temáticas ambientais.',
    logoIcon: 'sports_esports',
  },
  {
    name: 'Bike Urbana',
    description: 'Oficina e loja de bicicletas para mobilidade ativa.',
    logoIcon: 'directions_bike',
  },
];

const REWARDS = [
  {
    partner: 'Mercado Verde',
    title: 'Kit de sacolas reutilizáveis',
    description:
      'Conjunto com três sacolas de algodão orgânico para as compras do dia a dia.',
    category: 'produto',
    categoryLabel: 'Produto',
    icon: 'shopping_bag',
    pointsCost: 400,
    stock: 25,
    terms: 'Retire na loja em até 30 dias após o resgate.',
    isFeatured: 1,
  },
  {
    partner: 'Mercado Verde',
    title: 'Cesta de hortifrúti orgânico',
    description:
      'Seleção semanal de frutas e verduras cultivadas por produtores locais.',
    category: 'produto',
    categoryLabel: 'Produto',
    icon: 'eco',
    pointsCost: 900,
    stock: 10,
    terms: 'Entrega agendada no bairro. Sujeito à disponibilidade da safra.',
    isFeatured: 0,
  },
  {
    partner: 'EcoClean Serviços',
    title: 'Limpeza ecológica residencial',
    description:
      'Duas horas de limpeza com produtos biodegradáveis para a sua casa.',
    category: 'servico',
    categoryLabel: 'Serviço',
    icon: 'cleaning_services',
    pointsCost: 1200,
    stock: 8,
    terms: 'Agendamento com antecedência mínima de 3 dias.',
    isFeatured: 1,
  },
  {
    partner: 'Café Raízes',
    title: 'Café especial grátis',
    description:
      'Um café coado especial de 200 ml na unidade do bairro.',
    category: 'desconto',
    categoryLabel: 'Desconto',
    icon: 'local_cafe',
    pointsCost: 150,
    stock: 60,
    terms: 'Válido de segunda a sexta, das 8h às 17h.',
    isFeatured: 0,
  },
  {
    partner: 'Café Raízes',
    title: '15% de desconto no combo',
    description:
      'Desconto em qualquer combo de café com pão de fermentação natural.',
    category: 'desconto',
    categoryLabel: 'Desconto',
    icon: 'percent',
    pointsCost: 90,
    stock: 100,
    terms: 'Não cumulativo com outras promoções.',
    isFeatured: 0,
  },
  {
    partner: 'Floresta Games',
    title: 'Skin Guardião da Floresta',
    description:
      'Pacote de cosméticos digitais exclusivo do jogo Floresta Viva.',
    category: 'jogo',
    categoryLabel: 'Jogo',
    icon: 'sports_esports',
    pointsCost: 500,
    stock: 40,
    terms: 'Código enviado por e-mail após o resgate.',
    isFeatured: 1,
  },
  {
    partner: 'Floresta Games',
    title: 'Passe de temporada Floresta Viva',
    description:
      'Acesso ao passe de temporada com missões e recompensas temáticas.',
    category: 'jogo',
    categoryLabel: 'Jogo',
    icon: 'sports_esports',
    pointsCost: 1500,
    stock: 5,
    terms: 'Código de uso único, vinculado à sua conta no jogo.',
    isFeatured: 0,
  },
  {
    partner: 'Bike Urbana',
    title: 'Revisão básica de bicicleta',
    description:
      'Ajuste de freios, transmissão e calibragem dos pneus na oficina parceira.',
    category: 'servico',
    categoryLabel: 'Serviço',
    icon: 'directions_bike',
    pointsCost: 700,
    stock: 12,
    terms: 'Peças não inclusas. Agende pelo telefone da oficina.',
    isFeatured: 0,
  },
  {
    partner: 'Bike Urbana',
    title: 'Camisa oficial EcoViva',
    description:
      'Camisa de algodão reciclado com estampa das pedaladas comunitárias.',
    category: 'produto',
    categoryLabel: 'Produto',
    icon: 'checkroom',
    pointsCost: 650,
    stock: 0,
    terms: 'Tamanhos sujeitos ao estoque disponível.',
    isFeatured: 0,
  },
];

const POSTS = [
  {
    authorName: 'Marina Lopes',
    authorInitials: 'ML',
    content:
      'Comecei a compostar na varanda e em duas semanas o lixo orgânico da casa caiu pela metade. Quem quiser dicas, chama!',
    baseLikes: 34,
    hoursAgo: 3,
    comments: [
      {
        authorName: 'Rafael Souza',
        authorInitials: 'RS',
        content: 'Adorei! Vou tentar aqui também.',
        hoursAgo: 2,
      },
    ],
  },
  {
    authorName: 'Rafael Souza',
    authorInitials: 'RS',
    content:
      'Mutirão de limpeza da praça neste sábado às 9h. Levem luvas e sacolas, a prefeitura vai recolher o material no fim da manhã.',
    baseLikes: 51,
    hoursAgo: 8,
    comments: [
      {
        authorName: 'Clara Mendes',
        authorInitials: 'CM',
        content: 'Confirmada! Levo minhas luvas.',
        hoursAgo: 6,
      },
      {
        authorName: 'Marina Lopes',
        authorInitials: 'ML',
        content: 'Vou levar as crianças para ajudar.',
        hoursAgo: 4,
      },
    ],
  },
  {
    authorName: 'João Ferreira',
    authorInitials: 'JF',
    content:
      'Troquei o carro pela bike em trajetos de até 5 km. Em um mês foram 18 trajetos e muita disposição a mais.',
    baseLikes: 28,
    hoursAgo: 26,
    comments: [],
  },
  {
    authorName: 'Clara Mendes',
    authorInitials: 'CM',
    content:
      'Registrei 8 ações de água neste mês e já economizei bastante. Pequenas atitudes somam muito no fim do mês!',
    baseLikes: 19,
    hoursAgo: 50,
    comments: [
      {
        authorName: 'João Ferreira',
        authorInitials: 'JF',
        content: 'Excelente, Clara! Bora manter o ritmo.',
        hoursAgo: 48,
      },
    ],
  },
];

function iso(daysAgo, hour = 9) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, 15, 0, 0);
  return date.toISOString();
}

function currentMonthIso(day, hour = 9) {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), day, hour, 20, 0, 0);
  return date.toISOString();
}

function pointsPlan() {
  const plan = [];
  const levels = [
    { actionIndex: 0, points: 15, count: 24 },
    { actionIndex: 4, points: 20, count: 5 },
    { actionIndex: 5, points: 60, count: 13 },
  ];
  for (const level of levels) {
    for (let i = 0; i < level.count; i += 1) {
      plan.push({ actionIndex: level.actionIndex, points: level.points });
    }
  }
  return plan;
}

function buildRecords() {
  const plan = pointsPlan();
  const dates = [];

  const currentDay = new Date().getDate();
  const currentDays = [1, 2, 3, 4, 5].filter((day) => day <= currentDay);
  const currentSlots = [];
  for (let i = 0; i < 14; i += 1) {
    const day = currentDays[i % currentDays.length];
    currentSlots.push(currentMonthIso(day, 8 + (i % 8)));
  }
  dates.push(...currentSlots);

  const olderOffsets = [10, 18, 26, 34, 45, 60, 75];
  const olderSlots = [];
  for (let i = 0; i < 28; i += 1) {
    const offset = olderOffsets[i % olderOffsets.length];
    olderSlots.push(iso(offset, 8 + (i % 8)));
  }
  dates.push(...olderSlots);

  return plan.map((item, index) => ({
    ...item,
    createdAt: dates[index],
    liters: index < 28 ? 1 : 0,
  }));
}

function seed() {
  const now = new Date().toISOString();
  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);

  const run = db.transaction(() => {
    db.prepare('DELETE FROM redemptions').run();
    db.prepare('DELETE FROM rewards').run();
    db.prepare('DELETE FROM partners').run();
    db.prepare('DELETE FROM post_comments').run();
    db.prepare('DELETE FROM post_likes').run();
    db.prepare('DELETE FROM posts').run();
    db.prepare('DELETE FROM challenge_progress').run();
    db.prepare('DELETE FROM challenges').run();
    db.prepare('DELETE FROM notifications').run();
    db.prepare('DELETE FROM action_records').run();
    db.prepare('DELETE FROM actions').run();
    db.prepare('DELETE FROM password_resets').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM sqlite_sequence').run();

    const userInfo = db
      .prepare(
        `INSERT INTO users
          (name, email, password_hash, neighborhood, initials, monthly_goal, weekly_goal, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'Clara Mendes',
        DEMO_EMAIL,
        passwordHash,
        'Jardim das Flores',
        'CM',
        17,
        5,
        iso(120),
      );
    const userId = Number(userInfo.lastInsertRowid);

    const insertAction = db.prepare(
      `INSERT INTO actions
        (title, description, category, category_label, icon, points, liters, info, info_icon, tags, footer_info, footer_icon)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const actionIds = ACTIONS.map((action) =>
      Number(
        insertAction.run(
          action.title,
          action.description,
          action.category,
          action.categoryLabel,
          action.icon,
          action.points,
          action.liters,
          action.info,
          action.infoIcon,
          JSON.stringify(action.tags),
          action.footerInfo,
          action.footerIcon,
        ).lastInsertRowid,
      ),
    );

    const insertRecord = db.prepare(
      `INSERT INTO action_records
        (user_id, action_id, title, category_label, icon, points, liters, quantity, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const record of buildRecords()) {
      const action = ACTIONS[record.actionIndex];
      insertRecord.run(
        userId,
        actionIds[record.actionIndex],
        action.title,
        action.categoryLabel,
        action.icon,
        record.points,
        record.liters,
        1,
        null,
        record.createdAt,
      );
    }

    const insertChallenge = db.prepare(
      `INSERT INTO challenges
        (title, description, category, icon, target_steps, points_reward, participants, days_left, is_weekly)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const challengeIds = CHALLENGES.map((challenge) =>
      Number(
        insertChallenge.run(
          challenge.title,
          challenge.description,
          challenge.category,
          challenge.icon,
          challenge.targetSteps,
          challenge.pointsReward,
          challenge.participants,
          challenge.daysLeft,
          challenge.isWeekly,
        ).lastInsertRowid,
      ),
    );

    db.prepare(
      `INSERT INTO challenge_progress (user_id, challenge_id, completed_steps, joined, completed)
       VALUES (?, ?, ?, 1, ?)`,
    ).run(userId, challengeIds[0], 3, 0);
    db.prepare(
      `INSERT INTO challenge_progress (user_id, challenge_id, completed_steps, joined, completed)
       VALUES (?, ?, 0, 1, 0)`,
    ).run(userId, challengeIds[2]);

    const insertPartner = db.prepare(
      `INSERT INTO partners (name, description, logo_icon, created_at)
       VALUES (?, ?, ?, ?)`,
    );
    const partnerIds = new Map();
    for (const partner of PARTNERS) {
      const info = insertPartner.run(
        partner.name,
        partner.description,
        partner.logoIcon,
        iso(90),
      );
      partnerIds.set(partner.name, Number(info.lastInsertRowid));
    }

    const insertReward = db.prepare(
      `INSERT INTO rewards
        (partner_id, title, description, category, category_label, icon,
         points_cost, stock, terms, is_featured, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    );
    for (const reward of REWARDS) {
      const partnerId = partnerIds.get(reward.partner);
      if (!partnerId) {
        throw new Error(`Parceiro não encontrado para a recompensa: ${reward.title}`);
      }
      insertReward.run(
        partnerId,
        reward.title,
        reward.description,
        reward.category,
        reward.categoryLabel,
        reward.icon,
        reward.pointsCost,
        reward.stock,
        reward.terms,
        reward.isFeatured,
        iso(30),
      );
    }

    const insertNotification = db.prepare(
      `INSERT INTO notifications (user_id, category, title, message, read, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const notifications = [
      {
        category: 'conquista',
        title: 'Novo selo desbloqueado!',
        message: 'Você conquistou o selo "Guardião da Água" ao economizar água nesta semana.',
        read: 0,
        createdAt: iso(0, 8),
      },
      {
        category: 'desafio',
        title: 'Desafio perto do fim',
        message: 'Faltam 4 dias para concluir "Semana sem desperdício de água".',
        read: 0,
        createdAt: iso(0, 7),
      },
      {
        category: 'comunidade',
        title: 'Novo comentário',
        message: 'João Ferreira comentou na sua publicação sobre economia de água.',
        read: 0,
        createdAt: iso(1, 18),
      },
      {
        category: 'sistema',
        title: 'Bem-vinda ao Eco!',
        message: 'Sua conta de demonstração está pronta com histórico, desafios e comunidade.',
        read: 1,
        createdAt: iso(120, 10),
      },
      {
        category: 'desafio',
        title: 'Mutirão da praça central',
        message: 'Você entrou no desafio coletivo do bairro. Falta 1 etapa para concluir.',
        read: 1,
        createdAt: iso(5, 16),
      },
    ];
    for (const item of notifications) {
      insertNotification.run(
        userId,
        item.category,
        item.title,
        item.message,
        item.read,
        item.createdAt,
      );
    }

    const insertPost = db.prepare(
      `INSERT INTO posts (user_id, author_name, author_initials, content, base_likes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertComment = db.prepare(
      `INSERT INTO post_comments (post_id, user_id, author_name, author_initials, content, created_at)
       VALUES (?, NULL, ?, ?, ?, ?)`,
    );

    for (const post of POSTS) {
      const isClara = post.authorName === 'Clara Mendes';
      const postId = Number(
        insertPost.run(
          isClara ? userId : null,
          post.authorName,
          post.authorInitials,
          post.content,
          post.baseLikes,
          iso(post.hoursAgo / 24, 12),
        ).lastInsertRowid,
      );
      for (const comment of post.comments) {
        insertComment.run(
          postId,
          comment.authorName,
          comment.authorInitials,
          comment.content,
          iso(comment.hoursAgo / 24, 13),
        );
      }
    }

    const claraPost = db
      .prepare('SELECT id FROM posts WHERE author_name = ? ORDER BY id DESC LIMIT 1')
      .get('Clara Mendes');
    if (claraPost) {
      db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)').run(
        claraPost.id,
        userId,
      );
    }

    return { userId, now };
  });

  const { userId } = run();
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS actions, COALESCE(SUM(points),0) AS points,
              COALESCE(SUM(liters),0) AS liters
       FROM action_records WHERE user_id = ?`,
    )
    .get(userId);

  console.log('Seed concluído.');
  console.log(`Usuário: ${DEMO_EMAIL} / senha ${DEMO_PASSWORD}`);
  console.log(
    `Registros: ${totals.actions} | Pontos: ${totals.points} | Litros: ${totals.liters}`,
  );
  console.log(`Data: ${now}`);
}

seed();
db.close();
