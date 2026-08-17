#!/bin/bash

# ==============================================================================
# 🚀 DODO SCREEN SHARE - AUTO-LAUNCHER & AUTO-UPDATER
# Executa e atualiza automaticamente para a versão mais recente do GitHub!
# ==============================================================================

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

clear
echo -e "${CYAN}=====================================================${NC}"
echo -e "${CYAN}🚀 DODO SCREEN SHARE - INICIALIZADOR AUTOMÁTICO${NC}"
echo -e "${CYAN}=====================================================${NC}"

# Atualização automática: se tem Git usa Git; se não tem, baixa direto via curl/wget
if command -v git &> /dev/null && [ -d ".git" ]; then
  echo -e "${YELLOW}[1/3] Atualizando via Git...${NC}"
  git pull --rebase --autostash 2>/dev/null || true
else
  echo -e "${YELLOW}[1/3] Baixando atualizações do GitHub (sem necessidade de Git)...${NC}"
  mkdir -p desktop public
  curl -fsSL https://raw.githubusercontent.com/itsnikotina/DodoScreenShare/main/desktop/app.js -o desktop/app.js 2>/dev/null || true
  curl -fsSL https://raw.githubusercontent.com/itsnikotina/DodoScreenShare/main/desktop/main.js -o desktop/main.js 2>/dev/null || true
  curl -fsSL https://raw.githubusercontent.com/itsnikotina/DodoScreenShare/main/desktop/index.html -o desktop/index.html 2>/dev/null || true
fi

# Verifica Node.js
if ! command -v node &> /dev/null; then
  echo -e "${YELLOW}[AVISO] Node.js não encontrado. Instale o Node.js em: https://nodejs.org${NC}"
  exit 1
fi

# Instala dependências se necessário
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}[2/3] Instalando dependências necessárias...${NC}"
  npm install
fi

echo -e "${GREEN}[3/3] Iniciando Dodo Screen Share Desktop Host...${NC}"
echo -e "${CYAN}=====================================================${NC}"
echo ""

npx electron desktop/main.js
