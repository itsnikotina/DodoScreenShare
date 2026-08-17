#!/bin/bash

# ==============================================================================
# Script de Inicialização do Servidor (Backend de Sinalização & Discord Activity)
# Dodo Screen Share
# ==============================================================================

set -e

# Cores no terminal
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}=====================================================${NC}"
echo -e "${CYAN}🚀 Dodo Screen Share - Servidor de Sinalização${NC}"
echo -e "${CYAN}=====================================================${NC}"

# 1. Verificar Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}[ERRO] Node.js não foi encontrado no sistema!${NC}"
    echo -e "Instale o Node.js via terminal:"
    echo -e "  sudo apt update && sudo apt install -y nodejs npm"
    exit 1
fi

# 3. Liberar porta 3000 caso haja algum processo anterior preso
echo -e "${YELLOW}[INFO] Verificando e liberando porta 3000...${NC}"
fuser -k 3000/tcp 2>/dev/null || true
pkill -f "node.*server.js" 2>/dev/null || true
sleep 0.5

echo ""
echo -e "${CYAN}Como deseja iniciar o Servidor?${NC}"
echo -e "  ${GREEN}1)${NC} Servidor Local (http://localhost:3000)"
echo -e "  ${GREEN}2)${NC} Servidor + Túnel Gratuito LocalTunnel (Gera link HTTPS para o Discord)"
echo -e "  ${GREEN}3)${NC} Servidor + Túnel Cloudflare (cloudflared)"
echo -e "  ${GREEN}4)${NC} Servidor + Túnel Ngrok"
echo ""
read -p "Selecione uma opção [1-4] (padrão: 1): " OPTION
OPTION=${OPTION:-1}

cleanup() {
    echo -e "\n${YELLOW}[INFO] Encerrando servidor e túneis...${NC}"
    kill 0 2>/dev/null || true
    fuser -k 3000/tcp 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

case $OPTION in
    1)
        echo -e "${GREEN}[INICIANDO] Servidor rodando em http://localhost:3000...${NC}"
        node server.js
        ;;
    2)
        echo -e "${GREEN}[INICIANDO] Servidor local e gerando link HTTPS via LocalTunnel...${NC}"
        node server.js &
        sleep 2
        echo -e "${CYAN}[TÚNEL] Gerando URL pública para o Discord...${NC}"
        npx --yes localtunnel --port 3000
        ;;
    3)
        if ! command -v cloudflared &> /dev/null; then
            echo -e "${RED}[AVISO] 'cloudflared' não encontrado. Iniciando somente o servidor...${NC}"
            node server.js
        else
            echo -e "${GREEN}[INICIANDO] Servidor e túnel Cloudflare...${NC}"
            node server.js &
            sleep 2
            cloudflared tunnel --url http://localhost:3000
        fi
        ;;
    4)
        if ! command -v ngrok &> /dev/null; then
            echo -e "${RED}[AVISO] 'ngrok' não encontrado. Iniciando somente o servidor...${NC}"
            node server.js
        else
            echo -e "${GREEN}[INICIANDO] Servidor e túnel Ngrok...${NC}"
            node server.js &
            sleep 2
            ngrok http 3000
        fi
        ;;
    *)
        echo -e "${GREEN}[INICIANDO] Servidor padrão local...${NC}"
        node server.js
        ;;
esac
