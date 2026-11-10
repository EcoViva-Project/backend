# Revisão do backend — parte A (base e segurança)

Revisão independente, só leitura, do `eco-backend` no ramo `polimento` (commit `2ae9aa5`, 3 à frente de `origin/main`), feita em 10/11/2026. A parte B (regras de negócio) é de outro revisor.

## 1. Como a revisão foi feita

- Li inteiros, função por função: `src/app.js`, `server.js`, `config.js`, `db.js`, `migrations.js`, `referenceData.js`, `middleware/auth.js`, `middleware/rateLimit.js`, todas as `src/routes/*.js`, `services/users.js`, `places.js`, `validation.js`, `util.js`, `clock.js`, `errors.js`, além de `test/helpers.js`, `package.json`, `.env.example` e o README nas partes de configuração e segurança. Entrei em `services/community.js` e `services/rewards.js` só onde a privacidade e o limite de tentativas dependem deles.
- `npm test`: **145 testes, 145 passaram, 0 falharam** (26 suítes, cerca de 57 s).
- `npm audit --omit=dev`: **0 vulnerabilidades** (express 5.3.0, jsonwebtoken 9.0.3, bcryptjs 3.0.3, better-sqlite3 13.0.3, cors 2.8.6).
- Confirmei as suspeitas com a API rodando de verdade (banco em memória, `NODE_ENV=test`, porta aleatória).
- Banco antigo: exportei `origin/main` com `git archive` para o scratchpad, rodei o seed antigo num arquivo de lá e abri uma cópia com o código novo (`sondas3.js`). Nenhum arquivo dos repositórios foi alterado.

## 2. Rotas

Prefixo `/api`. "Dono" = a rota confere que o recurso é de quem chamou.

| Método | Caminho | Login? | Dono? | Valida entrada? | Observação |
| --- | --- | --- | --- | --- | --- |
| GET | /health | não | — | — | Pública, só a hora |
| POST | /auth/register | não | — | sim | Limite IP+e-mail; 409 revela e-mail existente (A17) |
| POST | /auth/login | não | — | sim | Limite conta também os logins certos (A8) |
| GET | /auth/me | sim | próprio | — | |
| POST | /auth/forgot-password | não | — | sim | Ativa sem envio de e-mail (A3) |
| POST | /auth/reset-password | não | — | sim | Sem limite por conta (A3) |
| POST | /auth/change-password | sim | próprio | sim | Não invalida o código de recuperação pendente (A10) |
| GET | /users/me | sim | próprio | — | |
| PATCH | /users/me | sim | próprio | parcial | Tipo errado apaga o campo sem avisar (A12) |
| PATCH | /users/me/preferences | sim | próprio | fraca | Qualquer valor diferente de `true` vira `false` (A11) |
| GET | /actions, /actions/:id | sim | — | sim | Filtros da query string sem SQL |
| POST | /actions/:id/records | sim | próprio | sim | `quantity` inteiro de 1 a 50 |
| GET | /records | sim | próprio | sim | `limit` limitado a 1–500 |
| GET | /progress, /progress/achievements | sim | próprio | — | |
| GET | /notifications | sim | próprio | — | |
| POST | /notifications/read-all | sim | próprio | — | |
| PATCH | /notifications/:id/read | sim | sim (404) | sim | |
| DELETE | /notifications/:id | sim | sim | — | Responde 200 mesmo sem apagar nada (A13) |
| DELETE | /notifications | sim | próprio | — | |
| GET | /challenges, /challenges/:id | sim | — | — | |
| POST | /challenges/:id/join | sim | próprio | — | |
| POST | /challenges/:id/progress | sim | — | — | 410 de propósito |
| GET | /community/stats | sim | — | — | Ranking com nome curto (A5, A6) |
| GET | /community/map | sim | — | — | Só quem aceitou aparecer no mapa, posição aproximada |
| GET/POST | /community/posts | sim | — | sim | Nome COMPLETO do autor (A5) |
| POST | /community/posts/:id/like | sim | — | — | |
| GET/POST | /community/posts/:id/comments | sim | — | sim | Nome completo (A5) |
| DELETE | /community/posts/:id | sim | sim (403) | — | |
| GET | /rewards, /rewards/:id | sim | — | sim | |
| GET | /rewards/redemptions | sim | próprio | — | |
| POST | /rewards/:id/redeem | sim | próprio | — | |
| POST | /rewards/redemptions/:id/use | sim | sim (404) | sim | Limite do PIN contornável (A2) |
| GET | /collection-points | sim | — | sim | |
| GET | /places/neighborhoods | não | — | sim | Pública de propósito, sem dado de pessoa |
| GET | /tips/today | sim | — | — | |

