# claude-agent

Repositório com Projetos desenvolvidos com Claude Code como exemplo.

## Notícias de IA (`/ninanews`)

Página com um único botão ("Buscar notícias de hoje") que aciona a Edge
Function `ninanews-buscar` e mostra 5 notícias sobre inteligência artificial
do dia, cada uma com título e resumo em formato executivo, mais um texto
único já pronto para colar no LinkedIn (com botão de copiar). A busca manual
não atualiza nada sozinha e nada é salvo no banco: sem histórico, cada
clique busca e gera tudo de novo do zero. Mesmo padrão do resto do repo:
HTML/JS estático + Supabase, sem build. (A pasta e a function continuam se
chamando `ninanews`/`ninanews-buscar` — só a marca visível na página e no
e-mail diário mudou para "Notícias de IA".)

**Pipeline dentro da Edge Function (`ninanews-buscar`):**
1. **Busca (Firecrawl):** consulta `https://api.firecrawl.dev/v1/search` com
   `lang: "pt"` e `country: "br"`, primeiro restrita às últimas 24h
   (`tbs: "qdr:d"`); se vierem poucos resultados, complementa com uma busca
   na última semana (`tbs: "qdr:w"`), deduplicando por URL. Usa só o snippet
   de busca (`title`/`description`) — sem pedir scrape completo em markdown,
   que tornava a chamada bem mais lenta sem ganho relevante pro resumo.
2. **Seleção + resumo (Anthropic, `claude-sonnet-5`, saída estruturada via
   `output_config.format`, `thinking` desligado):** recebe até 12 notícias
   candidatas e escolhe exatamente 5, distintas entre si, priorizando sempre
   fontes brasileiras (só recorre a fontes internacionais se não houver 5
   opções boas em português). Para cada uma gera título + resumo executivo, e
   monta um `post_final` único reunindo as 5, em texto puro (sem markdown, já
   que o LinkedIn não renderiza `**`/`#`), com até 3 hashtags ao final.
   `thinking` fica desligado de propósito: a `claude-sonnet-5` liga adaptive
   thinking por padrão, o que é caro em tempo pra uma tarefa de
   seleção/formatação e não traz ganho de qualidade aqui.
3. **Limite de 3000 caracteres:** o prompt já instrui o limite rígido no
   `post_final` (usado no LinkedIn), mas se o modelo estourar mesmo assim, a
   function faz uma segunda chamada pedindo para encurtar preservando as 5
   notícias; se ainda passar do limite, trunca no último espaço antes do
   caractere 3000 como último recurso.

Se a busca no Firecrawl não trouxer notícias suficientes (mínimo de 5
candidatas), ou se o modelo falhar em selecionar exatamente 5, a tela mostra
uma mensagem de erro e sugere tentar de novo — sem resultado parcial.

> **Requer as secrets `FIRECRAWL_API_KEY` e `ANTHROPIC_API_KEY`**
> configuradas no projeto Supabase (`ClaudeProjects`) — configure com
> `supabase secrets set FIRECRAWL_API_KEY=fc-...` e
> `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...` (via CLI, com o
> projeto linkado) ou pelo dashboard do Supabase em Project Settings → Edge
> Functions → Secrets. Sem elas, a function responde com erro 502.

### E-mail diário (`noticias-ia-email-diario`)

A Edge Function `noticias-ia-email-diario` chama `ninanews-buscar`
internamente, monta um e-mail em HTML com as 5 notícias e o `post_final`, e
envia via Resend (`RESEND_API_KEY`, mesma secret já usada por
`oraculo-webhook`/`appvendas-lembretes`) para `rodrigosilvapmp@hotmail.com`.
Remetente `onboarding@resend.dev` (sandbox da Resend) — só entrega de fato
se esse for o e-mail cadastrado na conta Resend; para enviar a qualquer
destinatário é preciso verificar um domínio próprio na Resend e trocar o
`RESEND_FROM` no código.

**Agendamento:** disparada 1x por dia às 05:00 (`America/Sao_Paulo`) por um
job do `pg_cron`/`pg_net` criado na migration
`agenda_email_diario_noticias_ia` (extensões `pg_cron` e `pg_net` habilitadas
na mesma migration). O job faz um `net.http_post` pra
`.../functions/v1/noticias-ia-email-diario` usando a publishable key do
projeto (a mesma já exposta no front-end) — a function não exige nenhuma
secret adicional além das já usadas por `ninanews-buscar` mais
`RESEND_API_KEY`. Como a publishable key é pública, qualquer chamada válida
ao endpoint dispara o envio; o único efeito de um disparo indevido é gerar
um e-mail extra e consumir crédito das APIs (Firecrawl/Anthropic/Resend) —
se isso virar um problema, dá pra proteger com um segredo compartilhado
depois.

## Gerador de post para LinkedIn (`/linkedin`)

Página com um formulário (tema + tom) que chama a Edge Function
`generate-linkedin-post` (agente 1, escritor), a qual usa a API da Anthropic
(modelo `claude-opus-4-8`) para gerar o texto do post. Mesmo padrão do
`index.html` na raiz: HTML/JS estático + Supabase.

**Dois agentes em cadeia:** depois de gerar o texto, `generate-linkedin-post`
chama internamente (via HTTP, function-to-function) a Edge Function
`grade-linkedin-post` (agente 2, avaliador), que classifica o post em uma de
quatro categorias e devolve o resultado junto com o texto:
- `executivo` — texto executivo bem formatado, com nota de 1 a 10
- `tecnico` — texto técnico bem formatado, com nota de 1 a 10
- `pessimo` — texto péssimo (sem nota)
- `reescrever` — precisa de revisão antes de publicar (sem nota)

A nota aparece na tela logo abaixo do texto gerado. Se a chamada ao agente
avaliador falhar, o post ainda é exibido normalmente (a nota só some da
tela).

**Feedback iterativo:** abaixo da nota há um campo para o usuário pedir
ajustes (ex: "deixe mais curto"). Ao clicar em "Gerar novo texto com esse
feedback", o front-end chama `generate-linkedin-post` de novo enviando
`feedback` + o texto atual (`previousPost`); o agente escritor reescreve o
post em cima disso (em vez de partir do zero) e o agente avaliador roda de
novo sobre o texto revisado. Pode repetir quantas vezes quiser.

> **Requer a secret `ANTHROPIC_API_KEY`** configurada no projeto Supabase
> (`ClaudeProjects`) para as duas Edge Functions funcionarem — configure com
> `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...` (via CLI, com o projeto
> linkado) ou pelo dashboard do Supabase em Project Settings → Edge Functions
> → Secrets. Sem essa secret, as functions respondem com erro 502.

## Escolha o Modelo (`/escolhamodelo`)

Página com um campo de texto onde o usuário digita uma pergunta. A Edge
Function `escolhamodelo-router` decide automaticamente qual modelo Claude
(Haiku 4.5, Sonnet 5 ou Opus 5) é mais adequado para responder, com base na
complexidade e no tipo da pergunta, e devolve a resposta junto com os
critérios usados na escolha. Mesmo padrão do resto do repo: HTML/JS
estático + Supabase, sem build.

**Dois agentes em cadeia** (dentro da mesma Edge Function):
1. **Agente roteador** (sempre `claude-haiku-4-5`, fixo — classificar é uma
   tarefa simples e o custo de errar o modelo de resposta é maior que o
   custo de classificar): avalia a pergunta e devolve, via saída
   estruturada (`output_config.format`), a complexidade (`simples` /
   `moderada` / `complexa`), o tipo (`factual_direta`, `explicativa_geral`,
   `analise_aberta`, `codificacao_complexa`, `raciocinio_multietapas`), se
   exige raciocínio profundo, o modelo escolhido e uma justificativa curta
   em português.
