# PandaFit: revisão de UX e CX

Revisão feita sobre o código atual (`pandafit/index.html`, `assets/app.js`, `assets/styles.css`, `sw.js`), versão `v31`, em 26/09/2026.

## Resumo executivo

O PandaFit já tem uma base sólida: PWA instalável, dark mode, cache offline, papéis (usuário, médico, admin), metas, conquistas e resumo de exames com IA. O que trava a experiência hoje não é falta de feature, é **fricção no loop principal** (registrar treino e peso) e **arquitetura de informação** (coisas importantes enterradas em Configurações).

Três movimentos resolvem a maior parte:

1. **Blindar o loop principal**: cronômetro que não se perde, registro em 2 toques, desfazer em vez de "tem certeza?".
2. **Reorganizar a navegação**: Exames e Progresso (peso, medidas, fotos) viram destinos de primeiro nível; Configurações fica só com cadastros.
3. **Fechar o gap de confiança**: corrigir a falha de escape de HTML na visão do médico (risco real de segurança e LGPD) e deixar explícito o que o médico enxerga.

---

## P0: corrigir antes de qualquer coisa

| # | Problema | Evidência | Impacto | Recomendação |
|---|---|---|---|---|
| 1 | **Nome de arquivo, nome de paciente, modalidade e local entram no HTML sem escape.** Um paciente que envia um exame com nome malicioso executa script na sessão do médico, que tem acesso a exames de vários pacientes. | `app.js:3519` (`doc.file_name`), `app.js:3407` (`p.nome`, `p.email`), `app.js:2390` e `app.js:3700` (`w.type`, `w.local`, inclusive na visão do médico). `escapeHtml` existe (`app.js:780`) mas só é usado no resumo de IA. | Segurança, LGPD (dado de saúde), confiança do médico no produto. | Passar todo dado do usuário por `escapeHtml` antes de `innerHTML`, ou montar as linhas com `textContent`. Validar também no upload (sanitizar `file_name`). |
| 2 | **Cronômetro perde o treino.** O tempo é um contador em memória (`state.secs += 1` a cada segundo). Fechar o app, trocar de aba no iPhone ou o sistema suspender o PWA zera ou atrasa o relógio. | `app.js:1403-1428` | É o momento de maior intenção do usuário; perder 1h de treino destrói confiança no app. | Guardar `startedAt` (timestamp) em `localStorage` e calcular `agora - startedAt`. Ao reabrir, mostrar "Treino em andamento desde 18:42". |
| 3 | **Não existe "Esqueci minha senha".** A tela de login só diz "fale com o administrador". | `index.html:63` | Todo esquecimento vira chamado para o admin (você). | Link com `supabase.auth.resetPasswordForEmail`. Custo baixo, remove dependência humana. |
| 4 | **Senha inicial digitada em campo de texto aberto** e sem troca obrigatória no primeiro acesso. | `index.html:611` (`type="text"`) | Senha visível na tela do admin; senha provisória vira definitiva. | `type="password"` com botão mostrar/ocultar, ou convite por e-mail (magic link). Forçar troca no primeiro login. |

---

## P1: alto impacto na experiência

### Loop principal (registrar)

| # | Melhoria | Por quê | Onde |
|---|---|---|---|
| 5 | **Botão "Repetir último treino"** no Painel (mesma modalidade, local e exercícios). | A maioria dos treinos se repete. Hoje são 4 a 6 toques e troca de aba. | Painel, acima do calendário |
| 6 | **Cronômetro pede data/local no fim, não força "hoje".** | Treino que passa da meia-noite ou registrado depois vai para o dia errado. | `app.js:1606` |
| 7 | **Desfazer (undo) em vez de modal de confirmação** para excluir treino, peso e medida. Toast "Treino excluído · Desfazer" por 5s. | Modal a cada exclusão cansa; undo é mais rápido e mais seguro. | `app.js:1682`, `1755`, `1866` |
| 8 | **Toque no dia do calendário** abre os treinos daquele dia ou já inicia um registro com a data preenchida. | O calendário hoje é só visual (`<span>` com `title`, que nem aparece no celular). | `app.js:2271-2304` |
| 9 | **Stepper de peso** com o último valor pré-preenchido (78,4 → botões −0,1 / +0,1). | Pesar todo dia vira 1 toque + Salvar. | `index.html:225` |
| 10 | **Série rápida de exercícios**: "copiar série anterior" e carga/reps pré-preenchidas com a última execução daquele exercício. | Digitar reps e carga no meio do treino, com a mão suada, é a maior fricção do registro detalhado. | `renderExercisesEditor`, `app.js:1517` |