## 3. Achados (do mais grave ao menos grave)

### A1 — Travas de produção dependem de `NODE_ENV` ser exatamente `production`; fora disso, segredo JWT público e código de recuperação na resposta são aceitos
- **Gravidade:** alta, só se a API for publicada · **Certeza:** confirmado por execução
- **Onde:** `src/config.js:132` e `:139-157`
- **O problema:** a recusa de segredos conhecidos, de segredo curto e de `EXPOSE_RESET_CODE=true` só roda com `NODE_ENV === 'production'`. `NODE_ENV=Production`, `prod` ou vazio passam sem nenhuma dessas travas. Quem copiou o `.env.example` do `origin/main` tem `NODE_ENV=development` e `JWT_SECRET=change-me-to-a-long-random-string`, um segredo público. Com ele, qualquer pessoa assina um token com `sub` de outra conta e entra nela.
- **Reprodução:** `loadConfig({NODE_ENV:'Production', EXPOSE_RESET_CODE:'true'})` é aceito (`isProduction:false`, `expose:true`). `loadConfig({JWT_SECRET:'eco-dev-secret-change-me'})` é aceito, e o mesmo vale para `'abc'`. Um token assinado com o segredo configurado e `sub` de outra pessoa faz `GET /auth/me` devolver `bia@exemplo.test`. Com `EXPOSE_RESET_CODE=true`, `forgot-password` devolve `devCode` a quem pedir, e isso basta para tomar qualquer conta.
- **Correção:** recusar sempre `KNOWN_EXAMPLE_SECRETS` e segredos com menos de 32 caracteres, exceto com `NODE_ENV=test`. Aceitar `EXPOSE_RESET_CODE=true` só com `NODE_ENV` igual a `development` ou `test`. Comparar o `NODE_ENV` sem diferenciar maiúsculas. **P**

### A2 — O limite de PINs errados do cupom é contornável mudando a forma do id na URL
- **Gravidade:** média (alta se cada parceiro tiver um PIN real) · **Certeza:** confirmado por execução
- **Onde:** `src/routes/rewards.js:38` (chave `${user.id}|${req.params.id}`)
- **O problema:** a chave do limitador é o id como texto da URL, mas o SQLite converte `"03"`, `"003"`, `"3.0"` e `"+3"` para o mesmo cupom 3. Cada forma ganha 5 tentativas novas. Como zeros à esquerda são infinitos, as tentativas também são, e um PIN de 4 dígitos sai em minutos.
- **Reprodução:** com o seed, conta da Clara e cupom ativo 3: `POST /rewards/redemptions/{3,03,003,0003,3.0,+3}/use` com 5 PINs errados em cada forma deu **30 respostas 403 e nenhuma 429**.
- **Correção:** validar `:id` como inteiro positivo (`/^\d+$/` sem zero à esquerda, senão 404) e montar a chave com `redemption.id` lido do banco. Melhor ainda: contar os erros por pessoa, somando todos os cupons dela. **P**