2. **Agente respondedor** (modelo escolhido pelo roteador — `claude-haiku-4-5`,
   `claude-sonnet-5` ou `claude-opus-5`): responde de fato à pergunta do
   usuário.

Se o agente roteador falhar, a function cai para `claude-sonnet-5` como
modelo padrão e a tela simplesmente não mostra o bloco de critérios (a
resposta continua sendo exibida normalmente).

**Custo estimado:** abaixo da resposta e dos critérios, a tela mostra o
total de tokens gastos (soma das duas chamadas à Anthropic) e o custo
convertido em reais. A conversão usa a cotação USD→BRL em tempo real (API
pública `economia.awesomeapi.com.br`, sem chave); se a busca falhar, usa
uma cotação fixa de fallback e avisa na tela que o valor é aproximado. Os
preços por modelo usados no cálculo são valores de referência (não
reflete promoções, desconto de cache, etc.) — servem só para dar noção de
grandeza do custo.

Não há persistência — cada pergunta é uma requisição isolada (mesmo padrão
stateless do `cep-agent`).

> **Requer a secret `ANTHROPIC_API_KEY`** já configurada no projeto Supabase
> (`ClaudeProjects`) — a mesma usada por `generate-linkedin-post`,
> `grade-linkedin-post`, `cowork-generate-document` e `oraculo-webhook`.
> Nenhuma secret nova é necessária.

## PandaFit — Registro de Treinos (`/pandafit`)

App mobile-first (coluna centralizada de até 460px) para registrar
treinos, peso e exames, com login e três papéis — **admin**, **usuario**
e **medico** (ver seção de autenticação abaixo). Mesmo padrão do resto do
repo: HTML/CSS/JS estático, sem build. Os treinos ficam na tabela
`pandafit_workouts`, a meta mensal em `pandafit_settings`, o peso diário em
`pandafit_weights` e os documentos em `pandafit_documents` + bucket de
Storage `pandafit-documents`, no Supabase (`ClaudeProjects`) — cada linha
pertence a um `user_id` e os dados persistem no banco, disponíveis em
qualquer dispositivo em que a mesma conta faça login.

Visual corporativo: fonte única Inter (400 a 800), paleta azul/slate
(`#2563eb` de destaque sobre neutros frios `#ffffff`/`#f8fafc`, com
equivalente em azul `#3b82f6` sobre slate `#0f172a`/`#1e293b` no modo
escuro), cantos suavemente arredondados (`--radius-sm/md/lg`: 6/10/14px)
em cartões, botões, campos e badges, e leve elevação (`box-shadow`) —
substituiu o visual anterior em Barlow/Barlow Condensed com paleta
terracota, cantos retos e marcas "+" nos vértices (estilo ticket/recibo).
Mantém modo escuro automático (ver abaixo), transição suave ao trocar de
aba e feedback tátil (`:active { transform: scale(...) }`) em todo alvo de
toque. Uma barra de topo fixa (marca "PandaFit" + avatar da conta) fica
sempre visível acima do conteúdo em todas as telas, dando ao app uma
identidade de "cabeçalho" persistente em vez de cada tela abrir direto no
título grande — sem ela, no topo sobrava um espaço vazio do tamanho da
barra de status antes de qualquer conteúdo aparecer. A tela de login
("PandaFit") segue o mesmo padrão: formulário dentro de um cartão com
borda e sombra centralizado sobre o fundo da página, em vez de campos
soltos direto na tela.

### Autenticação e papéis

Login por e-mail/senha (`supabase.auth`) — sem cadastro público: só o
admin cria contas. Como o projeto Supabase (`ClaudeProjects`) é
compartilhado com vários outros apps deste repo, `auth.users` tem contas
de todos eles; a tabela `pandafit_usuarios` (id = `auth.users.id`, email,
nome, `role`) é o escopo de quem tem acesso a *este* app — mesmo padrão já
usado por `sucesu_usuarios` em SUCESU SP Connect. As políticas RLS de
`pandafit_workouts`/`pandafit_weights`/`pandafit_settings`/
`pandafit_documents` (e do bucket de Storage) checam `auth.uid()` contra
essa tabela via a função `pandafit_current_role()` (`security definer`,
`EXECUTE` revogado de `anon`): sem uma linha em `pandafit_usuarios`,
nenhuma política libera nada — uma conta autenticada de *outro* app deste
mesmo projeto nunca enxerga dado nenhum do PandaFit.

- **usuario**: acesso só às próprias linhas (`user_id = auth.uid()`) — a
  tabbar mostra **Painel · Registrar · Config.** (3 abas — Meta e
  Documentos moraram dentro de Configurações, ver abaixo).
- **admin**: mesmo acesso de um usuario às próprias telas (o admin também
  treina), mais um item **Usuários** dentro de Configurações — cadastrar
  (nome, e-mail, senha inicial, papel usuario/médico), trocar o papel de
  alguém ou revogar o acesso ao PandaFit. Tudo isso chama a edge function
  `pandafit-admin-users` (service role key, nunca exposta no cliente), que
  confirma que quem chamou é admin antes de qualquer ação. Ao convidar um
  e-mail que já tem conta neste projeto compartilhado (comum, já que é
  usado por outros apps), a function só adiciona a linha em
  `pandafit_usuarios` — **nunca** mexe na senha existente, porque a mesma
  conta pode logar em outro app. Revogar remove só a linha de
  `pandafit_usuarios` (nunca a conta em `auth.users`, pelo mesmo motivo).
- **medico**: sem tabbar — cai direto numa tela **Pacientes**, lista de
  contas com `role = 'usuario'`; ao selecionar uma, vê o gráfico de
  tendência de peso, o histórico de peso e os treinos mais recentes
  daquele paciente (somente leitura, sem editar/excluir) e a seção
  **Documentos**, com um resumo (espaço total ocupado + data do envio mais
  recente), link **Baixar** (signed URL com download forçado, em vez de só
  abrir numa aba) além do **Ver**, e exclusão — o único ponto onde o médico
  pode apagar algo do paciente, pra tirar um exame enviado errado ou já
  obsoleto (ver `0053_pandafit_medico_pode_excluir_documentos.sql`).

O primeiro admin (`rodrigosilvapmp@hotmail.com`) foi cadastrado direto via
SQL (`0049_pandafit_bootstrap_admin.sql`) reaproveitando uma conta que já
existia neste projeto compartilhado — sem mexer na senha dela — e todo o
histórico de treinos/pesos/documentos gravado antes de existir
autenticação foi migrado para essa conta.

Documentos: o bucket `pandafit-documents` **não é mais público** — cada
arquivo vive em `<user_id>/<arquivo>` e as políticas de Storage restringem
`insert` à própria pasta e `select`/`delete` à própria pasta **ou** ao
médico (que enxerga e pode excluir o documento de qualquer paciente, mas
nunca insere um). O link "Ver" gera uma signed URL (`createSignedUrl`,
expira em 5 minutos) na hora do clique em vez de expor uma URL pública
permanente — importante agora que a aba guarda exame médico de verdade; o
"Baixar" do médico usa a mesma signed URL com a opção `download`, que força
o navegador a salvar o arquivo em vez de só abri-lo numa aba.

