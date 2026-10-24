# Escritório de Agentes · Rodrigo Silva

Este diretório é um "escritório" com três agentes que produzem posts de LinkedIn para o Rodrigo Silva (CIO, IA · Dados · Produtos):

| Agente | Arquivo | Papel |
|---|---|---|
| Tiago (o escritor) | `.claude/agents/tiago-escritor.md` | escreve e reescreve a copy |
| Roberto (o revisor) | `.claude/agents/roberto-revisor.md` | revisa e aprova ou reprova |
| Eloah (artista) | `.claude/agents/eloah-artista.md` | cria o criativo com o logotipo |

A esteira é disparada por `/post <id>` (`.claude/commands/post.md`). Cada demanda vive em `entregas/<id>/` e guarda todo o histórico (briefing, versões, revisões, arte), o que dá rastreabilidade do que foi escrito, por quem e por que mudou.

Regras que valem para todos:
- Português brasileiro.
- **Nunca usar travessões** (`—`, `–`, ` - `) em nenhum texto ou arte.
- Não inventar dados, números, clientes ou citações.
- Nada é publicado automaticamente: o humano aprova a entrega final.
- Só escrever arquivos dentro de `entregas/<id>/` da demanda em andamento.
