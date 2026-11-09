# ♻️ EcoViva — Backend

![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white)
![JWT](https://img.shields.io/badge/Auth-JWT-D63AFF?logo=jsonwebtokens&logoColor=white)

API REST do **EcoViva**, aplicativo de hábitos sustentáveis. Gerencia contas,
catálogo de ações ecológicas, registros de ações, pontuação/níveis, conquistas,
desafios coletivos, notificações, o feed da comunidade e o resgate de
recompensas oferecidas por empresas parceiras.

- **App (Flutter):** https://github.com/EcoViva-Project/app
- **API local:** `http://127.0.0.1:3000/api`
- **Health check:** `GET /api/health`

---

## 🧰 Tecnologias

| Tecnologia | Versão | Uso |
| --- | --- | --- |
| **Node.js** | 22.9+ | Runtime (usa `--env-file-if-exists`) |
| **Express** | 5.3 | Framework HTTP e rotas |
| **better-sqlite3** | 13.0 | Banco SQLite síncrono, WAL e FKs |
| **bcryptjs** | 3.0 | Hash de senhas (custo 10) |
| **jsonwebtoken** | 9.0 | JWT com expiração configurável |
| **cors** | 2.8 | Liberação de CORS |

Sem ORM, sem TypeScript e sem `dotenv`: o schema é criado em `src/db.js` e as
variáveis de ambiente são lidas via `process.env` (carregadas pelos scripts com
`--env-file-if-exists=.env`).

---

## 🚀 Como rodar

### Pré-requisitos
- **Node.js 22.9+** (ou 20.19+, pela flag `--env-file-if-exists`)
- npm

### Passos

```bash
npm install

# cria o .env a partir do template
cp .env.example .env

# popula o banco com dados de demonstração
npm run seed

# sobe a API com reload automático
npm run dev
```

A API sobe em `http://127.0.0.1:3000/api` e cria o SQLite em `./data/eco.db`.

> `npm run seed` **apaga todos os dados existentes** e recria o cenário demo.

### Conta de demonstração

| Campo | Valor |
| --- | --- |
| E-mail | `clara@eco.app` |
| Senha | `eco1234` |
| Bairro | Jardim das Flores |

O seed cria 1 usuária, 6 ações, 42 registros (~1.240 pontos e 28 L economizados),
4 desafios, 4 publicações com comentários, 5 parceiros e 9 recompensas
(produto, serviço, desconto e jogo).

### Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Sobe com `node --watch` e recarrega ao salvar |
| `npm start` | Sobe sem watch (produção) |
| `npm run seed` | Recria o banco e insere os dados demo |
| `npm test` | Runner nativo do Node (`node --test`) com 56 testes de integração |

---

## ⚙️ Variáveis de ambiente

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP (inteiro positivo) |
| `NODE_ENV` | `development` | Em `production` exige `JWT_SECRET` forte e oculta o `devCode` |
| `JWT_SECRET` | `eco-dev-secret-change-me` | Segredo dos tokens — **obrigatório e com ≥32 caracteres em produção** |
| `JWT_EXPIRES_IN` | `7d` | Validade do token (formato aceito pelo `jsonwebtoken`) |
| `RESET_CODE_TTL_MINUTES` | `30` | Validade do código de recuperação (inteiro positivo) |
| `DB_PATH` | `<repo>/data/eco.db` | Caminho do arquivo SQLite |
| `CORS_ORIGIN` | `*` | Origem(ns) permitida(s); aceita lista separada por vírgula |

O arquivo `.env` é ignorado pelo Git; `.env.example` é o template versionado.
Se rodar `node src/server.js` diretamente (sem npm), use
`node --env-file-if-exists=.env src/server.js`.

A configuração é carregada em `src/config.js` (função `loadConfig`). Valores
inválidos de `PORT`/`RESET_CODE_TTL_MINUTES` interrompem a inicialização, e com
`NODE_ENV=production` a API se recusa a subir sem um `JWT_SECRET` forte
(diferente do padrão de desenvolvimento e com ao menos 32 caracteres).

---

## 🔌 Endpoints

Todas as rotas ficam sob `/api`. Exceto `health`, `register`, `login`,
`forgot-password` e `reset-password`, todas exigem:

```http
Authorization: Bearer <token>
```

### Auth — `/api/auth`

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/register` | Cria conta (`name`, `email`, `password`, `neighborhood?`) |
| `POST` | `/login` | Retorna `{ token, user }` |
| `GET` | `/me` | Usuário autenticado |
| `POST` | `/forgot-password` | Gera código de 6 dígitos (TTL configurável) |
| `POST` | `/reset-password` | Troca a senha com `email`, `code`, `password` |

### Usuário — `/api/users`

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/me` | `user` + `summary` + `achievements` |
| `PATCH` | `/me` | `name`, `neighborhood`, `monthlyGoal`, `weeklyGoal` |
| `PATCH` | `/me/preferences` | `notificationsEnabled`, `remindersEnabled`, `privacyProfile`, `privacyLocation` |

### Ações e registros — `/api/actions` e `/api/records`

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/actions` | Lista com `?category=`, `?search=`, `?sort=points\|alphabetical` |
| `GET` | `/actions/:id` | Detalhe da ação |
| `POST` | `/actions/:id/records` | Registra a ação (`quantity` 1–50, `notes` ≤ 500) |
| `GET` | `/records` | Histórico do usuário (`?limit=` 1–500, padrão 100) |

> O app Flutter atual mantém o catálogo de ações embutido e consome apenas o
> `POST /actions/:id/records` e o `GET /records`. Os endpoints de listagem e
> detalhe existem para futuras versões e para uso direto da API.

Registrar uma ação retorna `record`, `summary`, `achievements` e
`newAchievements`, além de criar notificação. Pontos e litros são multiplicados
pela `quantity`.

### Progresso — `/api/progress`

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/` | `summary` + `achievements` |
| `GET` | `/achievements` | Lista das 10 conquistas com progresso |

### Desafios — `/api/challenges`

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/` | Desafios com progresso do usuário |
| `GET` | `/:id` | Detalhe |
| `POST` | `/:id/join` | Entra no desafio |
| `POST` | `/:id/progress` | Avança `steps`; ao concluir, credita a recompensa |

### Notificações — `/api/notifications`

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/` | Lista + `unreadCount` |
| `POST` | `/read-all` | Marca todas como lidas |
| `PATCH` | `/:id/read` | Marca uma como lida |
| `DELETE` | `/:id` | Remove uma |
| `DELETE` | `/` | Remove todas |

### Comunidade — `/api/community`

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/posts` | Feed (últimos 100) com likes e comentários |
| `POST` | `/posts` | Publica (`content` 3–1000) |
| `POST` | `/posts/:id/like` | Alterna like (toggle) |
| `GET` | `/posts/:id/comments` | Comentários |
| `POST` | `/posts/:id/comments` | Comenta (`content` ≤ 500) |
| `DELETE` | `/posts/:id` | Só o autor pode excluir |

### Recompensas — `/api/rewards`

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/` | Recompensas ativas (`?category=`, `?search=`, `?sort=points\|points_desc\|alphabetical`) |
| `GET` | `/:id` | Detalhe da recompensa |
| `POST` | `/:id/redeem` | Resgata, debita pontos, reduz estoque e gera código único |
| `GET` | `/redemptions` | Histórico de resgates + `summary` atualizado |

Categorias: `produto`, `servico`, `desconto` e `jogo`. O saldo disponível
(`summary.points`) é `pointsEarned − pointsSpent`; o nível continua calculado
pelos pontos ganhos. Resgates devolvem 404 (recompensa inexistente/inativa) ou
409 (esgotada/saldo insuficiente) em JSON `{ "error": "..." }`.

### Exemplos

```bash
# health
curl http://127.0.0.1:3000/api/health

# login
curl -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"clara@eco.app","password":"eco1234"}'

# registrar ação (id 1, quantidade 2)
curl -X POST http://127.0.0.1:3000/api/actions/1/records \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"quantity":2,"notes":"Registro pelo curl"}'
```

---

## 🗄️ Modelo de dados

| Tabela | Conteúdo |
| --- | --- |
| `users` | Conta, bairro, iniciais, metas e preferências |
| `password_resets` | Códigos de recuperação (TTL + uso único) |
| `actions` | Catálogo de ações sustentáveis |
| `action_records` | Registros do usuário (pontos, litros, quantidade, notas) |
| `notifications` | Notificações por usuário |
| `challenges` | Desafios semanais e coletivos |
| `challenge_progress` | Progresso por usuário/desafio |
| `posts` | Publicações da comunidade |
| `post_likes` | Likes (PK composta `post_id` + `user_id`) |
| `post_comments` | Comentários |
| `partners` | Empresas parceiras que criam recompensas |
| `rewards` | Produtos, serviços, descontos e itens de jogos |
| `redemptions` | Resgates com código, pontos gastos e status |

O SQLite roda com `journal_mode = WAL` e `foreign_keys = ON`. O schema é
idempotente (`CREATE TABLE IF NOT EXISTS`) e aplicado na inicialização.

### Regras de negócio

- **Categorias:** Água, Reciclagem, Alimentação, Transporte, Energia, Espaços Públicos.
- **Níveis por pontos:** Semente (0–499), Broto (500–999), Guardiã Verde
  (1.000–1.499), Guardiã do Bairro (1.500–2.499), Guardiã do Planeta (2.500+).
- **10 conquistas** calculadas em tempo real (primeira ação, litros, dias ativos,
  desafios, variedade de categorias etc.).
- **Desafio concluído** gera um `action_record` com os pontos da recompensa e uma
  notificação.
- **Notificações automáticas** ao registrar ação, desbloquear conquista,
  concluir desafio, receber comentário e resgatar recompensa.
- **Recompensas de parceiros:** troca de pontos por produtos/serviços/descontos/
  itens de jogos. O resgate reduz o estoque, gera código `ECO-XXXXXXXX` e
  registra no histórico; o nível não cai ao gastar pontos.

---

## 📁 Estrutura

```txt
eco-backend/
├── data/                    # SQLite (ignorado no Git)
├── src/
│   ├── middleware/auth.js   # assinatura e verificação de JWT
│   ├── routes/              # auth, users, actions, records, progress,
│   │                        # notifications, challenges, community, rewards
│   ├── services/
│   │   ├── progress.js      # níveis, resumo e conquistas
│   │   └── serializers.js   # mapeamento row -> JSON
│   ├── app.js               # Express, CORS, JSON e rotas
│   ├── config.js            # env vars e defaults
│   ├── db.js                # conexão + schema
│   ├── seed.js              # dados de demonstração
│   └── server.js            # listen + shutdown gracioso
├── test/                    # testes de integração (node:test)
│   ├── helpers.js           # servidor efêmero + SQLite em memória + fixtures
│   └── *.test.js            # auth, users, actions, progress, challenges,
│                            # community e rewards
├── .env.example
├── package.json
└── package-lock.json
```

---

## ⚠️ Segurança e limitações

- `CORS_ORIGIN` tem default `*` (qualquer origem) — em produção defina a lista de
  origens permitidas separada por vírgula.
- `JWT_SECRET` tem default de desenvolvimento; em produção a API só sobe com um
  segredo forte (≥32 caracteres).
- Sem rate limit, verificação de e-mail ou proteção contra força bruta.
- O código de recuperação é retornado na resposta quando `NODE_ENV !== production`
  (não há provedor de e-mail integrado).
- Sem CI ou Dockerfile.
- SQLite local (arquivo único) — não indicado para múltiplas instâncias.
- `npm test` cobre os endpoints principais com `node:test` e SQLite em memória;
  ainda não há testes de carga, rate limit ou integração com e-mail real.

---

## 👨‍💻 Créditos

Projeto acadêmico/comunitário **EcoViva** — API em Node.js, Express e SQLite.