### Arquitetura de informação

| # | Melhoria | Por quê |
|---|---|---|
| 11 | **Tab bar com 4 destinos e ícones reais**: Painel · Registrar · Progresso · Exames (Config. vai para o avatar no topo). | Hoje as abas são bolinhas iguais (`.tab-mark`) com rótulo em caixa alta de 11px; Exames está enterrado em Config. › Exames, mas é o principal elo com o médico. |
| 12 | **Separar "Registrar" de "Progresso"**. A seção Peso junta formulário de peso, gráfico, histórico com filtro, formulário de medidas, histórico de medidas, upload de foto e galeria: 7 blocos numa rolagem. | Registrar é ação rápida; Progresso é consulta. Misturar os dois deixa as duas coisas piores. |
| 13 | **Meta e Conquistas saem de Configurações** e aparecem no Painel (progresso da meta e última conquista desbloqueada). | Motivação não pode estar escondida atrás de uma tela de ajustes. |
| 14 | **O avatar do topo abre um menu da conta** (nome, papel, Configurações, Sair), não um "Sair da conta?" direto. | Hoje tocar no avatar só oferece logout, o que surpreende. |

### Estados, feedback e erro

| # | Melhoria | Onde |
|---|---|---|
| 15 | **Erro com botão "Tentar de novo"**, não "Recarregue a página". | `app.js:2320` e demais `loadError` |
| 16 | **Skeletons em vez de "Carregando…"** nas listas. | Painel, Exames, Pacientes |
| 17 | **Toasts acessíveis e consistentes**: `role="status"` / `aria-live`, posição fixa acima da tab bar, variação de cor para erro vs sucesso. Hoje são 11 toasters diferentes presos a cada cartão, alguns fora da área visível após rolar. | `app.js:1015-1036` |
| 18 | **Celebração ao bater a meta ou desbloquear conquista** (toast especial, confete leve, respeitando `prefers-reduced-motion`). | Conquistas só são vistas se o usuário entrar em Config. › Meta. |
| 19 | **Lembretes dispensados continuam dispensados** (persistir por dia em `localStorage`) e ganham ação direta: "Registrar peso agora". | `app.js:2217-2262`: o dispensar vive só em memória e volta a cada abertura. |

---

## P2: refinamento e acessibilidade

| # | Melhoria | Detalhe |
|---|---|---|
| 20 | Modal de confirmação acessível | Fechar com Esc e toque fora, foco preso no modal, `role="dialog"` e `aria-modal`. `app.js:995` |
| 21 | Foco visível | Não há regra `:focus-visible` no CSS; navegação por teclado fica invisível. |
| 22 | Tipografia | Botão Salvar em caixa alta com `letter-spacing: 0.1em` e abas com 11px em caixa alta reduzem legibilidade. Usar sentence case e mínimo de 12–13px. |
| 23 | Mês por extenso | "Set 2026" → "Setembro 2026" no cabeçalho do Painel (`app.js:25`). |
| 24 | Paginação de 5 itens | Trocar por lista contínua com "Ver mais" (`RECORDS_PAGE_SIZE = 5`, `app.js:4`). |
| 25 | Swipe para editar/excluir | Linhas hoje têm dois ícones de 15px lado a lado, alvo de toque apertado. |
| 26 | Validação inline | Mensagens junto ao campo (peso inválido, meta fora de 1–30) em vez de toast distante. |
| 27 | Relatório para o médico | `window.print()` funciona mal em PWA no iOS. Gerar PDF ou link de compartilhamento temporário. |
| 28 | Fotos de progresso | Comparador lado a lado (antes/depois) com slider; hoje é só galeria. |
| 29 | Ícone e marca | Favicon é emoji 🐼 e o app usa um traço de batimento como logo: unificar identidade. |

