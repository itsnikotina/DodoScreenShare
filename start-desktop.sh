#!/bin/bash

# ==============================================================================
# Script de Inicialização do Aplicativo Desktop Nativo (Host)
# Dodo Screen Share
# ==============================================================================

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}=====================================================${NC}"
echo -e "${CYAN}🖥️  Iniciando Dodo Screen Share Desktop Host...${NC}"
echo -e "${CYAN}=====================================================${NC}"

if [ ! -d "node_modules" ]; then
    npm install
fi

npx electron desktop/main.js
