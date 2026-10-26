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
| Migration | `supabase/migrations/0063_drive_agente.sql` |

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
