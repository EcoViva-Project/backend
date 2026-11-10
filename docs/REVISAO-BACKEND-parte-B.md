# Revisão do backend — parte B (regras de negócio)

Revisão independente, só leitura, do ramo `polimento` de `eco-backend` (commit `2ae9aa5`), feita em 10/11/2026.
Escopo: economia de pontos, ações, progresso e conquistas, desafios, recompensas e cupons, comunidade,
notificações, catálogo, seed e dados de referência, e a comparação com o modo local do app
(`eco-app/lib/core/local`). Autenticação, autorização, validação genérica, limite de requisições,
migrações e configuração ficaram com o outro revisor; só aparecem aqui quando mudam uma regra de negócio.

## 1. Como a revisão foi feita

- Leitura completa, função por função, de `src/services/{economy,actions,progress,challenges,rewards,community,notifications,clock,util}.js`,
  `src/catalog.js`, `src/seed.js`, `src/referenceData.js`, das rotas de ações, desafios, recompensas, comunidade,
  notificações, registros e progresso, e das partes correspondentes de `local_api.dart`, `local_seed.dart`,
  `economy.dart`, `places.dart` e `local_store.dart`.
- `npm test`: **145 testes, 145 passaram, 0 falhas** (26 suítes, ~56 s).
- Execução real da API: seis scripts (pasta de rascunho da sessão, `revisao-backend-b/exp1.js` a `exp6.js`) que
  carregam o app com `DB_PATH=:memory:` e `NODE_ENV=test` via `test/helpers.js`, escutam em porta aleatória e
  fixam o relógio por `src/services/clock.js`. Fusos do processo testados: o da máquina (UTC−3),
  `Asia/Tokyo` (UTC+9), `Pacific/Kiritimati` (UTC+14) e `UTC`. Nenhum banco de arquivo foi aberto e nada foi alterado nos dois repositórios.
- Nenhum texto dos arquivos lidos trazia instruções dirigidas ao revisor.

## 2. Regra por regra