### A3 — Recuperação de senha ativa sem envio de e-mail e sem limite por conta
- **Gravidade:** média, só se publicada · **Certeza:** confirmado por execução
- **Onde:** `src/routes/auth.js:101-169`, `src/middleware/rateLimit.js:99-118`
- **O problema:** sem `EXPOSE_RESET_CODE`, nenhum usuário de verdade recebe o código, mas a rota continua gerando códigos que dá para adivinhar. O limite é por IP + e-mail, não por conta. Cada `forgot-password` gera um código novo com mais 5 tentativas, então quem troca de IP (ou usa IPv6, ver A4) tem tentativas sem fim contra a mesma conta: 1 chance em 900 mil por tentativa, sem teto.
- **Reprodução:** com `TRUST_PROXY=1` simulando 8 IPs (`X-Forwarded-For`), 80 de 96 tentativas de `reset-password` contra a mesma conta chegaram à conferência do código numa única janela. De 5 IPs saíram 50 códigos novos para a mesma conta.
- **Correção:** com `EXPOSE_RESET_CODE=false` e sem provedor de e-mail, responder 503 em `forgot-password` e `reset-password`. Guardar no banco um contador por conta (por exemplo, no máximo 3 códigos por hora e 10 erros por dia). **M**

### A4 — O limitador por IP não segura IPv6 e esquece contadores quando está cheio
- **Gravidade:** média, só se publicada · **Certeza:** confirmado por leitura
- **Onde:** `src/middleware/rateLimit.js:110-115` (chave com `req.ip` inteiro) e `:38-48` (`makeRoom`)
- **O problema:** `server.js` escuta em todas as interfaces, inclusive IPv6. Quem tem um bloco /64 dispõe de 2^64 endereços, e cada um ganha contadores novos. Além disso, com 10.000 chaves o limitador descarta as mais antigas, mesmo as que estão bloqueadas, e quem inunda com chaves novas zera os próprios bloqueios.
- **Reprodução:** pela leitura do código. Não tenho IPv6 público aqui para executar; a rotação de IPv4 via `X-Forwarded-For` (A3) mostra o mesmo efeito.
- **Correção:** agrupar IPv6 por /64 na chave e não descartar entradas bloqueadas antes de vencerem (ou recusar a requisição quando o mapa está cheio de bloqueios). **M**

### A5 — A preferência "Perfil visível para a comunidade" não faz nada, e o feed mostra o nome completo
- **Gravidade:** média (promessa de privacidade não cumprida) · **Certeza:** confirmado por execução
- **Onde:** `src/services/users.js:61,170` (só grava); `src/services/community.js:80,109,139,143` (usam `user.name` inteiro). O modo local do app tem a mesma lacuna (`eco-app/lib/core/local/local_api.dart` só grava a coluna).
- **O problema:** o app descreve `privacyProfile` como "Seu nome e suas publicações aparecem para os vizinhos", mas `privacy_profile` não é lido em lugar nenhum. As publicações e os comentários gravam e devolvem o nome completo, e a notificação de comentário diz "Bia Exemplo Souza comentou…". O ranking e o mapa usam o nome curto, e o próprio cabeçalho de `community.js` promete "só nome curto".
- **Reprodução:** Ana desliga `privacyProfile` e `privacyLocation` e publica. `GET /community/posts` visto pela Bia devolve `authorName: "Ana Exemplo Silva"`.
- **Correção:** usar `shortName` em publicações, comentários e na notificação. Com `privacyProfile=false`, mostrar "Vizinho(a)" e as iniciais, ou tirar a pessoa do ranking. Fazer o mesmo no `local_api.dart`. **M**

### A6 — Quem desliga "aparecer no mapa" continua no ranking
- **Gravidade:** baixa · **Certeza:** confirmado por execução
- **Onde:** `src/services/community.js:214-227`
- **O problema:** a regra pedida diz que a pessoa some do mapa **e do ranking**. Do mapa ela some. No ranking continua com nome curto, iniciais e pontos; só o bairro fica escondido. O backend copia o app (`local_api.dart:1688-1697`), então é uma decisão a confirmar, não um desvio do port.
- **Reprodução:** com Ana em `privacyLocation=false`, o ranking visto pela Bia mostra `{"name":"Ana S.","initials":"AS","neighborhood":null,"points":15}`.
- **Correção:** se a regra vale, filtrar `privacy_location = 0` do ranking (exceto a própria pessoa) nos dois lados. **P**