Quem loga como **usuario** ou **admin** vê a tabbar com **Painel ·
Registrar · Config.** — Meta, Documentos e (só para admin) Usuários não
têm aba própria: são linhas dentro de **Configurações**, cada uma abrindo
sua tela com um "‹ Configurações" para voltar. Isso existe porque a
tabbar com uma aba por tela (Painel/Registrar/Meta/Documentos/Usuários)
quebrava visualmente assim que o admin logava — 5 itens não cabem numa
grade de 4 colunas e a 5ª aba ("Usuários") ficava sozinha numa segunda
linha. Com só 3 abas fixas, a tabbar nunca quebra, seja qual for o papel.
O **medico** não tem tabbar nem Configurações — vê só a tela de Pacientes
descrita acima.

- **Painel**: banners de lembrete no topo (só no mês atual) — "faltam X
  treinos para bater a meta deste mês" quando ainda não bateu, e "você ainda
  não registrou seu peso hoje" quando não há peso salvo com a data de hoje;
  cada um pode ser dispensado (`×`) só pra aquela sessão/carregamento da
  página, sem push notification de verdade (fora do escopo — precisaria de
  infra de VAPID/Edge Function). Cabeçalho com o mês exibido e setas `‹`/`›`
  para navegar entre meses (a seta `›` fica desabilitada no mês atual — não
  dá pra ver o futuro); cartão de total de treinos no mês (contagem, não
  duração) com
  barra de progresso até a meta mensal; **calendário** em grade estilo
  GitHub (um quadrado por dia do mês, 3 níveis — sem treino, 1 treino, 2+
  treinos — nos mesmos tons de azul do resto do app, com o dia de hoje
  marcado por um contorno) pra ver o padrão de consistência de relance,
  sem precisar ler a lista de registros; divisão do tempo por modalidade
  (só as usadas no mês — não o catálogo inteiro, ver Modalidades abaixo);
  lista dos registros do mês (dia, tipo,
  local, duração), paginada de 5 em 5, com botão de editar (lápis) e de
  excluir (confirmação antes de apagar) em cada linha — tudo recalculado
  para o mês selecionado.
- **Registrar**: alterna entre **Treino** e **Peso** por uma aba superior;
  dentro de Treino, alterna entre **Manual** (aba padrão — data + duração em
  minutos digitadas à mão) e **Cronômetro** (inicia/pausa/zera, registra a
  duração corrida ao salvar), com seletor do tipo de treino (vem do catálogo
  de Modalidades — ver abaixo), campo de local com autocomplete (vem do
  catálogo de Locais) e uma seção opcional de **Exercícios** — ver abaixo;
  dentro de Peso, registra data + kg (salvar no mesmo dia
  sobrescreve em vez de duplicar — `upsert` por `date`, que é `unique` na
  tabela), mostra um gráfico de linha simples (SVG, sem biblioteca) com a
  tendência dos últimos 30 pesos registrados — some se houver menos de 2
  registros — e o histórico com a variação em relação ao registro anterior,
  colorida — vermelho (`▲`) quando o peso subiu, verde (`▼`) quando caiu,
  neutro (`=`) quando ficou igual. Ambas paginadas de 5 em 5, com edição
  (lápis) além da exclusão em cada linha: clicar em editar preenche o
  formulário com os dados do registro, troca "Registrar" por "Editar" no
  título e no botão de salvar, mostra um link "Cancelar edição" e, no caso
  de um treino, esconde a alternância Manual/Cronômetro (edição é sempre
  manual); salvar faz `update` por `id` em vez de criar um novo registro.
- **Meta**: campo para ajustar a meta mensal (1 a 30 treinos, de qualquer
  modalidade — validado no cliente e também no banco via `check`); barra de
  progresso do mês corrente; sequência (streak) de meses seguidos batendo a
  meta, contando a partir do mês atual para trás e parando no primeiro mês
  (incluindo o atual, se ainda não bateu) que ficou abaixo — calculada a
  partir dos treinos já carregados, sem consulta extra; "Evolução" com a
  contagem dos últimos 6 meses (calculada a partir dos treinos já
  carregados, sem consulta extra) para acompanhar a tendência mês a mês;
  meta de peso opcional (`target_weight_kg`
  em `pandafit_settings`) — mostra "faltam X kg" comparando com o peso mais
  recente registrado, ou "meta batida!"; deixar o campo em branco remove a
  meta; botões para baixar todos os treinos e todos os pesos já carregados
  em CSV (ordenado por data, `,` como separador, `.` como decimal — sem
  formatação brasileira para não colidir com o separador de campo — e BOM
  UTF-8 na frente pro Excel não bagunçar os acentos de tipo/local).
- **Documentos**: upload de exames (PDF/JPG/PNG, até 10MB) para o Storage do
  Supabase, salvo em `<user_id>/<arquivo>`; lista paginada de 5 em 5 com
  nome, tamanho, data de envio, link "Ver" (gera uma signed URL na hora do
  clique — o bucket não é público) e exclusão (remove do Storage e da
  tabela).
- **Modalidades** e **Locais**: catálogos por usuário (`pandafit_workout_types`
  e `pandafit_locations`) — tudo que é "cadastrável" no PandaFit mora em
  Configurações, não mais numa lista fixa no código. Modalidades tem nome +
  apelido opcional (ex: "Natação" / "piscina") e alimenta os botões de tipo
  em Registrar; Locais tem só nome e alimenta o autocomplete do campo Local.
  Excluir um item do catálogo não apaga treinos já registrados com ele (o
  texto fica salvo solto na linha do treino). Uma conta nova recebe as 3
  modalidades clássicas (Musculação/Jiu Jitsu/Corrida) de largada; contas
  que já tinham treinos registrados antes dessa mudança tiveram seu
  histórico migrado direto para os novos catálogos
  (`0051_pandafit_workout_types_and_locations.sql`). Digitar um local novo
  direto em Registrar (sem passar por Configurações primeiro) também
  cadastra ele sozinho no catálogo — conveniência que substitui o
  autocomplete antigo (calculado na hora a partir do histórico de treinos).
- **Exercícios e séries**: o salto de "app de duração" pra tracker de treino
  de força de verdade — dentro de Registrar > Treino, uma seção opcional
  deixa adicionar um ou mais exercícios (nome com autocomplete do catálogo
  de **Exercícios**, mesmo padrão de Modalidades/Locais), cada um com N
  séries de repetições x carga (ex: 3 séries de 10 reps a 40kg). Nenhum
  exercício é obrigatório — duração sozinha continua sendo o suficiente pra
  registrar qualquer treino. As séries ficam em `pandafit_workout_sets`
  (uma linha por série, `on delete cascade` do treino) e aparecem resumidas
  no registro do Painel (ex: "Supino reto 3×10 @ 40kg") e na visão do
  médico, que só lê. Editar um treino recarrega os exercícios/séries já
  salvos no formulário; salvar substitui todas as séries daquele treino
  pelas atuais, em vez de tentar diferenciar o que mudou
  (`0054_pandafit_exercicios_e_series.sql`).
- **Configurações**: tela raiz com uma linha por item (Meta, Modalidades,
  Locais, Exercícios, Documentos e, só para admin, Usuários), cada uma
  abrindo a tela correspondente; embaixo, a seção "Conta" mostra e-mail +
  papel logado e o botão **Sair** (o mesmo avatar da barra de topo também
  abre a confirmação de logout, de qualquer tela).