| Regra | Servidor cumpre? | Como conferi | Modo local faz igual? |
|---|---|---|---|
| Teto semanal de 400 pontos de ações; bônus fora do teto | Sim | Execução: 360 + 60 → credita 40; 399 + 5 → 1; 395 + 5 → 5 (exato); 400 + 5 → 0; 375 + mutirão → 25. Bônus de desafio e conquista não entram em `weeklyPoints` | Sim (mesmo código, `local_api.dart:1219-1242`) |
| Teto atingido: registra sem pontos ou com a parte que cabe; aviso uma vez | Sim | Execução: `capped` e `capReached` corretos; aviso "Teto semanal atingido" só quando cruza o teto | Sim |
| Semana vira segunda 00:00 de Brasília, independente do fuso do servidor | Sim | Execução com processo em Tóquio e Kiritimati: mutirão domingo 23:59 BRT e segunda 00:00 BRT aceitos; reciclagem 21:30 BRT de segunda recusada (dia não virou às 00:00 UTC); `weekResetsAt` = 03:00 UTC | Sim (`economy.dart` usa o mesmo deslocamento fixo) |
| Pontos 5, 5, 15, 25, 30, 100 e limites 2/dia, 1/dia, 1/dia, 1/dia, 2/dia, 1/semana | Sim | Leitura de `catalog.js:18-115` (água 5 2/dia, luzes 5 1/dia, reciclagem 15, compostagem 25, transporte 30 2/dia, mutirão 100 1/semana) e execução | Sim (mesmo catálogo) |
| Quantidade inteira, positiva, sem burlar limite | Sim | Execução: 0, −1, 1.5, "2", true → 400; 3 numa ação 2/dia → 409; `null` → vale 1 | Sim (`rawQuantity is! int`) |
| Requisições simultâneas | Sim | Execução: 10 registros simultâneos numa ação 2/dia → 2×201 e 8×409; 6 resgates simultâneos com saldo para 2 → 2×201, 4×409, saldo final correto. Os manipuladores são síncronos (better-sqlite3), não há intercalação | Registro: sim. Resgate: ver B11 (suspeita) |
| Saldo = ganhos − gastos; nível pelos ganhos, nunca cai | Sim | Execução: sequência de 400 operações (ações, desafios, resgates) → resumo bate com `SUM(points)` e `SUM(points_spent)` do banco; nível usa `pointsEarned` | Sim |
| Níveis Semente/Broto/Muda/Árvore/Floresta em 0/300/1.000/2.500/6.000 | Sim | Leitura `economy.js:27-33` | Sim |
| Cupons: 50 pontos por R$ 1, digitais −20% | Sim (banco novo) | Conferi os 12 cupons do catálogo: todos batem (ex.: skin R$ 20 → 800; passe R$ 40 → 1.600). Banco antigo migrado: não (B3) | Sim |
| Validade, estados disponível/usado/vencido | Sim | Execução: após 39 dias, um cupom `used` e outro `expired`; vencido e usado recusam conferência (409) | Sim |
| Conferência pelo código do parceiro, sem adivinhação | **Parcial** | Execução: limite de 5 erros por cupom existe, mas é contornável (B1); o código é `1234` para todos os parceiros e é gravado também em banco existente (B2) | Modo local não tem limite de tentativas nenhum |
| Resgate exige saldo, estoque e limite por pessoa | Sim | Execução e leitura: tudo dentro de uma transação; estoque não fica negativo; limite conta 30 dias | Sim |
| Desafio avança sozinho, prazo pessoal, bônus uma vez | Sim, com ressalva | Execução: 4 desafios concluídos → 4 bônus (410 pontos), entrar de novo num concluído não muda nada. Ressalva: desafio de 7 dias pode ficar impossível (B6) | Sim, inclusive a ressalva |
| Conquistas: bônus uma vez, com data | Sim | Execução: 10 conquistas, 10 bônus (770 pontos); `UNIQUE (user_id, achievement_key)` impede repetição | Sim |
| Foto: só selo, nunca muda pontos | Sim no servidor, mas **o servidor não tem foto** | Execução: `photo` é aceito e descartado em silêncio; o registro volta sem o campo `photo` (B5) | App guarda e mostra o selo |
| Comunidade: vizinhos ativos, ações de hoje e da semana, meta de 400, top 5, nomes abreviados | Sim | Execução com a demonstração (quarta 15h): 19 membros, 19 ativos, 45 hoje, 157 na semana (157/400, igual ao app), ranking "Juliana P.", "Marina L."... | Sim, mesmos números |
| Quem desligou "aparecer no mapa" some do mapa e fica sem bairro no ranking | Sim | Execução: usuário com `privacyLocation=false` não aparece em `/community/map` e tem `neighborhood: null` no ranking | Sim |
| Posição exata nunca devolvida a outros | Sim | Leitura: a posição gravada é sempre centro do bairro + deslocamento fixo por e-mail (`places.js:230-240`); o cliente não consegue enviar coordenadas | Sim |

## 3. Achados

Nenhum achado crítico ou alto: as regras centrais (teto, limites, saldo, nível, bônus únicos, estoque, validade)
estão certas e resistem a quantidade inválida e a requisições simultâneas.

### B1 — Limite de tentativas do código do parceiro é contornável
- Gravidade: **média** · Certeza: **confirmado por execução**
- Arquivo: `src/routes/rewards.js:38`
- O contador usa o texto cru do id da URL (`${user}|${req.params.id}`), mas o SQLite aceita `3`, `03`, `003`...
  como o mesmo cupom. Cada grafia nova ganha mais 5 tentativas, então não há limite real.
- Reproduzir: entrar como Clara; `POST /rewards/redemptions/3/use` com PIN errado 5 vezes (403); depois
  `/rewards/redemptions/03/use`, `/003/use`... Resultado: 34 respostas 403 seguidas, nenhuma 429, e o
  `0000003` com `1234` voltou 200.
- Correção: converter o id para inteiro (`/^\d+$/`, `Number`) antes de montar a chave, e contar também por
  usuário (todas as conferências dele) para que muitos cupons não multipliquem as tentativas. Tamanho: **P**.

### B2 — Código `1234`, igual para todos os parceiros, gravado também em banco existente
- Gravidade: **média** · Certeza: **confirmado por execução**
- Arquivos: `src/catalog.js:13`, `src/referenceData.js:89-91`
- O passo de dados de referência roda a cada inicialização, inclusive com `NODE_ENV=production`, e põe `1234`
  em todo parceiro do catálogo que estiver sem PIN, sem avisar no log (o aviso só sai para parceiros fora
  do catálogo). O código é público (está no repositório) e é o mesmo para todos. Junto com B1, qualquer
  cliente pode marcar o próprio cupom como usado sem o parceiro.