### A7 — bcrypt síncrono trava o servidor inteiro a cada login
- **Gravidade:** baixa (média se a API tiver muitos usuários) · **Certeza:** confirmado por execução (medido)
- **Onde:** `src/routes/auth.js:91,181`; `src/services/users.js:29` (`compareSync` e `hashSync` do bcryptjs, que é JavaScript puro)
- **O problema:** com custo 10, cada login, cadastro ou troca de senha prende o processo por cerca de **104 ms** (cerca de 400 ms com custo 12). O servidor fica em uns 10 logins por segundo, e nenhuma outra rota responde enquanto isso.
- **Correção:** usar `bcrypt.compare` e `bcrypt.hash` assíncronos, ou trocar para o `bcrypt` nativo ou `argon2`, que rodam fora da thread principal. **P**

### A8 — O limitador de login conta também os logins certos
- **Gravidade:** baixa · **Certeza:** confirmado por execução
- **Onde:** `src/routes/auth.js:84` com `rateLimit('login')`
- **O problema:** 11 logins **corretos** seguidos do mesmo IP: o 11º recebe 429. Atrás de um NAT (Wi-Fi de escola ou de feira), o teto por IP é de 50 por rota a cada 15 minutos para todo mundo junto.
- **Correção:** contar só as falhas no login, como já é feito no PIN. **P**

### A9 — Senhas acima de 72 bytes: o que vem depois é ignorado
- **Gravidade:** baixa · **Certeza:** confirmado por execução
- **Onde:** `src/services/validation.js:11,36` (aceita até 200 caracteres)
- **O problema:** o bcrypt usa só os primeiros 72 bytes. Cadastro com `"a"×72 + "PRIMEIRA"` e login com `"a"×72 + "OUTRA-qualquer"` → 200.
- **Correção:** limitar a 72 bytes (`Buffer.byteLength`) ou passar a senha por SHA-256 antes do bcrypt. **P**

### A10 — Código de recuperação pedido antes da troca de senha continua valendo depois
- **Gravidade:** baixa · **Certeza:** confirmado por execução
- **Onde:** `src/routes/auth.js:186-188`
- **Reprodução:** `forgot-password`, depois `change-password` (200), depois `reset-password` com o código antigo → 200.
- **Correção:** `UPDATE password_resets SET used = 1 WHERE user_id = ?` dentro do change-password. **P**

### A11 — Preferências: `"true"` ou `1` desligam a opção
- **Gravidade:** baixa · **Certeza:** confirmado por execução
- **Onde:** `src/services/users.js:177`
- **Reprodução:** `PATCH /users/me/preferences {"privacyLocation":"true","notificationsEnabled":1}` → as duas ficam `false`, com status 200.
- **Correção:** responder 400 quando o valor não for booleano. **P**

### A12 — PATCH /users/me com tipo errado apaga o campo sem avisar
- **Gravidade:** baixa · **Certeza:** confirmado por execução
- **Onde:** `src/services/validation.js:59-79`, `src/services/users.js:138-141`
- **Reprodução:** `{"street":123,"number":["x"]}` → 200 e os dois campos viram `null`. `{"state":"1$"}` → 200, com estado `"1$"`.
- **Correção:** responder 400 quando o campo vier e não for texto, e validar o estado com `/^[A-Z]{2}$/`. **P**

### A13 — DELETE /notifications/:id responde 200 mesmo sem apagar nada
- **Gravidade:** baixa · **Certeza:** confirmado por execução
- **Onde:** `src/routes/notifications.js:30-36`
- **O problema:** com um id inexistente ou de outra pessoa, a resposta é 200 `{ok:true}`. O dono é conferido (a notificação da outra pessoa continua lá), mas o PATCH da mesma rota responde 404 nesse caso.
- **Correção:** 404 quando `changes === 0`. **P**

