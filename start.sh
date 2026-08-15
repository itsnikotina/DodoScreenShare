#!/bin/bash

# ==============================================================================
# Script de Inicialização Rápida - PoC Discord Activity WebRTC Screen Share
# Compatível com Linux Mint, Ubuntu e derivados Debian
# ==============================================================================

set -e

# Cores no terminal
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${CYAN}=====================================================${NC}"
echo -e "${CYAN}🚀 Discord Activity WebRTC Screen Share PoC${NC}"
echo -e "${CYAN}=====================================================${NC}"

# 1. Verificar Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}[ERRO] Node.js não foi encontrado no sistema!${NC}"
    echo -e "Instale o Node.js via terminal:"
    echo -e "  sudo apt update && sudo apt install -y nodejs npm"
    exit 1
fi

NODE_VERSION=$(node -v)
echo -e "${GREEN}[OK] Node.js detectado: ${NODE_VERSION}${NC}"

# 2. Instalar dependências se a pasta node_modules não existir
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}[INFO] Instalando dependências (npm install)...${NC}"
    npm install
    echo -e "${GREEN}[OK] Dependências instaladas com sucesso!${NC}"
fi

echo ""
echo -e "${CYAN}Escolha o modo de execução:${NC}"
echo -e "  ${GREEN}1)${NC} Iniciar apenas o Servidor Local (http://localhost:3000)"
echo -e "  ${GREEN}2)${NC} Iniciar Servidor + Túnel Cloudflare (cloudflared)"
echo -e "  ${GREEN}3)${NC} Iniciar Servidor + Túnel LocalTunnel (npx localtunnel)"
echo -e "  ${GREEN}4)${NC} Iniciar Servidor + Túnel Ngrok (ngrok http 3000)"
echo ""
read -p "Digite a opção desejada [1-4] (padrão: 1): " OPTION
OPTION=${OPTION:-1}

cleanup() {
    echo -e "\n${YELLOW}[INFO] Encerrando processos...${NC}"
    kill 0
    exit 0
}
trap cleanup SIGINT SIGTERM

case $OPTION in
    1)
        echo -e "${GREEN}[INICIANDO] Servidor local em http://localhost:3000...${NC}"
        # Tenta abrir o navegador padrão (xdg-open no Linux Mint)
        (sleep 1.5 && xdg-open http://localhost:3000 2>/dev/null || true) &
        npm start
        ;;
    2)
        if ! command -v cloudflared &> /dev/null; then
            echo -e "${RED}[ERRO] 'cloudflared' não está instalado no seu sistema.${NC}"
            echo -e "Para instalar no Linux Mint/Debian:"
            echo -e "  curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb"
            echo -e "  sudo dpkg -i cloudflared.deb"
            echo -e "\nIniciando somente o servidor local..."
            npm start
        else
            echo -e "${GREEN}[INICIANDO] Servidor e túnel Cloudflare...${NC}"
            npm start &
            sleep 2
            echo -e "${CYAN}[TÚNEL] Gerando URL pública HTTPS...${NC}"
            cloudflared tunnel --url http://localhost:3000
        fi
        ;;
    3)
        echo -e "${GREEN}[INICIANDO] Servidor e túnel LocalTunnel (gratuito via npx)...${NC}"
        npm start &
        sleep 2
        npx localtunnel --port 3000
        ;;
    4)
        if ! command -v ngrok &> /dev/null; then
            echo -e "${RED}[ERRO] 'ngrok' não está instalado.${NC}"
            echo -e "Iniciando apenas o servidor local..."
            npm start
        else
            echo -e "${GREEN}[INICIANDO] Servidor e túnel Ngrok...${NC}"
            npm start &
            sleep 2
            ngrok http 3000
        fi
        ;;
    *)
        echo -e "${RED}Opção inválida! Iniciando modo padrão local...${NC}"
        npm start
        ;;
esac
