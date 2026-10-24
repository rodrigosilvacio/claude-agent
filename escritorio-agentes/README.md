# Escritório de Agentes (pixel art)

Três agentes de IA produzem posts de LinkedIn no estilo do Rodrigo Silva e trabalham "em tela" num escritório pixel art. Qualquer pessoa cria uma conta no painel, faz o pedido e acompanha ao vivo. No fim, recebe **o post revisado** e **a arte com o logotipo**.

**Painel:** https://rodrigosilvacio.github.io/claude-agent/escritorio-agentes/painel/

## A equipe

| Agente | Papel |
|---|---|
| **Tiago** (escritor) | escreve a copy com título chamativo e zero travessões; reescreve quando o Roberto reprova |
| **Roberto** (revisor) | checagem automática + leitura crítica (português, concordância, coerência, título, postura de CIO/CTO); aprova ou reprova |
| **Eloah** (artista) | cria o criativo 1080x1350 com o logotipo |

## Fluxo

```
Pedido ─▶ Tiago escreve v1 ─▶ Roberto revisa
               ▲                   │
               └── REPROVADO ◀─────┤  (máx. 3 rodadas)
                                   │
               APROVADO ───────────┴─▶ post final ─▶ Eloah cria a arte ─▶ entrega
               3 reprovações ─▶ pendências (decisão humana, sem arte)
```

### Regras do escritório

1. **No máximo 3 rodadas** entre Tiago e Roberto. Isso evita loop infinito e custo descontrolado. Na terceira reprovação, a demanda volta para a pessoa com as pendências.
2. **Aprovação objetiva:** nenhum bloqueante, nenhum critério abaixo de 8 e média de pelo menos 8,5. A regra é aplicada no código, não fica a critério do modelo.
3. **Guardrails determinísticos:**
   - no texto: travessão (`—`, `–`, hífen solto, linha começando com hífen), título acima de 90 caracteres, post acima de 3000 caracteres e quantidade de hashtags;
   - na arte: logo obrigatório e nenhum travessão.
4. **Separação de funções:** Roberto aponta trecho e correção, mas não reescreve; Tiago não se autoaprova; Eloah não mexe no texto aprovado.
5. **Rastreabilidade:** cada demanda guarda briefing, todas as versões e todos os pareceres.
6. **Human in the loop:** nada é publicado sozinho. A pessoa copia o post e baixa a arte.

## Modo nuvem (o painel publicado)

Quem usa não instala nada: cria a conta com e-mail e senha, preenche o pedido e acompanha.

```
Painel (GitHub Pages)
  ├─ login ─────────────▶ Supabase Auth
  ├─ pedido ────────────▶ edge function escritorio-pedir (limites diários)
  │                          └─▶ tabela escritorio_demandas
  │                                 └─ trigger + pg_net ─▶ edge function escritorio-esteira
  │                                                        (1 etapa por chamada: Tiago, Roberto ou Eloah)
  │                                                        └─ ao concluir, muda a etapa ─▶ o trigger dispara a próxima
  └─ ao vivo ◀── Realtime ◀── tabela escritorio_eventos
```

- **Agentes:** `supabase/functions/escritorio-esteira` chama o Claude (`claude-opus-5-5`, saída em JSON estruturado, com `fallbacks: "default"` para pedidos recusados). Usa a `ANTHROPIC_API_KEY` que já existe nas secrets do projeto Supabase. As regras determinísticas ficam em `regras.ts` e os prompts em `prompts.ts`.
- **Uma etapa por invocação:** cada agente roda numa chamada separada, para caber no teto de cerca de 150 s das edge functions (cada etapa leva de 10 a 30 s). O próprio banco conduz a esteira (migration `0062`).
- **Rede de segurança:** um cron a cada 2 minutos reenvia etapas paradas; depois de 3 tentativas, marca erro. A pessoa pode clicar em "Retomar esteira".
- **Arte:** o HTML da Eloah é sanitizado na função e exibido num iframe sandbox, sem scripts e com CSP. O PNG é gerado no navegador ao clicar em "Baixar PNG".
- **Privacidade:** cada pessoa vê só as próprias demandas (RLS). O escritório ao vivo é público, mas os eventos só dizem quem está fazendo o quê ("Roberto revisa a v1"), nunca o conteúdo.
- **Custos:** até 3 pedidos por pessoa a cada 24 h e 40 no total por dia. Os limites ficam em `public.escritorio_config` (`limite_usuario_dia`, `limite_global_dia`) e se ajustam com um `update`, sem novo deploy. Cada demanda faz de 3 a 7 chamadas ao modelo.

## Modo local (Claude Code + pixel-agents)

Para demonstrações, os mesmos agentes rodam como subagentes do Claude Code na sua máquina e aparecem no [pixel-agents](https://www.npmjs.com/package/pixel-agents).

Pré-requisitos: Node 20+ e [Claude Code](https://docs.claude.com/en/docs/claude-code) instalado e logado.

```bash
cd escritorio-agentes
claude            # só na primeira vez: aceite o "trust" da pasta e saia (Ctrl+D)
./iniciar.sh      # instala o Playwright na 1ª vez, sobe o pixel-agents (3100) e o painel (4000)
```

- **Painel local:** http://127.0.0.1:4000 (sem login; as entregas ficam em `entregas/<id>/`)
- **pixel-agents:** use a URL com `?token=` que o terminal imprime, ou o botão "Ver office aqui" no painel. Os subagentes aparecem como personagens com o balão "Tiago escreve a v1", "Roberto revisa a v1", "Eloah cria a arte".
- **Ao vivo no painel (opcional):** exporte `ESCRITORIO_TOKEN` com o mesmo valor da secret da edge function `escritorio-evento`. `scripts/rodar-esteira.mjs` lê o stream do Claude Code e publica cada passo. Sem o token, tudo funciona igual, só sem o feed ao vivo.
- Sem o painel: crie `entregas/<id>/briefing.md` e rode `/post <id>` no Claude Code.

## Estrutura

```
escritorio-agentes/
├── painel/                  interface pixel art (nuvem e local) + servidor local sem dependências
├── assets/                  logotipo (PNG transparente e JPG original)
├── .claude/agents/          tiago-escritor, roberto-revisor, eloah-artista (modo local)
├── .claude/commands/post.md orquestrador da esteira (modo local)
├── scripts/                 checar-texto, finalizar-post, renderizar-arte, rodar-esteira, demanda-lib (modo local)
└── entregas/exemplo-*/      entrega de exemplo exibida no painel

supabase/
├── functions/escritorio-pedir/    pedidos e retomada (usuário logado)
├── functions/escritorio-esteira/  os três agentes na nuvem (prompts, regras, etapas)
├── functions/escritorio-evento/   eventos ao vivo do modo local
└── migrations/0061, 0062          eventos, demandas, versões, condução da esteira
```

Os prompts da nuvem (`prompts.ts`) e os do modo local (`.claude/agents/*.md`) seguem as mesmas regras. Ao mudar uma regra de estilo, mude nos dois lugares.

## Segurança

- Só a service role (edge functions) escreve nas tabelas; usuários leem apenas o que é deles.
- A função dos agentes só aceita chamadas do próprio banco (segredo interno em `escritorio_config`, sem acesso público).
- O briefing é tratado como material de trabalho, não como instrução: os prompts delimitam o conteúdo do usuário.
- Não coloque no pedido dado pessoal de terceiros ou informação confidencial: o texto vai para o modelo.
