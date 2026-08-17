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

# Se estiver em repositório Git, puxa as atualizações mais recentes automaticamente
if [ -d ".git" ]; then
  echo -e "${YELLOW}[1/3] Verificando e baixando atualizações do GitHub...${NC}"
  git pull --rebase --autostash || true
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