Dimensões revisadas para iPhone: `min-height: 100dvh` (evita o salto de
altura quando a barra do Safari some/aparece), inputs com `font-size: 16px`
(abaixo disso o iOS dá zoom automático no foco), alvos de toque com pelo
menos 44×44pt (padrão da Apple HIG) em botões, abas e no novo botão de
excluir, `-webkit-tap-highlight-color`/`-webkit-touch-callout` desligados
para não ficar com o realce cinza/menu de contexto do Safari, e
`overscroll-behavior` para conter o bounce de rolagem à área de conteúdo.
Também ganhou meta tags de "adicionar à tela de início" (ícone, título,
barra de status). Um botão circular na barra de topo (iniciais do
nome/e-mail) fica visível em qualquer tela após o login e abre a
confirmação de logout — mesmo modal reusado para excluir registros.

Suporta modo escuro automático via `@media (prefers-color-scheme: dark)`:
todas as cores do app são tokens (`--ink`, `--muted`, `--accent`,
`--bg-app`, `--line`, `--track`, `--bad`/`--good` para os indicadores de
peso e o botão de exclusão, etc.) definidos em `:root` e redefinidos dentro
do media query — segue a preferência do sistema operacional/navegador, sem
alternância manual. `color-scheme: light dark` também é declarado para que
controles nativos (date picker, seletor de arquivo) sigam o tema.

### PWA (manifest + service worker)

`manifest.json` (nome, ícones 192/512px gerados a partir do mesmo panda do
favicon, `display: standalone`, cores do tema) deixa o Chrome/Android
oferecer instalação de verdade, além do "adicionar à tela de início" que já
existia via meta tags para iOS. `sw.js` faz cache básico do app shell
(`index.html`, `manifest.json`, `styles.css`, `app.js`,
`supabaseClient.js`, ícones) — estratégia cache-first com atualização em
segundo plano (stale-while-revalidate), então o app abre mesmo sem
internet. O service worker só intercepta pedidos same-origin — chamadas ao
Supabase e ao esm.sh (import do `supabase-js`) são cross-origin e vão
direto pra rede, nunca ficam em cache, então os dados nunca aparecem
desatualizados por causa disso.

Separado do service worker, os **dados** (treinos, pesos, meta e os
catálogos de modalidades/locais/exercícios) têm seu próprio cache de
leitura em `localStorage`, namespaced por `user_id`: toda vez que um
desses carrega com sucesso, a resposta é salva; no próximo boot, o cache
aparece na tela na hora enquanto a rede responde em paralelo, e se a rede
falhar (sem internet mesmo) o app continua mostrando os dados salvos em
vez de uma tela de erro, com um aviso "Sem conexão — mostrando dados
salvos no aparelho" no topo. Documentos ficam de fora desse cache de
propósito — o nome de um arquivo pode ser sensível (ex: resultado de
exame) e não devia ficar gravado fora do Supabase. É só leitura: criar,
editar ou excluir continua exigindo rede, e o cache é limpo no logout.

**Atenção**: como o service worker cacheia os arquivos versionados
(`?v=N`), sempre que incrementar essa versão em `styles.css`/`app.js`/
`supabaseClient.js` (ver seção abaixo), também é preciso atualizar o
`CACHE_NAME` e a lista `APP_SHELL` em `sw.js` com o mesmo número — senão o
cache antigo nunca é limpo.

### Hospedagem (GitHub Pages) e cache

Mesmo padrão do Reports Panel (ver seção abaixo): `styles.css` e `app.js`
são referenciados com `?v=N` em `index.html`, e o próprio `import` do
`supabaseClient.js` dentro de `app.js` também carrega `?v=N` — sem isso, o
CDN do GitHub Pages e o cache do navegador podem continuar servindo a
versão antiga por vários minutos mesmo depois do merge (foi exatamente
esse cache que fez o fix da vírgula no campo de peso parecer que não tinha
entrado no ar). **Sempre que alterar `app.js`, `styles.css` ou
`supabaseClient.js`, incremente esse número nos três lugares — e também em
`CACHE_NAME`/`APP_SHELL` dentro de `sw.js` (ver seção PWA acima).**

**`<base href="/pandafit/">`**: o app também é servido via Vercel a partir
da raiz deste repositório (ex: `erpconnect.vercel.app/pandafit`), e esse
host — ao contrário do GitHub Pages — não redireciona `.../pandafit` (sem
barra final) para `.../pandafit/`. Sem a barra, o navegador resolve os
caminhos relativos (`assets/styles.css`, `assets/app.js`, `manifest.json`,
`sw.js`) a partir da raiz do domínio em vez desta pasta, e nada carrega — a
tela de login aparecia sem nenhum CSS/JS aplicado. A tag `<base>` no
`<head>` fixa a URL-base da página independente de como ela foi aberta.

## Painel de Reports (`/reports`)

Painel interno para centralizar dashboards em HTML gerados pelo Claude:
upload com tema/tags, visualização renderizada (o HTML/JS é executado em
tela, não só linkado), busca/filtro, compartilhamento por link e dashboard
de indicadores. Stack: HTML/JS estático + Supabase (Auth, Postgres,
Storage, Edge Functions), mesmo padrão do `index.html` na raiz.

> **Só HTML (`.html`/`.htm`):** o upload aceita exclusivamente arquivos
> HTML — PDF/DOCX/MD/TXT foram removidos do escopo. O caso de uso é anexar
> dashboards que o Claude gera, então "visualizar" precisa executar o
> arquivo na tela (iframe), o que só faz sentido para HTML.

> **Sem resumo automático (removido):** a geração de resumo via Claude foi
> removida do MVP por depender de deploy de edge function + secret da
> Anthropic, o que estava travando o fluxo de upload. As colunas
> `summary`/`summary_status` continuam na tabela `reports` mas não são mais
> usadas pelo frontend. Se quiser reativar, a lógica original está no
> histórico do git (função `generate-summary` e botão "Reprocessar").

Páginas: `reports/index.html` (painel principal) e `reports/share.html`
(visualização pública read-only via link). `reports/login.html` fica com um
aviso apontando direto para o painel — **login está temporariamente
desabilitado**, ver abaixo.

> **Login desabilitado (temporário):** por padrão o painel exigia sessão via
> magic link. Isso foi desligado (migration `0003_disable_auth_requirement.sql`)
> para simplificar o teste inicial — o acesso está aberto para quem tiver a
> URL, sem exigir autenticação, e todo upload é registrado como
> "Anônimo (login desabilitado)". Antes de expor o painel além do piloto
> interno, reavaliar e reverter para as políticas autenticadas da migration
> `0002` (requisito de LGPD/segurança do PRD).

### Setup no projeto Supabase (`ClaudeProjects`)

1. Aplicar as migrations, em ordem:
   - `supabase/migrations/0002_create_reports_panel.sql` (tabelas
     `reports`/`audit_logs`, RLS, bucket de storage `reports`)
   - `supabase/migrations/0003_disable_auth_requirement.sql` (abre o acesso
     para o anon key — só aplicar se realmente quiser o painel sem login)
2. Deploy da Edge Function `supabase/functions/share-report` (usada pelo
   link de compartilhamento). **No projeto atual ela está deployada sob o
   slug `rapid-worker`** (o slug é fixado na criação e não pode ser
   renomeado depois) — por isso `reports/share.html` chama
   `supabase.functions.invoke("rapid-worker", ...)` em vez de
   `"share-report"`. Se você recriar essa function do zero com o nome
   correto, atualize a constante `SHARE_FUNCTION_NAME` em `share.html`.
