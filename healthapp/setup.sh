#!/usr/bin/env bash
# Prepara e abre o projeto Xcode do Pulso do Dia.
# Uso: ./setup.sh   (rode de novo sempre que adicionar arquivos ou mudar o project.yml)
set -euo pipefail
cd "$(dirname "$0")"

# 1. Xcode instalado e selecionado?
DEV_DIR="$(xcode-select -p 2>/dev/null || true)"
if [[ "$DEV_DIR" != *Xcode*.app* ]]; then
  echo "O Xcode não está selecionado como ferramenta padrão."
  echo "Rode:  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
  echo "Depois rode ./setup.sh de novo."
  exit 1
fi

# 2. XcodeGen: usa o instalado, senão Homebrew, senão baixa direto do GitHub.
XCODEGEN="$(command -v xcodegen || true)"
if [[ -z "$XCODEGEN" && -x .tools/xcodegen/bin/xcodegen ]]; then
  XCODEGEN="$PWD/.tools/xcodegen/bin/xcodegen"
fi
if [[ -z "$XCODEGEN" ]] && command -v brew >/dev/null 2>&1; then
  echo "Instalando XcodeGen via Homebrew..."
  brew install xcodegen
  XCODEGEN="$(command -v xcodegen)"
fi
if [[ -z "$XCODEGEN" ]]; then
  echo "Homebrew não encontrado. Baixando XcodeGen do GitHub..."
  mkdir -p .tools
  curl -fsSL -o .tools/xcodegen.zip https://github.com/yonaskolb/XcodeGen/releases/latest/download/xcodegen.zip
  unzip -qo .tools/xcodegen.zip -d .tools
  XCODEGEN="$PWD/.tools/xcodegen/bin/xcodegen"
fi

# 3. Gera e abre o projeto.
"$XCODEGEN" generate
echo
echo "Projeto gerado. Abrindo no Xcode..."
echo "Próximo passo: target PulsoDoDia > Signing & Capabilities > escolha seu Team."
open PulsoDoDia.xcodeproj
