# Agente do Drive (`/drive-agente`)

O usuário digita uma pergunta e o agente responde com base nos arquivos de uma
pasta do Google Drive (PDF, PowerPoint, Word e Excel). Toda resposta mostra a
fonte no rodapé: **Google Drive** (com arquivo e página, slide ou aba),
**IA** (conhecimento geral, quando a resposta não está nos documentos) ou as
duas, quando é mista.

## Como funciona

```
Admin clica "Atualizar base"
  → drive-sincronizar: lista a pasta pública, enfileira os arquivos
  → drive-processar (um arquivo por invocação, em cadeia):
      baixa → extrai o texto por página/slide/aba → divide em trechos
      → embeddings (OpenAI text-embedding-3-small) → drive_trechos
  → o painel acompanha ao vivo (Realtime)

Usuário pergunta
  → drive-perguntar: Claude (claude-opus-5-5) usa a ferramenta
    buscar_documentos (busca híbrida: texto em português + vetor, RRF)
    quantas vezes precisar e entrega pela ferramenta responder
  → o código confere as citações e monta o rodapé
```

- **Busca híbrida** (`drive_buscar`): Postgres full text em português sem
  acento (`drive_pt`) + pgvector, combinados por Reciprocal Rank Fusion.
- **Fonte verificada no código:** se o modelo diz "drive" mas não cita um
  trecho que a busca devolveu de verdade, a resposta vira "ia"; citação real
  em resposta declarada "ia" vira "misto". Cada pergunta fica em
  `drive_perguntas` (com `fonte_corrigida` quando houve rebaixamento).
- **Sem OpenAI** (fora do ar ou sem crédito): os trechos entram sem vetor e a
  busca segue só por palavras. A próxima atualização da base completa os
  vetores que faltaram.
- **Arquivos sem mudança** (mesmo hash SHA-256) não são reprocessados.

## Projetos e conversas

Como os Projetos do Claude: na barra lateral, cada pessoa cria os seus
projetos e guarda as conversas dentro deles (ou fora, em "Conversas").

- **Instruções do projeto:** texto livre que o agente segue em todas as
  conversas daquele projeto (estilo, foco, formato), sem deixar de cumprir as
  regras de fonte.
- **Conversas salvas:** cada pergunta e resposta fica em `drive_perguntas`,
  ligada à conversa (`drive_conversas`) e ao projeto (`drive_projetos`). Ao
  reabrir, a conversa volta com o rodapé de fontes. O histórico usado pelo
  agente vem do banco (últimas 6 trocas da conversa), não da tela.
- **Privacidade:** projetos e conversas só aparecem para o dono (RLS).
  Excluir um projeto apaga as conversas dele; excluir as conversas tira as
  perguntas da base de conhecimento.

## Base de conhecimento

Toda pergunta respondida (fonte Drive, IA ou misto) entra na base, com o
vetor da pergunta. Antes de cada resposta, `drive-perguntar` **sempre**
consulta `drive_buscar_base` (texto + vetor) e entrega ao agente até 3
respostas anteriores parecidas (cosseno ≥ 0,6), de qualquer usuário e sem
identificar quem perguntou.

O agente usa essas respostas como ponto de partida e **confere nos
documentos**: se os documentos disserem outra coisa, eles prevalecem, e
resposta anterior não conta como documento. Respostas anteriores de fonte "ia"
chegam marcadas como conhecimento geral. Quando o agente aproveita uma
resposta da base, o rodapé mostra 📚 "Base de conhecimento" com a pergunta
anterior e a data; o código só aceita ids que foram de fato entregues.

## Acesso

O projeto Supabase tem cadastro aberto por causa de outros apps, então estar
logado não basta: só entra quem está em `drive_acessos`.

Para liberar alguém:

1. Supabase > Authentication > Users > **Add user** > *Create new user* (e-mail
   e senha, com *Auto Confirm User*). Passe a senha para a pessoa.
2. SQL Editor:
   ```sql
   insert into drive_acessos (email, admin) values ('pessoa@empresa.com', false);
   ```
   `admin = true` libera também o botão "Atualizar base".

"Esqueci minha senha" na tela de login envia um link de redefinição. Para ele
voltar para a página, a URL do painel precisa estar em Authentication > URL
Configuration > Redirect URLs.

## Configuração

| Onde | O quê |
|---|---|
| `drive_config.pasta_id` | ID da pasta do Drive (compartilhada como "Qualquer pessoa com o link") |
| Secrets das Edge Functions | `ANTHROPIC_API_KEY` (já existia) e `OPENAI_API_KEY` |
| Deploy | `drive-sincronizar` e `drive-perguntar` com JWT; `drive-processar` com `--no-verify-jwt` (autentica pelo segredo interno em `drive_config`) |
| Migrations | `0063_drive_agente.sql` (base de documentos) e `0064_drive_projetos_base_conhecimento.sql` (projetos, conversas e base de conhecimento) |

## Limites do MVP

- Pasta **pública**: a listagem lê a visualização embutida do Drive, que não é
  API oficial. Para produção, a pasta volta a ser privada e entra a Drive API
  com conta de serviço (só `drive-sincronizar/drive.ts` e o download mudam).
- Só texto: imagens e gráficos dentro de PDFs e apresentações ficam de fora.
  PDF escaneado aparece com erro ("precisa de OCR").
- Formatos antigos (.doc, .ppt, .xls) aparecem com erro pedindo para salvar
  no formato novo.
- Excel serve para **encontrar** informação, não para calcular totais.
- Sem limite de uso por pessoa.