3. Magic link (Email OTP) no Supabase Auth pode continuar habilitado sem
   problema — o painel simplesmente não exige mais uma sessão para funcionar.

### Hospedagem (GitHub Pages) e cache

O painel é servido via GitHub Pages a partir deste repositório. `styles.css`,
`app.js` e `supabaseClient.js` são referenciados com `?v=N` (ex:
`./assets/app.js?v=3`) para forçar o navegador a buscar a versão nova depois
de cada deploy — sem isso, o CDN do GitHub Pages e o cache do navegador podem
continuar servindo a versão antiga por vários minutos mesmo depois do merge.
**Sempre que alterar `styles.css`, `app.js` ou `supabaseClient.js`, incremente
esse número em todos os arquivos que os referenciam** (`index.html`,
`login.html`, `share.html`, e o `import` dentro do próprio `app.js`).

O topo do painel (`reports/index.html`) também mostra dois horários de
"deploy": um fixo no HTML (`index.html`) e outro escrito via JS
(`APP_JS_BUILD`, em `assets/app.js`). Servem para diagnosticar cache: se o
que aparece na tela estiver desatualizado em relação ao último commit, é
cache do CDN/navegador, não bug de código. **Sempre que alterar `index.html`
ou `app.js`, atualize esses dois timestamps também** (mesma lógica do `?v=N`).