---

## CX: relação, confiança e jornada

| # | Melhoria | Por quê |
|---|---|---|
| 30 | **Onboarding de 3 passos no primeiro login**: definir meta, escolher modalidades, registrar peso inicial. | Hoje o usuário novo cai num Painel vazio com "0 de 12" e nenhuma orientação. Primeiro valor percebido precisa acontecer em menos de 2 minutos. |
| 31 | **Transparência sobre o médico** (LGPD): tela "Quem vê meus dados" listando médicos vinculados e o que cada um acessa (exames, peso, fotos, treinos), com opção de revogar ou pedir revogação. | Dado de saúde e foto corporal. Consentimento explícito gera confiança e reduz risco jurídico. |
| 32 | **Aviso claro na IA de exames para o paciente**: se o resumo com IA existir, o paciente deve saber que o exame foi processado por IA e por quem. | Governança de IA: human in the loop visível, não só no rodapé do texto. |
| 33 | **Canal de feedback dentro do app** ("Sugerir melhoria" em Config.) enviando para planilha ou n8n. | Fecha o ciclo de discovery contínuo com usuários reais. |
| 34 | **Resumo semanal** (push ou e-mail via Resend): treinos da semana, peso, distância da meta. | Engajamento fora do app; hoje o app só "fala" quando é aberto. |
| 35 | **Visão do médico orientada a decisão**: no topo do paciente, um cartão "Desde a última consulta" (variação de peso, cintura, frequência de treino, exames novos). | O médico hoje rola 6 seções para montar o quadro na cabeça. |

---

## Priorização (ICE)

| Item | Impacto | Confiança | Facilidade | ICE | Onda |
|---|---|---|---|---|---|
| 1. Escape de HTML | 10 | 10 | 9 | 900 | Agora |
| 2. Cronômetro persistente | 9 | 9 | 8 | 648 | Agora |
| 3. Esqueci a senha | 7 | 9 | 9 | 567 | Agora |
| 5. Repetir último treino | 8 | 8 | 8 | 512 | Sprint 1 |
| 9. Stepper de peso | 6 | 8 | 9 | 432 | Sprint 1 |
| 7. Undo na exclusão | 6 | 8 | 8 | 384 | Sprint 1 |
| 30. Onboarding | 8 | 7 | 6 | 336 | Sprint 2 |
| 31. Quem vê meus dados | 8 | 8 | 5 | 320 | Sprint 2 |
| 35. Cartão do médico | 7 | 7 | 6 | 294 | Sprint 2 |
| 11/12. Nova tab bar + Progresso | 8 | 7 | 5 | 280 | Sprint 3 |
| 34. Resumo semanal | 7 | 6 | 5 | 210 | Sprint 3 |

## Métricas para acompanhar

- **Tempo até registrar um treino** (abrir app → salvar): meta abaixo de 15s.
- **Treinos registrados por usuário ativo por semana** (North Star candidata).
- **% de dias com peso registrado** entre usuários que têm meta de peso.
- **Retenção D7 e D30** de novos usuários (efeito do onboarding).
- **Chamados ao admin por senha** (deve ir a zero com o item 3).
- **Uso da visão do médico**: pacientes abertos por consulta e resumos de IA gerados.

## Próximos passos

1. Corrigir itens 1 a 4 em um PR curto de "confiança e segurança".
2. Sprint 1 com os atalhos do loop principal (5, 7, 9) e medir tempo de registro antes e depois.
3. Em paralelo, prototipar a nova navegação (itens 11 a 14) e validar com 2 ou 3 usuários reais antes de codar.
