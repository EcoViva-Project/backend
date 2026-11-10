# ♻️ EcoViva — Backend

![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white)
![JWT](https://img.shields.io/badge/Auth-JWT-D63AFF?logo=jsonwebtokens&logoColor=white)

API REST do **EcoViva**, aplicativo de hábitos sustentáveis de São José do Rio
Preto (SP). Gerencia contas, catálogo de ações ecológicas, registros, pontos,
níveis e teto semanal, conquistas, desafios coletivos, notificações, o feed e os
números do bairro, o mapa, os pontos de coleta e os cupons de parceiros.

É o **modo online** do app. O app também tem um **modo local** (uma API em Dart
dentro do próprio app, em `eco-app/lib/core/local/`), que é a implementação de
referência: esta API segue as mesmas regras e devolve o mesmo JSON. Os casos de
teste do modo local foram portados para `test/local-api.test.js`.

- **App (Flutter):** https://github.com/EcoViva-Project/app
- **API local:** `http://127.0.0.1:3100/api`
- **Health check:** `GET /api/health`

---

## 🧰 Tecnologias

| Tecnologia | Versão | Uso |
| --- | --- | --- |
| **Node.js** | 22.9+ | Runtime (usa `--env-file-if-exists`) |
| **Express** | 5.3 | Framework HTTP e rotas |
| **better-sqlite3** | 13.0 | Banco SQLite síncrono, WAL e FKs |
| **bcryptjs** | 3.0 | Hash de senhas (custo configurável, padrão 10) |
| **jsonwebtoken** | 9.0 | JWT com expiração configurável |
| **cors** | 2.8 | Liberação de CORS |

Sem ORM, sem TypeScript e sem `dotenv`. O esquema do banco é criado e
atualizado por migrações numeradas (`src/migrations.js`).

---

## 🚀 Como rodar

```bash
npm ci            # no Windows sem compilador C++: npm ci --ignore-scripts
cp .env.example .env
npm run seed      # APAGA os dados e recria a demonstração
npm run dev       # sobe em http://127.0.0.1:3100/api, com reload
```

A porta padrão é **3100**.
No app, aponte para ela com
`--dart-define=ECO_API_URL=http://127.0.0.1:3100/api`.

Por padrão a API escuta só em `127.0.0.1` (este computador). Para um celular na
mesma rede alcançá-la, defina `HOST=0.0.0.0`: isso **expõe a API a toda a rede**
(Wi-Fi da escola, da feira...), inclusive a conta de demonstração, que tem senha
pública. O log da inicialização mostra o endereço real e avisa quando a API está
aberta para a rede.

### Conta de demonstração

| Campo | Valor |
| --- | --- |
| E-mail | `clara@eco.app` |
| Senha | `eco1234` |
| Bairro | Boa Vista |
| Código dos parceiros (conferência de cupom) | `1234` |

A carga é a mesma do modo local do app (`local_seed.dart`): 6 ações, 4 desafios,
6 parceiros, 12 recompensas, a meta coletiva de 400 ações por semana, 14 dicas,
os pontos de coleta de `src/data/pontos-de-coleta-rio-preto.json`, a Clara e 18
vizinhos fictícios em bairros reais. O histórico é gerado **passando pelas mesmas
funções de regra das rotas** (limites, teto, desafios e conquistas), relativo ao
momento da carga. Em uma quarta-feira à tarde a Clara fica com 375 dos 400 pontos
da semana, um desafio em andamento (3 de 7), um concluído e cupons ativo, usado e
vencido.

### Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Sobe com `node --watch` |
| `npm start` | Sobe sem watch |
| `npm run seed` | Apaga e recria os dados de demonstração. Com `NODE_ENV=production` é recusado; use `npm run seed -- --force` se for isso mesmo |
| `npm test` | Testes de integração com `node --test` (banco em memória, porta aleatória) |

---

## ⚙️ Variáveis de ambiente

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3100` | Porta HTTP |
| `HOST` | `127.0.0.1` | Endereço em que a API escuta. `0.0.0.0` (ou `::`) abre a API para a rede: qualquer aparelho conectado a ela pode chamá-la |
| `NODE_ENV` | `development` | Lido sem diferenciar maiúsculas; `prod` vale como `production`. Veja as regras abaixo |
| `JWT_SECRET` | *(vazio)* | Obrigatório em produção. Segredos de exemplo (os do repositório e textos como `change-me`) são recusados em qualquer ambiente, menos `test`. Menos de 32 caracteres só com `NODE_ENV` `development` ou `test`. Vazio fora de produção: a API gera um segredo aleatório e o guarda em `.jwt-secret` ao lado do banco (com `DB_PATH=:memory:`, um segredo por processo) |
| `JWT_EXPIRES_IN` | `7d` | Validade do token |
| `BCRYPT_ROUNDS` | `10` | Custo do bcrypt (4 a 15) |
| `RESET_CODE_TTL_MINUTES` | `30` | Validade do código de recuperação |
| `EXPOSE_RESET_CODE` | `false` | `true` devolve o código de recuperação na resposta (`devCode`), para testes e demonstração. **Só é aceito com `NODE_ENV` escrito como `development` ou `test`**; com qualquer outro valor (inclusive vazio) a API não sobe |
| `AUTH_RATE_LIMIT_MAX` | `10` | Tentativas por IP + e-mail na janela (por IP: 5 vezes isso) em `register`, `login`, `forgot-password`, `reset-password` e `change-password` |
| `AUTH_RATE_LIMIT_WINDOW_MINUTES` | `15` | Janela do limitador |
| `WEEKLY_POINTS_CAP` | `400` | Teto semanal de pontos de ações |
| `TRUST_PROXY` | `false` | Atrás de proxy, para o limitador ver o IP real: o número de proxies na frente da API (normalmente `1`) ou a lista de IPs/sub-redes deles, separados por vírgula (`loopback, 10.0.0.0/8`). `false`, `0` ou vazio desliga. Nunca confia em todos: o valor antigo `true` vale como `1` (confiar em todos deixaria o cliente escolher o próprio IP pelo `X-Forwarded-For` e escapar do limitador) |
| `DB_PATH` | `<repo>/data/eco.db` | Arquivo SQLite |
| `CORS_ORIGIN` | `*` | Origens permitidas, separadas por vírgula |

Valores inválidos interrompem a inicialização (`src/config.js`).

**Ambientes.** As opções perigosas são liberadas só para quem pede
desenvolvimento ou teste, em vez de bloqueadas só em produção: um `NODE_ENV`
escrito de outro jeito (`homologacao`, `staging`) ou vazio nunca libera nada.

| `NODE_ENV` | `JWT_SECRET` vazio | Segredo de exemplo | Segredo com menos de 32 caracteres | `EXPOSE_RESET_CODE=true` |
| --- | --- | --- | --- | --- |
| `development` | gera um aleatório | recusado | aceito | aceito |
| `test` | gera um aleatório | aceito | aceito | aceito |
| vazio (padrão) ou outro nome | gera um aleatório | recusado | recusado | recusado |
| `production` ou `prod` | recusado | recusado | recusado | recusado |

Um `npm start` sem `.env` continua funcionando para desenvolvimento (segredo
aleatório guardado em `data/.jwt-secret`). Um `.env` antigo com
`JWT_SECRET=change-me-to-a-long-random-string` faz a API recusar a subida:
apague o valor ou gere um segredo próprio.

---

## 📏 Regras de negócio (resumo)

O raciocínio de cada número está em `ECONOMIA-DE-PONTOS.md`, na pasta acima dos
dois repositórios. Código: `src/services/economy.js` (espelho de `economy.dart`).

- **Fuso:** horário de Brasília fixo (UTC−3). Dia, mês, semana e sequência usam o
  dia local; cada registro guarda `local_date`.
- **Ações:** pontos por esforço e impacto; limite por dia (ou por semana, no
  mutirão). Quantidade inteira de 1 a 50.
- **Teto semanal:** 400 pontos de ações por semana (segunda 00:00 a domingo
  23:59 em Brasília). Passou do teto, a ação é registrada com os pontos que cabem
  (`points`) e guarda o valor cheio (`base_points`); conta para desafios,
  conquistas, litros e sequência.
- **Bônus** de desafio concluído (`kind = 'challenge'`) e de conquista
  (`kind = 'achievement'`) não entram no teto nem contam como ação.
- **Níveis** pelos pontos ganhos (não caem ao gastar): Semente 0, Broto 300,
  Muda 1.000, Árvore 2.500, Floresta 6.000.
- **Conquistas:** 10 selos com critérios reais (sequência de dias, litros, dias
  com ação de Água etc.), gravados em `user_achievements` com a data, com crédito
  do bônus e notificação.
- **Desafios:** avançam sozinhos ao registrar ação da categoria (`days`: uma
  etapa por dia; `actions`: pela quantidade). Prazo pessoal de `duration_days`
  a partir da entrada; vencido pode ser recomeçado. `participants` = base +
  quem entrou.
- **Cupons:** preço = valor do benefício × 50 pontos por real (itens digitais
  com 20% de desconto). Limite por pessoa em 30 dias, validade por recompensa,
  situação calculada (`active`, `used`, `expired`) e conferência com o código
  do parceiro.
- **Privacidade:** a posição de uma pessoa é o centro do bairro com um
  deslocamento fixo de algumas centenas de metros (mesmo cálculo do app); o
  endereço completo e o e-mail nunca saem nas rotas de comunidade; quem desliga
  `privacyLocation` some do mapa dos outros e aparece no ranking sem o bairro
  (`neighborhood: null`; a própria pessoa continua vendo o seu). Quem desliga
  `privacyProfile` ("Perfil visível para a comunidade") aparece para os outros
  como **"Alguém do bairro"**, com as iniciais `•`, nas publicações, nos
  comentários, no texto dos avisos que vão para outras pessoas (como "Alguém do
  bairro comentou na sua publicação."), no ranking da semana e nos vizinhos do
  mapa. Não some de nenhum lugar, e pontos e posição não mudam; a própria pessoa
  sempre se vê com o nome real. A regra vale na hora da leitura, pela preferência
  atual do autor (o autor é buscado pelo id, não pela cópia do nome gravada na
  publicação): ligar de novo traz o nome de volta. Os avisos já gravados ficam com
  o texto do momento em que foram criados. Regra em `publicIdentity`
  (`src/services/util.js`).

---

## 🔌 Endpoints

Todas as rotas ficam sob `/api` e respondem JSON; erros vêm como
`{ "error": "..." }`. Ids na URL (`:id`) só valem na forma canônica, um inteiro
positivo sem zeros à esquerda (`3`); `03`, `3.0` ou `+3` respondem como id
inexistente. Exceto `health`, `register`, `login`, `forgot-password`,
`reset-password` e `places/neighborhoods`, todas exigem
`Authorization: Bearer <token>`.

### Auth — `/api/auth`

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/register` | `name`, `email`, `password` e, opcionais, `cep`, `street`, `number`, `complement`, `neighborhood`, `city`, `state` (limitado) |
| `POST` | `/login` | `{ token, user }` (limitado) |
| `GET` | `/me` | Usuário autenticado |
| `POST` | `/forgot-password` | Mesma resposta com e sem conta (limitado; no máximo 3 códigos novos por conta por hora) |
| `POST` | `/reset-password` | `email`, `code`, `password`; invalida as sessões antigas (limitado; no máximo 10 códigos errados por conta em 24 horas) |
| `POST` | `/change-password` | **Novo.** `currentPassword`, `newPassword`; devolve um token novo e encerra as outras sessões |

O usuário devolvido traz `city`, `address` (só para ele mesmo) e `location`
(posição aproximada).

### Usuário — `/api/users`

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/me` | `user` + `summary` + `achievements` |
| `PATCH` | `/me` | `name` (2–80), `neighborhood` (até 80; recalcula a posição), campos de endereço, `monthlyGoal` e `weeklyGoal` (inteiros de 1 a 100). Trocar o nome atualiza publicações e comentários |
| `PATCH` | `/me/preferences` | `notificationsEnabled`, `remindersEnabled`, `privacyProfile`, `privacyLocation` |

### Ações, registros e progresso

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/actions` | Catálogo com `dailyLimit`, `weeklyLimit`, `usedToday`, `usedThisWeek`, `remaining`, `neighborsToday` (`?category=`, `?search=`, `?sort=points\|alphabetical`) |
| `GET` | `/actions/:id` | Detalhe |
| `POST` | `/actions/:id/records` | `{ quantity?, notes? }` → `{ record, capReached, challengeUpdates, newAchievements, summary, achievements }`; 409 ao passar do limite da ação; 400 se vier `photo` (veja abaixo) |
| `GET` | `/records` | Histórico (`?limit=` 1–500), com `kind`, `basePoints`, `capped` e `photo` |

**Foto de comprovação:** o servidor ainda não guarda fotos. Todo registro volta
com `photo: null`, e um registro enviado com `photo` preenchido é recusado com
400 e uma mensagem dizendo que, por enquanto, a foto só funciona no modo local
do app (em vez de a foto ser descartada sem aviso). No modo online o app esconde
os controles de foto e não manda o campo.
| `GET` | `/progress` | `summary` + `achievements` |
| `GET` | `/progress/achievements` | As 10 conquistas |

O `summary` traz `points`, `pointsEarned`, `pointsSpent`, `actionsCount`,
`activeDays`, `monthlyActions`, `monthlyGoal`, `monthlyGoalProgress`,
`litersSaved`, `level`, `levelNumber`, `levelName`, `levelFloor`, `nextLevelAt`,
`weeklyPoints`, `weeklyCap`, `weeklyRemaining`, `weekResetsAt`, `streakDays` e
`bestStreak`.

### Desafios — `/api/challenges`

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/` | Com `stepMode`, `durationDays`, `daysLeft`, `expired`, `stepDoneToday`, `endsAt`, `completedAt`, `participants` |
| `GET` | `/:id` | Detalhe |
| `POST` | `/:id/join` | Entra (ou recomeça um desafio vencido) |
| `POST` | `/:id/progress` | **Removido:** responde 410 (o desafio avança sozinho) |

### Notificações — `/api/notifications`

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/` | 100 mais recentes (com `target`, a tela do app) + `unreadCount` de todas |
| `POST` | `/read-all` | Marca todas como lidas |
| `PATCH` | `/:id/read` | Marca como lida; `{ "read": false }` desmarca |
| `DELETE` | `/:id` e `/` | Remove uma ou todas |

Categorias: `sistema`, `conquista`, `desafio`, `comunidade` e `recompensa`.

### Comunidade e bairro

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/community/posts` | Feed (últimos 100) com `isMine`, curtidas e comentários |
| `POST` | `/community/posts` | Publica (3–1000) |
| `POST` | `/community/posts/:id/like` | Alterna a curtida |
| `GET`/`POST` | `/community/posts/:id/comments` | Lista ou comenta (até 500) |
| `DELETE` | `/community/posts/:id` | Só o autor |
| `GET` | `/community/stats` | **Novo.** Membros, vizinhos ativos (7 dias), ações de hoje e da semana, litros e pontos da semana, meta coletiva, ranking dos 5 primeiros (nome curto) e a posição do usuário |
| `GET` | `/community/map` | **Novo.** Centro, o próprio usuário, vizinhos que aceitaram aparecer (posição aproximada, nome curto) e pontos de coleta com coordenada |
| `GET` | `/collection-points` | **Novo.** Pontos de coleta com `distanceMeters`, do mais perto ao mais longe (`?type=`, `?search=`) |
| `GET` | `/places/neighborhoods` | **Novo.** Busca de bairros para o cadastro (`?search=`). **Pública:** o cadastro usa antes do login |
| `GET` | `/tips/today` | **Novo.** Dica do dia |

### Recompensas — `/api/rewards`

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/` | Ativas, com `valueCents`, `validityDays`, `perUserLimit`, `redeemedByMe`, `limitReached`, `partnerAddress` (`?category=`, `?search=`, `?sort=points\|points_desc\|alphabetical`) |
| `GET` | `/:id` | Detalhe |
| `POST` | `/:id/redeem` | Resgata (em transação): 404, ou 409 se esgotada, sem saldo ou no limite |
| `GET` | `/redemptions` | Cupons com `status`, `expiresAt`, `usedAt` + `summary` |
| `POST` | `/redemptions/:id/use` | **Novo.** `{ pin }` do parceiro: 403 código errado, 409 usado ou vencido, 404 de outra pessoa; 429 (com `Retry-After`) depois de 5 códigos errados no mesmo cupom em 15 minutos |

### Exemplos

```bash
curl http://127.0.0.1:3100/api/health

curl -X POST http://127.0.0.1:3100/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"clara@eco.app","password":"eco1234"}'

curl -X POST http://127.0.0.1:3100/api/actions/4/records \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"quantity":1}'
```

---

## 🗄️ Banco e migrações

`PRAGMA user_version` guarda a versão do esquema. Na inicialização,
`src/migrations.js` aplica as migrações que faltam, cada uma numa transação:

- **Versão 1:** o esquema original (ramo `main`).
- **Versão 2:** teto, limites, conquistas, desafios com prazo, cupons com
  validade, endereço e posição, segurança e as tabelas do bairro. Preenche os
  dados existentes: `kind`, `base_points = points`, `local_date` em UTC−3,
  `expires_at = created_at + 30 dias`, `used_at`, `joined_at`, posição
  aproximada dos usuários e o hash dos códigos de recuperação pendentes.

Um banco novo passa pelas duas migrações, então banco novo e banco antigo
migrado chegam ao mesmo esquema (há um teste para isso). Para mudar o esquema,
acrescente uma migração no fim da lista; nunca edite uma que já foi aplicada.

**Dados de referência.** A migração só cria colunas e tabelas; um banco criado
pelo seed do ramo `main` ficaria com parceiros sem PIN (nenhum cupom poderia
ser conferido), ações sem limite e sem pontos de coleta, dicas e meta coletiva.
Por isso, a cada inicialização, logo depois das migrações, `src/referenceData.js`
completa o que falta, numa transação, a partir do catálogo do seed
(`src/catalog.js`):

- `collection_points` vazia recebe os pontos de
  `src/data/pontos-de-coleta-rio-preto.json`; `tips` vazia recebe as dicas do
  catálogo; sem nenhuma linha em `community_goals`, entra a meta coletiva padrão
  (400 ações por semana);
- ações com o título de uma ação do catálogo e **sem nenhum limite**
  (`daily_limit` e `weekly_limit` nulos) recebem os limites do catálogo; os
  pontos passam ao valor novo **só** se ainda forem o padrão antigo daquela ação
  (por exemplo 15 → 5 na torneira); um valor trocado à mão fica como está;
- recompensas e desafios com o título de um item do catálogo passam às regras
  novas campo a campo (recompensas: preço, `value_cents`, `validity_days`,
  `per_user_limit` e termos; desafios: bônus, `duration_days`, `step_mode` e
  descrição), **só** quando o campo ainda tem o valor antigo daquele item (o do
  seed do `main` ou o padrão que a migração 2 pôs). Por exemplo, o kit de
  sacolas vai de 400 para 1.500 pontos e ganha limite de 1 por pessoa, e o
  transporte ativo passa a contar trajetos (`actions`) em vez de dias. Um valor
  trocado à mão fica como está;
- **fora de produção**, parceiros com o nome de um parceiro do catálogo e PIN
  vazio recebem o PIN de demonstração (`1234`). **Em produção** esse PIN, que é
  público, não é gravado. Parceiros que continuam com PIN vazio ficam como estão
  e a API escreve um aviso no log com o nome deles (os cupons deles só podem ser
  conferidos depois que alguém definir o PIN na tabela `partners`).

Num banco que já tem esses dados (inclusive um recém-criado por `npm run seed`)
o passo não muda nada, e rodar de novo também não. Ele não mexe em usuários nem
registros, e não cria as recompensas do catálogo que o banco antigo não tinha.

Tabelas: `users`, `password_resets`, `actions`, `action_records`,
`notifications`, `challenges`, `challenge_progress`, `partners`, `rewards`,
`redemptions`, `posts`, `post_likes`, `post_comments`, `user_achievements`,
`collection_points`, `community_goals` e `tips`.

---

## 🔒 Segurança

O que existe:

- **Limite de tentativas** em memória para `register`, login,
  `forgot-password`, `reset-password` e `change-password`: por IP + e-mail e
  por IP; passou do limite, 429 com `Retry-After`. O limite por IP é conferido
  primeiro, o e-mail é guardado só como hash e o número de contadores tem teto
  (10.000 por rota; cheio, saem os vencidos e depois os mais antigos que não
  estão bloqueados; um bloqueio nunca sai antes de vencer). IPv6 conta pela rede
  /64.
- **Recuperação de senha por conta**, independente do IP: no máximo 3 códigos
  novos por conta a cada hora (passou disso, a resposta é a de sempre e nenhum
  código novo é criado; o pendente continua valendo) e no máximo 10 códigos
  errados por conta a cada 24 horas, somando todos os códigos (passou disso,
  `reset-password` responde "Código inválido ou expirado." sem conferir o
  código). As respostas continuam iguais para e-mail com e sem conta.
- **Conferência do cupom:** no máximo 5 códigos de parceiro errados por pessoa
  e cupom a cada 15 minutos (429 depois disso); o código certo não gasta
  tentativa.
- **Login** com e-mail sem conta compara a senha com um hash do mesmo custo
  (`BCRYPT_ROUNDS`), para o tempo de resposta não revelar quais e-mails existem.
- **Código de recuperação** de 6 dígitos guardado só como hash, válido por 30
  minutos e invalidado depois de 5 tentativas erradas. A resposta de
  `forgot-password` é a mesma para e-mail com e sem conta.
- **Sessões:** o token leva a versão de sessão do usuário (`token_version`);
  redefinir ou trocar a senha invalida todos os tokens antigos.
- **Segredo JWT:** em produção é obrigatório e longo; segredos de exemplo são
  recusados em todo ambiente, menos `test`; sem `JWT_SECRET` fora de produção,
  é aleatório (nunca um valor fixo e público).
- **Rede:** a API escuta só em `127.0.0.1`, a não ser que `HOST` diga outra coisa.
- **PIN de demonstração** (`1234`): os dados de referência não o gravam em
  produção.
- **Validação** de nome, e-mail, senha, bairro, CEP e metas
  (`src/services/validation.js`); JSON malformado → 400 e corpo acima de 1 MB → 413.
- `npm run seed` recusa rodar em produção sem `--force`.

O que **não** existe (limitações conhecidas):

- **Não há envio de e-mail.** O código de recuperação só chega a alguém com
  `EXPOSE_RESET_CODE=true` (demonstração). Fora disso, a recuperação de senha
  não funciona até integrar um provedor de e-mail.
- O limitador fica na memória do processo: zera ao reiniciar e não serve para
  várias instâncias. Atrás de proxy, defina `TRUST_PROXY` com o número de
  proxies (normalmente `1`) ou com os endereços deles.
- Não há verificação de e-mail no cadastro nem bloqueio de conta.
- O código de conferência dos parceiros é um PIN curto, digitado no aparelho de
  quem resgatou; serve para a demonstração, não como garantia contra fraude. As
  tentativas são limitadas (5 erradas por cupom a cada 15 minutos, na memória
  do processo), o que impede testar todos os códigos de uma vez, mas não
  substitui um PIN próprio e longo por parceiro. Em produção, cada parceiro
  precisa de um PIN definido à mão na tabela `partners`.
- Os limites por conta da recuperação de senha também ficam na memória do
  processo (zeram ao reiniciar).
- `CORS_ORIGIN` padrão é `*`; em produção, liste as origens.
- SQLite em arquivo único: não indicado para várias instâncias. Sem CI nem
  Dockerfile.

---

## 📁 Estrutura

```txt
eco-backend/
├── data/                      # SQLite e .jwt-secret (ignorados no Git)
├── src/
│   ├── data/                  # bairros (OpenStreetMap) e pontos de coleta
│   ├── middleware/            # auth (JWT + versão de sessão), rateLimit
│   ├── routes/                # auth, users, actions, records, progress,
│   │                          # notifications, challenges, community, rewards, places
│   ├── services/
│   │   ├── economy.js         # teto, níveis, fuso e datas
│   │   ├── clock.js           # relógio injetável (testes e seed)
│   │   ├── places.js          # bairros, posição aproximada e distância
│   │   ├── actions.js         # catálogo e registro de ações
│   │   ├── progress.js        # resumo e conquistas
│   │   ├── challenges.js      # desafios
│   │   ├── rewards.js         # recompensas e cupons
│   │   ├── community.js       # feed, estatísticas, mapa, pontos de coleta, dica
│   │   ├── users.js           # contas e perfil
│   │   ├── validation.js      # validação dos dados de conta
│   │   ├── notifications.js, util.js, errors.js
│   ├── migrations.js          # esquema versionado (PRAGMA user_version)
│   ├── catalog.js             # catálogo do seed (ações, parceiros, dicas, meta, pontos de coleta)
│   ├── referenceData.js       # completa um banco antigo na inicialização
│   ├── app.js, config.js, db.js, seed.js, server.js
└── test/                      # node:test, banco em memória, porta aleatória
    ├── local-api.test.js      # casos do modo local do app, portados
    ├── security.test.js, migrations.test.js, config.test.js
    ├── reference-data.test.js # banco antigo em arquivo (porta aleatória)
    └── auth, users, actions, progress-notifications, challenges, community,
        rewards, cors
```

---

## 🗺️ Dados e créditos

- **Bairros** (`src/data/bairros-rio-preto.json`): © colaboradores do
  [OpenStreetMap](https://www.openstreetmap.org/copyright), licença
  [ODbL](https://opendatacommons.org/licenses/odbl/). O mapa do app deve exibir
  a atribuição "© colaboradores do OpenStreetMap" (a rota `/community/map` a
  devolve em `attribution`).
- **Pontos de coleta** (`src/data/pontos-de-coleta-rio-preto.json`): cada ponto
  traz a própria fonte (`source_url`, `source_date`, `confidence`).

Projeto acadêmico **EcoViva** — API em Node.js, Express e SQLite.