### A14 — Configuração de validade do token não é conferida ao subir
- **Gravidade:** baixa · **Certeza:** confirmado por execução
- **Onde:** `src/config.js:165`
- **O problema:** `JWT_EXPIRES_IN=abc` passa na inicialização, e depois `jwt.sign` lança erro em todo cadastro e login (500). `JWT_EXPIRES_IN=0` emite tokens que já nascem vencidos. `PORT=70000` também passa na configuração.
- **Correção:** chamar `jwt.sign` uma vez em `loadConfig` e recusar validade ≤ 0; limitar `PORT` a 65535. **P**

### A15 — A API escuta em todas as interfaces, embora o log diga 127.0.0.1
- **Gravidade:** baixa · **Certeza:** confirmado por leitura
- **Onde:** `src/server.js:5-6` (`app.listen(config.port)` sem host)
- **O problema:** `npm run dev` num notebook ligado a uma rede compartilhada expõe a API a todos daquela rede: conta de demonstração com senha pública e, se alguém ligar `EXPOSE_RESET_CODE`, redefinição da senha de qualquer conta.
- **Correção:** variável `HOST` com padrão `127.0.0.1`. **P**

### A16 — Cabeçalhos e CORS
- **Gravidade:** baixa · **Certeza:** confirmado por execução
- **Onde:** `src/app.js:18-32`
- **O problema:** a resposta traz `X-Powered-By: Express`, não traz `X-Content-Type-Options: nosniff` nem os demais cabeçalhos de segurança, e `CORS_ORIGIN=*` é aceito em produção. O risco é pequeno porque o token vai no cabeçalho e não em cookie.
- **Correção:** `app.disable('x-powered-by')`, helmet ou os cabeçalhos à mão; em produção, exigir uma lista de origens. **P**

### A17 — O cadastro revela se um e-mail tem conta
- **Gravidade:** baixa · **Certeza:** confirmado por execução (testes existentes esperam 409)
- **Onde:** `src/routes/auth.js:70`
- **O problema:** `forgot-password` esconde se o e-mail existe, mas `register` responde 409, o que anula esse cuidado. É comum em apps; o limite por IP atenua.
- **Correção:** aceitar como decisão ou trocar por confirmação por e-mail. **P**

### A18 — PIN único e público (`1234`) gravado automaticamente em qualquer banco
- **Gravidade:** baixa (está documentado) · **Certeza:** confirmado por execução
- **Onde:** `src/referenceData.js:89-92`, `src/catalog.js:13`
- **O problema:** a cada inicialização, inclusive com `NODE_ENV=production`, todo parceiro do catálogo sem PIN recebe `1234`. O banco antigo migrado ficou com os 5 parceiros em `1234`. Qualquer usuário pode "conferir" o próprio cupom sem estar no balcão.
- **Correção:** em produção, só avisar no log e não gravar; PIN próprio por parceiro. **P**

## 4. O que foi conferido e está correto

