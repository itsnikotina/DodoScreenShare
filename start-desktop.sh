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

echo -e "${GREEN}🔄 Atualizando repositório para a versão mais recente...${NC}"
git pull || true

if [ ! -d "node_modules" ]; then
    npm install
fi

# Finaliza instâncias e limpa módulos de áudio anteriores para evitar som duplicado
pkill -f "electron desktop/main.js" 2>/dev/null || true
pkill -f "parec" 2>/dev/null || true
for mod in $(pactl list short modules 2>/dev/null | grep -E "Dodo_Audio|module-loopback.*Dodo" | awk '{print $1}'); do
    pactl unload-module $mod 2>/dev/null || true
done

npx electron desktop/main.js
