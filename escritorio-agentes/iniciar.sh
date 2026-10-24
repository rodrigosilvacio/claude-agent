#!/usr/bin/env bash
# Sobe o escritório pixel-agents (porta 3100) e o painel de demandas (porta 4000).
set -e
cd "$(dirname "$0")"
command -v claude >/dev/null || { echo "Instale o Claude Code CLI primeiro: npm i -g @anthropic-ai/claude-code"; exit 1; }
[ -d node_modules/playwright ] || { npm install && npx playwright install chromium; }

npx -y pixel-agents --port 3100 &
OFFICE=$!
trap 'kill $OFFICE 2>/dev/null' EXIT
node painel/server.mjs --port 4000