- Reproduzir: banco no esquema do `main` com o parceiro "Mercado Verde" sem PIN → `migrate` +
  `ensureReferenceData` → `pin = '1234'`, `withoutPin: []`, nenhum aviso.
- Correção: em produção, gerar um PIN aleatório por parceiro e escrevê-lo uma vez no log (ou exigir que o
  dono o defina); manter `1234` só na demonstração. Tamanho: **P**.

### B3 — Banco antigo migrado fica com cupons e desafios nas regras antigas
- Gravidade: **média** (só importa se existir um banco criado pelo `main` em uso) · Certeza: **confirmado por execução**
- Arquivo: `src/referenceData.js:50-97` (completa ações, parceiros, dicas, meta e pontos de coleta, mas não
  recompensas nem desafios)
- Depois de migrar e rodar os dados de referência, "Kit de sacolas reutilizáveis" continua custando **400**
  (a regra dá 1.500), com `value_cents = 0` e **sem limite por pessoa**. "Transporte ativo no bairro" fica
  com `step_mode = 'days'` (conta dias, não trajetos), e os bônus dos desafios continuam 120/150/180 em vez de
  100/60/150.
- Reproduzir: o script `exp4.js` monta um banco com o esquema 1, insere a recompensa e o desafio como no
  seed do `main`, chama `migrate` e `ensureReferenceData` e lê as linhas.
- Correção: estender `ensureReferenceData` às recompensas (pelo título: `value_cents`, `per_user_limit`,
  `validity_days` e o preço quando ainda for o antigo) e aos desafios (`step_mode`, `duration_days`,
  `points_reward` quando ainda for o antigo), com teste. Tamanho: **M**.

