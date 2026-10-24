# Escritório de Agentes (pixel art)

Três agentes de Claude Code produzem posts de LinkedIn para o Rodrigo Silva, trabalhando "em tela" num escritório pixel art ([pixel-agents](https://www.npmjs.com/package/pixel-agents)). Você faz o pedido num painel também em pixel art e recebe **o post revisado** e **a arte gráfica com o logotipo**.

## A equipe

| Agente | Papel | Entrega |
|---|---|---|
| **Tiago** (o escritor) | escreve a copy com título chamativo e zero travessões; reescreve quando o Roberto reprova | `post-vN.md` |
| **Roberto** (o revisor) | roda a checagem automática e faz leitura crítica (português, concordância, coerência, título, postura de CIO/CTO); emite veredito | `revisao-vN.md` |
| **Eloah** (artista) | cria o criativo 1080x1350 com o logotipo e renderiza o PNG | `arte.html` + `arte.png` |

## Fluxo

```
Painel (pedido) ─▶ Tiago escreve v1 ─▶ Roberto revisa
                        ▲                   │
                        └── REPROVADO ◀─────┤  (máx. 3 rodadas)
                                            │
                        APROVADO ───────────┴─▶ post-final.md ─▶ Eloah cria a arte ─▶ arte.png
                        3 reprovações ─▶ pendencias.md (decisão humana, sem arte)
```

### Melhorias em relação ao desenho original

1. **Limite de 3 rodadas** entre Tiago e Roberto. Sem isso, um texto difícil vira loop infinito (e custo). Na terceira reprovação, a demanda volta para você com `pendencias.md`.
2. **Regra de aprovação objetiva** para o Roberto: nenhum bloqueante, nenhum critério abaixo de 8 e média de pelo menos 8,5. "Criterioso" vira critério, não humor do dia.
3. **Guardrails determinísticos** além do julgamento do modelo: `scripts/checar-texto.mjs` pega travessão (`—`, `–`, hífen solto, linha começando com hífen), título acima de 90 caracteres, post acima de 3000 caracteres e quantidade de hashtags. `scripts/renderizar-arte.mjs` reprova arte sem logo carregado e visível, com texto transbordando ou com travessão.
4. **Separação de funções**: Roberto aponta trecho e correção, mas não reescreve; Tiago não se autoaprova; o artista não mexe no texto aprovado.
5. **Rastreabilidade**: cada demanda guarda briefing, todas as versões, todos os pareceres e o log em `entregas/<id>/`.
6. **Human in the loop**: nada é publicado sozinho. Você copia o post e baixa a arte no painel.
7. **Fila**: uma demanda por vez, para o escritório ficar legível na tela e o custo previsível.

## Dois jeitos de usar

| | GitHub Pages (recomendado) | Local, com pixel-agents |
|---|---|---|
| Onde pede | painel no Pages ou formulário de issue | painel em http://127.0.0.1:4000 |
| Quem roda os agentes | GitHub Actions | Claude Code na sua máquina |
| Escritório pixel art | mini escritório do painel | mini escritório do painel + pixel-agents ao vivo |
| Onde recebe | painel, comentário na issue e `entregas/` no repositório | painel e `entregas/` local |

### Modo GitHub Pages

Painel: `https://rodrigosilvacio.github.io/claude-agent/escritorio-agentes/painel/`

1. Preencha o pedido no painel e clique em **Abrir pedido no GitHub**. Abre o formulário de issue já preenchido; clique em **Create**.
2. O workflow `.github/workflows/escritorio-agentes.yml` comenta na issue, roda Tiago, Roberto e Eloah, commita a entrega em `entregas/<id>/`, atualiza `entregas/index.json` e responde na issue com o post e a arte (fechando a issue quando tudo deu certo).
3. Em 1 a 2 minutos o GitHub Pages publica e a entrega aparece no painel.
4. Para refazer uma demanda (erro ou pendências), adicione o label `refazer` na issue.

Configuração única: em **Settings → Secrets and variables → Actions**, crie a secret `ANTHROPIC_API_KEY` (chave da API) ou `CLAUDE_CODE_OAUTH_TOKEN` (assinatura Claude, gerada com `claude setup-token`). Crie também o label `refazer`.

Segurança: o repositório é público, então **só issues abertas pelo dono do repositório** disparam a esteira. Ninguém de fora gasta seus créditos nem injeta instruções nos agentes. Lembre que tudo em `entregas/` fica público.

### Modo local (na sua máquina)

Pré-requisitos: Node 20+ e [Claude Code](https://docs.claude.com/en/docs/claude-code) instalado e logado.

```bash
cd escritorio-agentes
claude            # só na primeira vez: aceite o "trust" da pasta e saia (Ctrl+D)
./iniciar.sh      # instala o Playwright na 1ª vez, sobe o pixel-agents (3100) e o painel (4000)
```

Abra:
- **Painel de demandas:** http://127.0.0.1:4000 (preencha o pedido e clique em "Enviar para o Tiago")
- **Escritório pixel-agents:** use a URL com `?token=` que o `pixel-agents` imprime no terminal (ou o botão "Ver office aqui" no painel)

Os subagentes aparecem como personagens no pixel-agents, com o balão "Tiago escreve a v1", "Roberto revisa a v1", "Eloah cria a arte". O painel também tem o próprio mini escritório pixel art com a esteira em tempo real.

Sem o painel, dá para disparar direto num terminal do pixel-agents ou do Claude Code, criando `entregas/<id>/briefing.md` e rodando `/post <id>`.

## Estrutura

```
escritorio-agentes/
├── .claude/agents/          tiago-escritor, roberto-revisor, eloah-artista
├── .claude/commands/post.md orquestrador da esteira
├── assets/                  logotipo (PNG transparente e JPG original)
├── painel/                  servidor Node sem dependências + interface pixel art (local e Pages)
├── scripts/                 checar-texto, finalizar-post, renderizar-arte (esteira)
│                            demanda-lib, rodar-esteira, briefing-da-issue,
│                            gerar-indice, comentario-issue (modo GitHub)
└── entregas/<id>/           briefing, post-vN, revisao-vN, post-final, arte.html, arte.png, log
```

## Segurança e custos

- Modo local: o painel escuta só em `127.0.0.1`. Quem acessa o painel dispara o Claude Code com a sua conta: não exponha a porta na rede.
- Os agentes só têm permissão para ler, escrever em `entregas/` e rodar os três scripts. Sem web, sem git push.
- Não coloque no briefing dado pessoal de terceiros ou informação confidencial: o texto vai para o modelo.
- Cada demanda consome de 4 a 8 chamadas de agente (1 a 3 rodadas + arte).