> Esta seção é específica do Reports Panel — não confundir com o AppVendas
> logo abaixo, que segue uma regra diferente e mais restrita (ver "Cache do
> `app.js`" na seção AppVendas): lá, só `styles.css` é versionado com
> `?v=N`; o entry point e os imports internos (`app.js`, `supabaseClient.js`)
> não podem ser, sob pena de duplicar a instância do módulo.

## AppVendas (`/appvendas`)

Aplicação corporativa de gestão de vendas: menu lateral com **Cadastros**
(Clientes, Produtos, Fornecedores), **Movimentações** (Vendas e
Agendamento) e **Relatórios**. Mesmo padrão do resto do repo: HTML/JS
estático + Supabase, sem build, no projeto `ClaudeProjects`.

- `appvendas/index.html` — shell com sidebar, roteamento por hash
  (`#/clientes`, `#/produtos`, `#/fornecedores`, `#/vendas`, `#/agenda`,
  `#/relatorios`).
- `appvendas/assets/cadastro.js` — motor genérico de CRUD (listar, buscar,
  criar/editar via modal, excluir) reaproveitado por `clientes.js`,
  `produtos.js` e `fornecedores.js`, que só configuram campos e colunas.
- `appvendas/assets/vendas.js` — tela de "Vendas" (grupo Movimentações):
  monta o carrinho (produto + quantidade), finaliza a venda via RPC
  `criar_venda` e lista o histórico com detalhe (recibo) e cancelamento
  (RPC `cancelar_venda`).
- `appvendas/assets/agenda.js` — tela de "Agendamento" (item próprio no
  menu, dentro do grupo Movimentações, fora da tela de Vendas): agenda
  de atendimentos por cliente/produto com visão dia/semana/mês sobre a
  tabela `agendamentos`
  (`data_agendamento`, `horario`, `status` "agendado"/"atendido",
  `cliente_id`, `produto_id`, `observacoes`).
- `appvendas/assets/relatorios.js` — faturamento, ticket médio, produtos
  mais vendidos, melhores clientes e estoque baixo.
- `appvendas/assets/crm.js` — tela "CRM" (grupo Movimentações): cadastro
  de **Propostas** (orçamento para lead ou cliente). Ver subseção própria
  abaixo.

**Banco (migration `0004_create_appvendas_schema.sql`, já aplicada no
projeto `ClaudeProjects`):** tabelas `clientes`, `fornecedores`, `produtos`,
`vendas`, `venda_itens`. A baixa e devolução de estoque acontecem dentro
de funções Postgres (`criar_venda`/`cancelar_venda`, `security definer`)
para garantir atomicidade: se algum item não tiver estoque suficiente, a
venda inteira é revertida. A tabela `agendamentos` (usada por `agenda.js`)
**não tem migration correspondente neste repositório** — foi criada
diretamente no projeto Supabase; vale registrar essa migration
retroativamente se mexer no schema de novo.

> **Login real desde a migration `0005`** (esta seção descrevia "sem
> login/RLS pública" — isso valia só para o schema inicial da `0004` e
> ficou desatualizado). Hoje o acesso exige sessão (usuário/senha, ver
> `auth.js`) e RLS multiempresa por `empresa_id`: um usuário normal só
> enxerga/edita dados da própria empresa; `role = 'admin'` **sem**
> `empresa_id` (admin "global") enxerga todas. A migration `0020` fechou um
> escalonamento de privilégio em que um admin vinculado a uma única empresa
> conseguia se promover a admin global ou mexer em usuários/empresas de
> fora da própria — ver `supabase/functions/manage-usuarios/index.ts` e as
> policies de `usuarios`/`empresas`. Por isso a tela **Empresas** (menu
> Administração) passou a exigir admin global, mesmo racional que já valia
> para **Configurações**.

> **Criação do primeiro admin exige um segredo de bootstrap:** com a
> tabela `usuarios` vazia, `manage-usuarios` aceita criar o primeiro
> administrador sem sessão (ninguém consegue estar logado ainda) — mas só
> se o payload incluir `bootstrap_secret` batendo com a secret
> `APPVENDAS_BOOTSTRAP_SECRET` do projeto Supabase. Configure com
> `supabase secrets set APPVENDAS_BOOTSTRAP_SECRET=<string aleatória sua>`
> **antes** de fazer o setup inicial, e chame a function uma vez (ex. via
> `curl`) com esse valor. Sem a secret configurada, a criação do primeiro
> admin é sempre rejeitada.

> **Conta de teste (role `caixa`):** existe uma conta de teste (`qa.appvendas`)
> usada para validar telas end-to-end (Vendas, Agendamento) sem usar uma
> conta pessoal — a senha está no gerenciador de senhas interno, não neste
> arquivo. Rotacionar/remover antes de abrir o app além do piloto interno.

### CRM · Propostas (`appvendas/assets/crm.js`, migration `0031`)

Cadastro de propostas comerciais (orçamento) para um **lead** (nome digitado
livremente, sem cadastro) ou um **cliente** já cadastrado — telefone/e-mail
são buscados do cadastro do cliente (campo travado) ou digitados livremente
para um lead. Cada proposta leva N produtos com preço editável por item (é
um orçamento, não uma venda a preço de tabela) e calcula o total
automaticamente; **nunca mexe em estoque** — só a tela de Vendas faz baixa
de estoque, quando (e se) a proposta virar uma venda de verdade.

- **Status:** `draft` → `enviada` → `aprovada`/`reprovada` (RPC
  `atualizar_status_proposta`). Reprovar exige motivo (campo obrigatório,
  também reforçado por `check` constraint na tabela). Sem matriz rígida de
  transição — dá pra corrigir um status errado a qualquer momento.
- **Edição:** só permitida em `draft` (RPC `atualizar_proposta` — depois de
  enviada, mudar os itens por baixo geraria uma proposta diferente da que o
  contato recebeu).
- **Impressão/PDF:** sem lib nova — `crm.js` monta a proposta num container
  escondido (`#print-proposta`) e chama `window.print()`; o diálogo de
  impressão do navegador já oferece "Salvar como PDF" como destino.
- **Envio por e-mail:** edge function `supabase/functions/enviar-proposta`
  (verify_jwt ligado — chamado autenticado, mesmo racional de
  `create-stripe-checkout`), reaproveitando a mesma infra Resend do
  `appvendas-lembretes`/Oráculo. Marca a proposta como `enviada`
  automaticamente se ainda estiver em `draft`.
- **Integração com Vendas/Matrículas (nenhuma proposta aprovada fica
  "solta"):** ao aprovar, `crm.js` pergunta se a proposta já vira negócio
  agora. Item de produto físico vira **Venda** (Loja); item de serviço vira
  **Matrícula** — mesma separação de `catalogo.js` (Loja só vende produto
  físico; serviço é sempre Matrícula). Uma proposta pode ter só um tipo, ou
  os dois — nesse caso os dois destinos são preenchidos em sequência (venda
  primeiro, depois matrícula), sem o vendedor ter que reabrir a proposta e
  copiar os dados na mão. Em qualquer caso, o "prefill" (mesmo mecanismo
  `setVendaPrefill`/`setMatriculaPrefill` já usado por Agenda → Vendas/
  Matrículas) carrega cliente/lead, itens, **o preço negociado na proposta**
  (não o de catálogo — `criar_venda`/`criar_matricula` recebem o
  `p_proposta_id` e resolvem o valor negociado sozinhas, olhando
  `proposta_itens` da própria proposta; o `preco_unitario` que o front manda
  em `p_itens` é só o que aparece na tela, nunca o que é cobrado — ver
  migration `0044`) e o desconto
  (aplicado uma única vez, no primeiro registro gerado, pra não descontar a
  mesma proposta duas vezes quando ela vira venda + matrícula). Uma proposta
  só é marcada como convertida (`propostas.venda_id`/`matricula_id`/
  `convertida_em`, migrations `0032`/`0033`) **depois** que o registro existe
  de verdade em `vendas.js`/`matriculas.js` — nunca antes, senão um
  pagamento Stripe abandonado deixaria a proposta "convertida" sem nada por
  trás. Quem recusar a conversão na hora não perde a chance: o detalhe da
  proposta mostra "Aprovada, ainda não convertida em venda/matrícula"
  separadamente pra cada destino que ela precisa, e o botão "Converter…"
  continua disponível enquanto sobrar algum. Matrícula exige cliente
  cadastrado (não aceita lead sem cadastro) — um lead com item de serviço é
  avisado a virar cliente primeiro. Depois de qualquer conversão iniciada, a
  proposta trava (sem editar/aprovar/reprovar) — só imprimir/reenviar.

**Banco:** migration `0031_create_crm_propostas.sql` cria as tabelas
`propostas`/`proposta_itens`, RLS multiempresa igual ao restante do app, e as
funções `criar_proposta`/`atualizar_proposta`/`atualizar_status_proposta`
(`security definer`, `EXECUTE` restrito a `authenticated` — revogado de
`anon`, que ganha `EXECUTE` por padrão em toda função nova neste projeto;
mesma pegadinha corrigida em `0006`/`0012` para funções anteriores). A
migration `0032_propostas_venda_link.sql` acrescenta `propostas.venda_id`
(FK para `vendas`) e `convertida_em`. A migration
`0033_propostas_matricula_link_e_preco_override.sql` acrescenta
`propostas.matricula_id` (FK para `matriculas`) e o parâmetro
`p_valor_servico_override` em `criar_matricula` (preço negociado na
proposta, no lugar do preço de catálogo do curso/serviço) — **substituído em
`0044`** por `p_proposta_id`: o número solto vindo do cliente era aceito sem
checagem nenhuma (qualquer usuário autenticado podia contratar um curso, ou
comprar um produto via `criar_venda`, por qualquer valor). Agora o preço
negociado só é aplicado quando a proposta referenciada existe, é da mesma
empresa, está `aprovada` e tem um item daquele mesmo produto — resolvido
inteiramente no servidor.

### Lembretes e cobranças (`supabase/functions/appvendas-lembretes`)

Comunicação proativa com o aluno — antes o app era 100% reativo (nada
avisava ninguém fora de alguém abrir o painel). Dois lembretes automáticos:

- **Lembrete de aula:** no dia anterior, para agendamentos com status
  `agendado` e cliente vinculado (tabela `agendamentos`, coluna
  `lembrete_enviado_em` controla que cada agendamento só recebe um lembrete).
- **Cobrança de parcela vencida:** para parcelas de matrícula `pendente`
  com vencimento no passado, reenviada a cada 3 dias enquanto continuar em
  aberto (`matricula_parcelas.cobranca_enviada_em`).

Cada lembrete tenta WhatsApp primeiro (se o cliente tiver telefone) e cai
para e-mail (se tiver e-mail); sem nenhum dos dois, só marca como
processado para não ficar reprocessando.

> **Reaproveita a infra do Oráculo (Z-API/Resend), de propósito:** não são
> secrets novas — é o mesmo número de WhatsApp já conectado
> (`ZAPI_INSTANCE_ID`/`ZAPI_TOKEN`/`ZAPI_CLIENT_TOKEN`) e a mesma conta
> Resend (`RESEND_API_KEY`) usados pelo `oraculo-webhook`. Isso foi uma
> escolha deliberada — o roadmap já descrevia essa infra como "pronta,
> ociosa" para o AppVendas — não uma obrigação: se fizer mais sentido ter um
> número de WhatsApp Business dedicado ao AppVendas (separado do Oráculo,
> que dá conselhos pessoais a quem escrever), basta apontar
> `ZAPI_INSTANCE_ID`/`ZAPI_TOKEN` para uma instância própria nas secrets do
> projeto.

**Setup:**

1. Aplicar a migration `supabase/migrations/0021_faixa_roxa_comunicacao_e_presenca.sql`.
2. Deploy sem verificação de JWT (quem chama é o scheduler, não um cliente
   Supabase autenticado — mesmo racional de `oraculo-webhook`):
   ```
   supabase functions deploy appvendas-lembretes --no-verify-jwt
   ```
3. Configurar a secret própria do endpoint (além das já existentes
   `ZAPI_INSTANCE_ID`/`ZAPI_TOKEN`/`ZAPI_CLIENT_TOKEN`/`RESEND_API_KEY`, que
   provavelmente já estão configuradas para o Oráculo):
   ```
   supabase secrets set APPVENDAS_LEMBRETES_SECRET=<string aleatória sua>
   ```
4. **Agendar a chamada — a function não tem cron embutido, só processa o
   que encontrar quando é chamada.** Duas opções:
   - Supabase Cron (Database → Cron Jobs no painel, usa `pg_cron` +
     `pg_net`): agendar um `POST`/`GET` diário para
     `https://<seu-projeto>.supabase.co/functions/v1/appvendas-lembretes?secret=<APPVENDAS_LEMBRETES_SECRET>`.
   - Um scheduler externo (cron-job.org, GitHub Actions com `schedule`,
     etc.) apontando pra essa mesma URL 1x por dia.

### Badges de pendência no menu, renovar matrícula e check-in de presença

- **Badges no menu** (`app.js`, `refreshPendencyBadges`): contador de
  parcelas vencidas ao lado de "Contas a Receber" e de produtos com estoque
  baixo ao lado de "Estoques", atualizados a cada minuto — antes só
  apareciam abrindo o painel Início.
- **Renovar matrícula** (`matriculas.js`, botão no detalhe): pré-preenche
  uma nova matrícula com cliente, curso, duração, parcelas e forma de
  pagamento da matrícula original, reaproveitando o mesmo mecanismo de
  prefill já usado no fluxo Agenda → Matrículas.
- **Check-in de presença** (`agenda.js`, coluna
  `agendamentos.presenca_confirmada`): registro de frequência do aluno
  independente do status agendado/atendido — que hoje só muda quando o
  atendimento vira venda ou matrícula.

> **"Estoque baixo" contava serviço (bug corrigido):** as telas de Início,
> Estoques e o badge do menu comparavam `estoque <= estoque_minimo` para
> **todos** os produtos ativos, sem excluir `tipo = 'servico'` (curso/
> mensalidade — nunca recebe entrada de estoque, ver migration 0017). Um
> serviço com `estoque` zerado por padrão ficava marcado como "baixo" pra
> sempre. `relatorios.js` já filtrava certo (`tipo === "produto"`); as
> outras três telas foram corrigidas para o mesmo filtro.

### Agendamento público (`appvendas/agendamento-publico.html`)

Segunda via de marcar um atendimento na Agenda, além de um funcionário
criar direto na tela interna: um link público (sem login) que qualquer
pessoa com acesso pode usar para agendar um **serviço** (curso/mensalidade
— nunca produto físico) sozinha. Botão "Link de agendamento" na tela
Agenda abre o link numa nova aba (e tenta copiar pra área de transferência).

- `appvendas/agendamento-publico.html` / `appvendas/assets/agendamento-publico.js`
  — mesmo padrão de `pre-cadastro.html`: HTML/JS isolado, sem `app.js`/
  `auth.js`, com honeypot + tempo mínimo de preenchimento contra spam.
- **Banco (migration `0022_agendamento_publico.sql`):** três RPCs
  `security definer` liberadas para `anon` — `agenda_publica_info`
  (nome da empresa, grade de horários, catálogo de serviços),
  `horarios_ocupados_publico` (pra desabilitar horário já tomado antes de
  enviar) e `agendar_publico` (cria o agendamento e, se o CPF/CNPJ ainda
  não existir na base, um cliente novo com `status_cadastro = 'pendente'`
  — mesmo fluxo de revisão do pré-cadastro). Valida servidor-side que o
  horário está na grade configurada da empresa e que o produto é
  `tipo = 'servico'`; limite de 30 agendamentos por empresa a cada 10
  minutos contra abuso (mesmo racional de `pre_cadastro_cliente`, mas mais
  crítico aqui — spam nesta rota ocupa horários de verdade, não só cria
  cadastros pendentes).
- Testado manualmente ponta a ponta como papel `anon` num Postgres local:
  código de empresa inválido, produto físico rejeitado, conflito de
  horário rejeitado, horário fora da grade rejeitado, e reagendar com o
  mesmo documento reaproveita o cliente em vez de duplicar.

### Cache do `app.js` — NÃO adicione `?v=N` no `<script>` de entrada

Ao contrário do Reports Panel (ver seção seguinte), o `<script>` de entrada
de `appvendas/index.html` **não pode** ter um especificador versionado
(`./assets/app.js?v=N`). Todo o resto do app importa `app.js` sem versão
(`import { ... } from "./app.js"` em `vendas.js`, `agenda.js`, `clientes.js`,
`login.js` etc.) — o ES modules identifica um módulo pela URL exata do
import, então um entry point com `?v=` cria uma **segunda instância**
separada do módulo, com seus próprios efeitos colaterais de topo (listener
de `hashchange`, `boot()`) rodando em paralelo com estado independente.
Isso já causou fetches/renders duplicados (corrigido no commit `e4f8448`) e
foi reintroduzido e revertido de novo em `3659424`/`e75bd3a` — se a ideia de
versionar o entry point voltar a parecer boa, é armadilha, não melhoria.

Para diagnosticar cache antigo sem versionar o script: a sidebar mostra
`build <APP_BUILD>` (constante em `assets/app.js`, exibida via
`#sidebar-build` em `index.html`). Se a data não bater com o timestamp do
último commit em `app.js`, é cache do navegador/CDN do GitHub Pages — peça
um hard refresh (Ctrl+Shift+R), não mexa no `<script src>`.

## Oráculo — conselhos via WhatsApp (`supabase/functions/oraculo-webhook`)

Agente que dá conselhos pessoais e profissionais por WhatsApp. Sem painel
web — a interface é a própria conversa no WhatsApp. Fluxo: Z-API recebe a
mensagem no número conectado e chama o webhook (Edge Function
`oraculo-webhook`); a function busca o histórico da conversa, chama a API
da Anthropic (`claude-sonnet-5`) para gerar a resposta, salva o histórico e
manda a resposta de volta pelo Z-API.

- **Banco (migration `0010_create_oraculo_agent.sql`):** tabelas
  `oraculo_conversas` (uma linha por telefone) e `oraculo_mensagens`
  (histórico, `role` `user`/`assistant`). RLS habilitada **sem nenhuma
  policy** — só a service role (usada dentro da function) acessa; nem
  `anon` nem `authenticated` enxergam essas tabelas.
- **Aberto a qualquer número** que mandar mensagem para o WhatsApp
  conectado (não há allowlist). Para conter custo/abuso da API paga da
  Anthropic, há rate limit de **20 mensagens por conversa a cada 15
  minutos** — acima disso o Oráculo responde pedindo para aguardar, sem
  chamar a Anthropic.
- **Texto e voz:** mensagem de texto gera resposta em texto. Mensagem de
  áudio é transcrita pela API de speech-to-text da ElevenLabs (`scribe_v2`)
  antes de entrar no fluxo normal, e a resposta é sintetizada de volta em
  áudio pela API de text-to-speech da ElevenLabs (`eleven_multilingual_v2`,
  mp3) e enviada como voice note pelo Z-API. Se a transcrição falhar, o
  Oráculo pede para gravar de novo ou escrever; se a síntese/envio de voz
  falhar, a resposta cai para texto em vez de se perder. Imagem e documento
  ainda não são processados — geram uma resposta automática pedindo texto
  ou áudio.
- **Idempotência:** o `messageId` do Z-API é gravado em
  `zapi_message_id` (unique index parcial); se o Z-API reentregar a mesma
  mensagem (retry), o insert é rejeitado e nada é reprocessado nem
  reenviado ao usuário.
- **Resumo por e-mail a pedido do usuário:** a Anthropic tem a ferramenta
  `enviar_resumo_admin` disponível em toda mensagem, mas só a chama quando o
  usuário pede explicitamente para mandar um resumo/relatório da conversa
  para o administrador (ex: "manda um resumo disso pro suporte"). Não há
  envio automático nem periódico — é sempre a pedido, dentro da própria
  conversa. Quando chamada, a function busca o histórico completo daquela
  conversa (não só a janela de `HISTORICO_LIMITE`) e pede à Anthropic, numa
  chamada separada, para **separar a conversa por assunto** (ex: carreira,
  relacionamento, finanças) — cada assunto identificado entra no e-mail com
  seu próprio resumo + conclusão sobre o desfecho. Uma conversa de assunto
  único gera só um bloco. O e-mail é mandado via Resend para
  `ORACULO_RESUMO_EMAIL`. Se falhar em qualquer etapa, o Oráculo avisa o
  usuário em vez de fingir que enviou.
  > **Entregabilidade:** o remetente usado é o sandbox `onboarding@resend.dev`
  > (sem domínio próprio verificado). A Resend confirma entrega
  > (`last_event: "delivered"`), mas provedores como Hotmail/Outlook podem
  > descartar ou filtrar silenciosamente e-mails desse remetente sem
  > reputação de domínio própria — se o e-mail não aparecer nem no Spam,
  > isso é o motivo mais provável. Verificar um domínio próprio no Resend e
  > trocar a constante `RESEND_FROM` resolve isso definitivamente.

### Setup

1. Aplicar a migration `supabase/migrations/0010_create_oraculo_agent.sql`.
2. Deploy da function **sem verificação de JWT** (quem chama é o Z-API, não
   um cliente Supabase autenticado — mesmo racional de `mcp-cep` e
   `share-report`):
   ```
   supabase functions deploy oraculo-webhook --no-verify-jwt
   ```
3. Configurar as secrets no projeto Supabase (`ClaudeProjects`):
   ```
   supabase secrets set \
     ANTHROPIC_API_KEY=sk-ant-... \
     ZAPI_INSTANCE_ID=... \
     ZAPI_TOKEN=... \
     ZAPI_CLIENT_TOKEN=... \
     ORACULO_WEBHOOK_SECRET=<string aleatória sua> \
     ELEVENLABS_API_KEY=... \
     ELEVENLABS_VOICE_ID=<id da voz escolhida na sua conta ElevenLabs> \
     RESEND_API_KEY=re_... \
     ORACULO_RESUMO_EMAIL=rodrigosilvapmp@hotmail.com
   ```
   `ANTHROPIC_API_KEY` provavelmente já existe (usada pelo gerador de
   LinkedIn) — só falta configurar as demais se ainda não existirem.
   `ELEVENLABS_VOICE_ID` é o id de uma voz da sua biblioteca na ElevenLabs
   (painel ElevenLabs → Voices → copiar o Voice ID). O remetente do e-mail
   usado no código é o sandbox `onboarding@resend.dev`, que só entrega para
   o e-mail cadastrado na própria conta Resend — por isso `ORACULO_RESUMO_EMAIL`
   precisa ser esse mesmo e-mail, a menos que um domínio próprio seja
   verificado no Resend (nesse caso, troque a constante `RESEND_FROM` em
   `supabase/functions/oraculo-webhook/index.ts`).
4. No painel do Z-API, configurar a URL de webhook "ao receber mensagem"
   apontando para:
   ```
   https://<seu-projeto>.supabase.co/functions/v1/oraculo-webhook?secret=<ORACULO_WEBHOOK_SECRET>
   ```
   O `?secret=` é a única camada de autenticação do endpoint (Z-API não
   assina o payload) — sem ele batendo com `ORACULO_WEBHOOK_SECRET`, a
   function responde `401` e não processa nada.

> **Custo:** o endpoint está aberto para qualquer número que mandar
> mensagem para o WhatsApp conectado, e cada resposta consome créditos da
> API da Anthropic — e, quando a conversa é por voz, também créditos de
> speech-to-text e text-to-speech da ElevenLabs. Pedir repetidamente o envio
> de resumo (`enviar_resumo_admin`) soma mais uma chamada à Anthropic e um
> envio pelo Resend por pedido — mesmo rate limit por conversa cobre esse
> caso. O rate limit por conversa é a única mitigação no MVP — se o volume
> crescer, vale revisitar (allowlist, captcha, limite global).

## Cowork (`/cowork`)

Clone do "Claude Cowork": o usuário cria **projetos**, define **instruções
de agente** (como o Cowork faz com instruções de projeto), anexa **arquivos
de referência** (PDF, imagem, DOCX, XLSX, TXT/MD/CSV) e pede em linguagem
natural uma planilha, um documento ou uma apresentação. A Claude gera a
estrutura do conteúdo e o browser monta o arquivo Office real (`.xlsx` /
`.docx` / `.pptx`) na hora, pronto pra baixar. Mesmo padrão HTML/JS estático
+ Supabase do resto do repo, mas com login obrigatório e dados privados por
usuário (diferente do Reports Panel, que é visível ao time todo).

- `cowork/login.html` — magic link (Supabase Auth, Email OTP), mesmo padrão
  já usado no Reports Panel.
- `cowork/index.html` + `cowork/assets/app.js` — shell da app: barra lateral
  de projetos, painel do projeto ativo (instruções do agente, arquivos de
  referência, composer de geração) e o feed de documentos gerados.
- `cowork/assets/projects.js` — CRUD de projetos e arquivos de referência.
- `cowork/assets/fileExtract.js` — extração de anexos no client: PDF/imagem
  viram anexo nativo (a Claude lê direto, sem OCR manual); DOCX (via
  `mammoth`), XLSX (via `exceljs`) e TXT/MD/CSV viram texto extraído, salvo
  em `cowork_reference_files.extracted_text` pra não reprocessar a cada
  geração.
- `cowork/assets/generate.js` — chama a Edge Function, monta o arquivo Office
  no client com os builders abaixo e sobe pro Storage.
- `cowork/assets/builders/{xlsx,docx,pptx}.js` — montam o arquivo de verdade
  a partir da estrutura (`spec`) devolvida pela Claude, usando `exceljs`
  (planilha com estilo — cabeçalho colorido, largura de coluna, filtro),
  `docx` (documento com títulos, listas, tabelas) e `pptxgenjs`
  (apresentação com múltiplos layouts de slide), todos carregados via
  `esm.sh` sem build step.

**Edge Function `cowork-generate-document`:** recebe o pedido do usuário +
instruções do projeto + anexos, e força a resposta da Claude via **tool
use** (um schema por tipo de saída — `build_spreadsheet` / `build_document`
/ `build_presentation`) em vez de pedir JSON solto no texto, o que evita
respostas mal formadas. Suporta ajuste iterativo: o botão "Pedir ajuste" num
documento já gerado reenvia a estrutura anterior + o feedback do usuário, e
a Claude devolve uma revisão completa (mesma lógica de feedback do
`generate-linkedin-post`). Requer a secret `ANTHROPIC_API_KEY` (já configurada
no projeto Supabase para as outras functions).

**Banco (migration `0024_create_cowork_schema.sql`):** tabelas
`cowork_projects`, `cowork_reference_files` e `cowork_documents`, todas com
RLS **por dono** (`auth.uid() = owner_id`) — diferente do Reports Panel,
aqui cada usuário só enxerga os próprios projetos e documentos. Dois buckets
de Storage privados (`cowork-references`, `cowork-documents`), com policy
restringindo cada usuário à própria pasta (primeiro segmento do path =
`auth.uid()`).

### Setup no projeto Supabase (`ClaudeProjects`)

1. Aplicar a migration `supabase/migrations/0024_create_cowork_schema.sql`.
2. Deploy da Edge Function `supabase/functions/cowork-generate-document`.
3. Confirmar que a secret `ANTHROPIC_API_KEY` já está configurada (é a mesma
   usada por `generate-linkedin-post`) — se não estiver, `supabase secrets
   set ANTHROPIC_API_KEY=sk-ant-...`.
4. Confirmar que o Email OTP (magic link) está habilitado no Supabase Auth
   do projeto (já é usado pelo Reports Panel).

> **Custo:** cada geração (e cada "Pedir ajuste") é uma chamada à API da
> Anthropic com `max_tokens: 8192` e possivelmente anexos grandes (PDF/imagem
> em base64) — sem rate limit por usuário no MVP. Se o Cowork for exposto
> além de um piloto interno, vale adicionar um limite de gerações por
> usuário/dia.