- **JWT:** `alg: none`, segredo errado, token vencido e token com versão antiga → 401. Trocar ou redefinir a senha invalida as sessões (`token_version`). Sem `JWT_SECRET` fora de produção, o segredo é aleatório e fica em `data/.jwt-secret`, que o `.gitignore` cobre.
- **Login com e-mail sem conta:** compara com um hash do mesmo custo. O código de recuperação é guardado só como hash SHA-256, comparado em tempo constante, invalidado depois de 5 erros e vence em 30 min.
- **SQL:** todas as consultas usam `?`. As interpolações (`users.js:150,158,181`, `community.js:60,69,208`, `referenceData.js`) só montam nomes de colunas e tabelas de listas fixas e marcadores `?`. Não há ordenação vinda da query string.
- **Query string esquisita:** valores repetidos, `sort[]`, `limit` negativo ou enorme e busca de 8.000 caracteres → 200, sem quebrar.
- **Corpo da requisição:** JSON inválido, array, `null`, `text/plain` ou objeto no lugar de texto → 400; mais de 1 MB → 413; charset desconhecido → 415; URL malformada → 400; rota inexistente → 404 em JSON. Erros internos voltam como "Erro interno do servidor." sem detalhes.
- **Dono do recurso:** PATCH e DELETE de notificação, exclusão de publicação (403) e uso de cupom (404) conferem quem chamou.
- **Respostas da comunidade:** nenhuma devolve e-mail, endereço nem posição exata. O mapa só lista quem tem `privacy_location = 1`, sempre em posição aproximada (centro do bairro ± ~350 m). Bairro fora da lista fica sem posição.
- **`TRUST_PROXY`:** nunca vira "confiar em todos"; o `true` antigo vale como 1.
- **Migrações:** um banco criado pelo seed do `origin/main` abre com o código novo e vai à versão 2 sem perder linhas (contagens iguais em todas as tabelas). `integrity_check` ok, `foreign_key_check` vazio, códigos de recuperação antigos viram hash, e reabrir não muda nada (idempotente). Banco mais novo que o código é recusado. Cada migração roda numa transação. `foreign_keys = ON`.
- **Índices:** as consultas frequentes (registros por usuário e data, por tipo e data, notificações, comentários por publicação) têm índice. Faltam índices só em tabelas pequenas (`password_resets.user_id`, `posts.created_at`), sem impacto neste porte.
- **Dependências:** `npm audit` sem vulnerabilidades.
- **Limitador:** tem teto de memória (10.000 chaves por contador) e guarda o e-mail só como hash.
- **Ausências que o README já declara:** exclusão de conta (LGPD), logout no servidor e verificação de e-mail.

## 5. Lacunas de teste

- Configuração: nenhum teste com `NODE_ENV` diferente de `production` e `EXPOSE_RESET_CODE=true` ou segredo conhecido (A1), nem com `JWT_EXPIRES_IN` inválido (A14).
- PIN do cupom: nenhum teste com outra forma do id, como `03` ou `3.0` (A2).
- Recuperação: nenhum teste de limite por conta com vários IPs (A3), nem de código pendente depois de `change-password` (A10).
- Limitador: nenhum teste com IPv6 ou com o mapa cheio de bloqueios (A4); nenhum teste garantindo que login certo não conta (A8).
- Privacidade: nenhum teste de `privacyProfile` (A5); nenhum teste de que o feed e os comentários não trazem nome completo, e-mail ou `user_id`; nenhum teste de que o ranking respeita `privacyLocation` (A6).
- JWT: nenhum teste explícito com `alg: none` nem com token assinado por outro segredo (o comportamento está correto, mas sem teste que o proteja).
- Validação: preferências com valor não booleano (A11), campos de endereço com tipo errado (A12), senha acima de 72 bytes (A9).
- `DELETE /notifications/:id` de outra pessoa (A13).
- CORS: só há teste com `*`; nenhum com lista de origens.

## 6. Para a feira de amanhã

Na apresentação o app roda em modo local no celular e não chama esta API. Por isso **nenhum dos achados afeta a demonstração**. Todos os testes passam e a API sobe normalmente, caso alguém queira mostrá-la.

- **Só importam se a API for publicada em rede:** A1, A3, A4, A7, A8 (NAT) e A16. O mais urgente nesse cenário é o A1: publicar com `NODE_ENV=production` escrito exatamente assim e um `JWT_SECRET` próprio.
- **Importam se alguém rodar `npm run dev` no notebook ligado ao Wi-Fi da feira:** A15 (a API fica aberta para a rede) somado ao A1 (um `.env` antigo com o segredo público deixa qualquer conta ser tomada). Se precisar mostrar a API, rode em rede própria ou deixe o notebook fora do Wi-Fi público.
- **Valem também para o app:** A5 e A6 (privacidade) aparecem igual no modo local do app, que é o que vai ser mostrado. Se um avaliador desligar "Perfil visível" e voltar ao feed, verá o próprio nome completo nas publicações dele. Não quebra nada, mas é a única coisa desta lista que alguém pode notar na feira.
- A2, A9–A14, A17 e A18 são correções de qualidade, sem efeito na apresentação.