### B4 — "Perfil visível para a comunidade" desligado não esconde nada
- Gravidade: **média** (promessa de privacidade não cumprida) · Certeza: **confirmado por execução**
- Arquivos: `src/services/community.js:214-227` (ranking) e `:100-110` (publicação); no app,
  `local_api.dart:1685-1700` e `:1565-1568`; o texto da promessa está em
  `eco-app/lib/features/preferencias/presentation/pages/preferencias_page.dart:106-111` ("Seu nome e suas
  publicações aparecem para os vizinhos").
- `privacy_profile` é gravado e devolvido, mas nenhuma regra o lê.
- Reproduzir: usuário "Pedro Privado Silva" com `privacyProfile: false` e 399 pontos na semana → no
  `/community/stats` de outra pessoa aparece `{"position":1,"name":"Pedro S.",...}` e a publicação dele aparece
  com o nome completo.
- Correção: decidir o comportamento com o dono (ex.: no ranking mostrar "Vizinho(a)" e iniciais neutras;
  nas publicações, nome abreviado) ou tirar o interruptor da tela. Tamanho: **M** (os dois lados).

### B5 — Servidor descarta a foto de comprovação em silêncio
- Gravidade: **média** (divergência visível no modo online) · Certeza: **confirmado por execução**
- Arquivos: `src/routes/actions.js:27-46` e `src/services/actions.js:129-145`; o app manda `photo` em
  `eco-app/lib/core/services/action_history_service.dart:196`.
- `POST /actions/5/records` com `{"photo":"foto_1.jpg"}` → 201, registro sem campo `photo`; com
  `{"photo":"../../etc/passwd"}` também 201 (o app local recusa com 400). No modo online o selo some e a
  pessoa não é avisada. Os pontos não mudam (a regra "foto não muda pontos" vale por omissão).
- Correção: implementar `record_photos` como no app (mesma validação do nome e `photo` no `recordJson`) ou
  devolver 400/aviso dizendo que a foto não é guardada no modo online. Tamanho: **M**.

### B6 — Desafio de 7 dias pode nascer impossível
- Gravidade: **baixa** · Certeza: **confirmado por execução** (o app tem o mesmo código)
- Arquivos: `src/services/challenges.js:22-29` e `:117-143`; no app, `local_api.dart:1332-1338` e `:1443-1470`
- O prazo conta o dia da entrada, mas ações registradas antes de entrar não contam. Quem registra as 2 águas
  do dia e só então entra em "Semana sem desperdício de água" (7 etapas em 7 dias) não consegue concluir, e a
  tela mostra 7 dias restantes.
- Reproduzir: segunda 09:00, água ×2, entrar no desafio 1, registrar água às 20h de cada dia → etapas
  0,1,2,3,4,5,6 e no 8º dia `expired` com 6/7.
- Correção: ao entrar, contar a etapa do dia se já houve ação da categoria hoje (e marcar
  `last_step_date`), ou começar o prazo no dia seguinte quando a entrada for depois de esgotar o dia. Tamanho: **P**.

### B7 — `npm run seed` apaga um banco com usuários reais fora de produção
- Gravidade: **baixa** · Certeza: **confirmado por leitura** (não executado contra banco de arquivo, por regra)
- Arquivo: `src/seed.js:101-104` e `:463-470`; `NODE_ENV` padrão é `development` (`src/config.js:131`)
- A única trava é `NODE_ENV=production`. Um servidor rodado sem essa variável (o `.env` de exemplo pode não
  tê-la) apaga tudo em `data/eco.db` sem perguntar.
- Correção: recusar quando houver usuário que não seja da demonstração (`clara@eco.app` ou
  `@demo.ecoviva`), salvo `--force`. Tamanho: **P**.

### B8 — Mapa e pontos de coleta sem paginação nem cache
- Gravidade: **baixa** · Certeza: **confirmado por execução**
- Arquivos: `src/services/community.js:300-367`
- `/community/map` devolve 155 KB e `/collection-points` 153 KB a cada chamada (264 pontos com todas as
  colunas, `JSON.parse` dos materiais por linha); a lista `neighbors` do mapa cresce com o número de usuários,
  sem limite. Hoje responde em ~18 ms; o custo é de rede no celular.
- Correção: no mapa, só id, nome, tipo e coordenadas (detalhe sob demanda), `ETag`/cache, e limitar vizinhos por
  raio ou quantidade. Tamanho: **M**.

### B9 — "Números do bairro" são da cidade inteira
- Gravidade: **baixa** · Certeza: **confirmado por leitura** (o app faz igual; `ECONOMIA-DE-PONTOS.md` diz que é intencional)
- Arquivo: `src/services/community.js:182-266`
- A resposta traz `neighborhood` do usuário, mas `members`, `activeNeighbors`, `actionsToday`, a meta e o
  ranking somam todos os usuários; `activeNeighbors` e `members` incluem a própria pessoa. Se a tela diz
  "no seu bairro", o número engana.
- Correção: ajustar o texto da tela ("na comunidade") ou filtrar por bairro. Tamanho: **P** (texto).

### B10 — Contagem por registro, não por unidade, em parte dos números
- Gravidade: **baixa** · Certeza: **confirmado por leitura** (igual no app)
- Arquivos: `src/services/progress.js:56-64` (`actionsCount`, `monthlyActions`), `src/services/community.js:185-192`
  e `:255-257` (meta e ações de hoje)
- Dois trajetos registrados juntos (`quantity: 2`) contam 2 para "Mobilidade Ativa" e para o desafio, mas 1
  para a meta mensal, a meta coletiva e "ações hoje".
- Correção: decidir uma regra e usar `SUM(quantity)` onde for unidade. Tamanho: **P**.

### B11 — Resgate no modo local tem uma brecha de corrida
- Gravidade: **baixa** · Certeza: **suspeita** (por leitura; não executei o app)
- Arquivo: `eco-app/lib/core/local/local_api.dart:1996-2017`
- Entre a baixa do estoque (`await db.update`) e a gravação do cupom (`await db.insert`) há um `await`; uma
  segunda chamada nesse intervalo vê o saldo sem o gasto da primeira. O botão da tela trava com `_busy`
  (`eco-app/lib/core/services/reward_service.dart:408`), então só aparece se outra parte do app chamar o
  resgate em paralelo.
- Correção: gravar o cupom antes de qualquer `await`, ou guardar uma trava dentro do `LocalApi`. Tamanho: **P**.

### B12 — Na versão web do app, a demonstração e as posições podem sair diferentes
- Gravidade: **baixa** · Certeza: **suspeita** (por leitura; não executei Flutter web)
- Arquivos: `eco-app/lib/core/local/local_seed.dart:815` e `eco-app/lib/core/local/places.dart:228`
- No web, `int` do Dart é um `double` do JavaScript: `state * 1103515245` e `hash * 0x01000193` passam de
  2^53 e perdem os bits baixos. O sorteio dos vizinhos e o deslocamento da posição no mapa ficam diferentes
  do Android e do servidor. Não quebra regra; só muda os números da demonstração no navegador.
- Correção: multiplicação em 32 bits (dividir em partes de 16 bits) nas duas funções. Tamanho: **P**.

### B13 — Teto configurável só no servidor
- Gravidade: **baixa** · Certeza: **confirmado por leitura**
- Arquivo: `src/config.js:179` (`WEEKLY_POINTS_CAP`) contra `eco-app/lib/core/local/economy.dart` (fixo 400)
- Se alguém mudar a variável, o servidor e o app passam a dar pontos diferentes. O `ROOM_BELOW_CAP` do seed e
  os testes assumem 400.
- Correção: fixar 400 no servidor também, ou devolver o teto no resumo e fazer o app usar só o valor do
  servidor (já vem em `weeklyCap`). Tamanho: **P**.

### B14 — Demonstração recriada na segunda de madrugada fica estranha
- Gravidade: **baixa** · Certeza: **confirmado por execução** (o app gera o mesmo)
- Arquivos: `src/seed.js` (`seedNeighbors`, `seedNotifications`)
- Recriada na segunda 00:05, a conta tem 50/400 na semana, mas recebe o aviso "Você está perto do teto da
  semana" de 40 min atrás, e os vizinhos somam 45 ações "hoje" nos 5 primeiros minutos do dia. Na quarta da
  feira está tudo coerente (375/400, 157 ações).
- Correção: só criar o aviso do teto se `weeklyPoints >= 300`; limitar as ações de hoje dos vizinhos ao tempo
  decorrido. Tamanho: **P**.

## 4. Divergências entre servidor e modo local

| # | Ponto | Servidor | Modo local | Qual parece certo |
|---|---|---|---|---|
| 1 | Foto de comprovação | Ignora `photo`; registro sem campo `photo` (B5) | Valida o nome, grava `record_photos`, devolve `photo` | App |
| 2 | Tentativas do código do parceiro | 5 por cupom em 15 min (contornável, B1) | Sem limite | Servidor (com a correção de B1) |
| 3 | Banco antigo | Recompensas e desafios nas regras antigas (B3) | Não se aplica (o banco local sempre nasce do catálogo novo) | App |
| 4 | Filtros de `/rewards` | Aceita `category`, `search`, `sort` | Ignora a consulta | Indiferente (o app não usa) |
| 5 | Teto | Configurável por variável (B13) | Fixo 400 | App (regra decidida) |
| 6 | Senha das contas de figuração | Aleatória | Previsível (`figurante-<número>`) | Servidor; no app não importa (aparelho local) |
| 7 | Ordem dos comentários com o mesmo horário | Desempata por id | Só pelo horário | Servidor (diferença invisível na prática) |
| 8 | Resgate simultâneo | Atômico | Brecha com `await` (B11, suspeita) | Servidor |
| 9 | Números da demonstração na web | Iguais ao Android | Podem diferir no navegador (B12, suspeita) | Servidor/Android |

Fora isso, os dois lados deram o mesmo resultado em tudo que comparei: pontos, créditos parciais, mensagens
de erro e de notificação (texto idêntico), datas e semana de Brasília, arredondamento de `daysLeft`, estados dos
cupons, critérios e bônus das conquistas, ranking e meta. A demonstração na quarta 15h gera os mesmos números
nos dois lados (157 ações na semana, 19 membros; o teste do app `acoes_inicio_cadastro_test.dart:73` espera
os mesmos 157).

## 5. Conferido e correto

- Fuso: todas as datas usam UTC−3 fixo, não o fuso do processo; testado com o processo em UTC−3, UTC, UTC+9 e UTC+14.
- Teto exato, parcial e zerado; aviso de teto uma só vez; bônus fora do teto.
- Limites por dia e por semana, com quantidade; mensagens iguais ao app.
- Saldo e nível após 400 operações batem com o banco; nível não cai com gastos.
- Resgate: saldo, estoque e limite por pessoa dentro de uma transação; estoque nunca negativo; cupom usado ou
  vencido não é conferido de novo.
- Desafios: bônus creditado uma vez; concluído não reabre; vencido recomeça do zero sem bônus.
- Conquistas: 10 critérios iguais ao app, bônus uma vez, data gravada, protegido por índice único.
- Privacidade do mapa: posição sempre aproximada pelo bairro; quem desligou o mapa some do mapa e fica sem bairro no ranking.
- Seed: em seis instantes diferentes (segunda 00:05, segunda 09h, quarta 08h, quarta 15h, domingo 23:59,
  1º de dezembro) nenhuma semana de nenhum usuário passa de 400, nenhum limite diário é estourado e nenhum
  registro ou aviso fica no futuro; datas sempre relativas ao instante da carga.
- Índices: `action_records(user_id, kind, local_date)` e `(kind, local_date)` cobrem as agregações da semana e do dia;
  feed limitado a 100, notificações a 100, histórico a 500.

## 6. Lacunas de teste

- Limitador do PIN com o id escrito de outra forma (`03`) e com vários cupons do mesmo usuário (B1).
- Dados de referência em banco antigo para recompensas e desafios (B3).
- `privacyProfile: false` no ranking e no feed (B4).
- `photo` no registro pelo servidor (B5).
- Entrar num desafio de dias depois de já ter registrado a ação do dia (B6).
- Requisições simultâneas de registro e de resgate (o comportamento está certo, mas nenhum teste o protege).
- Virada de dia e de semana com o processo em outro fuso (os testes rodam no fuso da máquina, que já é UTC−3,
  então uma regressão para hora local passaria despercebida). Basta `process.env.TZ = 'Asia/Tokyo'` no início
  de um teste.
- Bordas exatas do teto: 395 + 5 (exatamente 400, `capped: false`, `capReached: true`) e 400 + 5.
- Seed em outros instantes além de quarta 15h (segunda 00:05 e domingo 23:59).
- `quantity` com valor de outro tipo (`"2"`, `true`) e `null`.

## 7. Para a feira de amanhã

A apresentação usa o modo local. Do que achei no servidor, o que existe igual no app e pode aparecer ao vivo:

1. **Interruptor "Perfil visível para a comunidade" não faz nada** (B4). Se alguém desligar e abrir a Comunidade,
   o nome continua no ranking e nas publicações. Lado do app: `eco-app/lib/core/local/local_api.dart:1685-1700`
   (ranking) e `:1565-1568` (publicação). Na feira, o mais seguro é não mostrar esse interruptor ou não
   prometer o efeito.
2. **Desafio "Semana sem desperdício de água" que não fecha** (B6). Um visitante que crie conta, registre a água
   duas vezes e só depois entre no desafio fica preso em 6/7. Lado do app: `local_api.dart:1332-1338` e
   `:1443-1470`. Para a conta da Clara não acontece: ela entrou na segunda 00:05 e na quarta está em 3/7.
3. **Contagem por registro** (B10): registrar "Deslocamento" com quantidade 2 soma 1 na meta coletiva e em
   "ações hoje", mas 2 em "Mobilidade Ativa". Lado do app: `local_api.dart:1715` e `:1729-1734`.
4. **Código do parceiro sem limite de tentativas no app** (divergência 2): `local_api.dart:2063-2066`. O código
   é `1234`; na feira isso é esperado, só não vale a pena dizer que o código é protegido.
5. Se a demonstração for mostrada **no navegador** em vez do celular, os números de vizinhos e as posições no
   mapa podem não ser os mesmos do Android (B12, suspeita).

Na quarta-feira à tarde, a conta da Clara chega com 375/400 na semana, saldo 3.115, nível Árvore, um cupom
ativo, um usado e um vencido; registrar "Apagar luzes" (5) leva a 380, e em seguida "Compostagem" (25) leva
a 400 com crédito parcial de 20 pontos e o aviso "Teto semanal atingido". O mutirão já foi registrado na terça
pela demonstração: tentar de novo dá a recusa "pode ser registrada 1 vez por semana" (não é defeito, mas
convém não usá-lo no roteiro). Conferi essa sequência no servidor, que gera a mesma demonstração que o app.

## O que não consegui verificar

- Não executei o app Flutter (nem Android nem web): a comparação com o modo local foi por leitura; B11 e B12 são suspeitas.
- Não rodei o seed nem a API contra um banco de arquivo real (por regra), então B7 é só por leitura.
- Não testei várias instâncias da API ao mesmo tempo; a garantia contra corridas depende de um processo só.
