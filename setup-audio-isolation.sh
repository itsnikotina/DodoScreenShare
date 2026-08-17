#!/bin/bash

# ==============================================================================
# Dodo Screen Share - Isolamento de Áudio estilo Parsec / Discord (Linux)
# Cria um canal virtual de áudio independente para jogos/vídeos
# para que o áudio do Discord NUNCA seja capturado na live!
# ==============================================================================

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}=====================================================${NC}"
echo -e "${CYAN}🎧 Configurando Isolamento de Áudio (Anti-Retorno Discord)${NC}"
echo -e "${CYAN}=====================================================${NC}"

# Remove módulo anterior se existir
pactl unload-module $(pactl list short modules | grep "sink_name=Dodo_Audio" | awk '{print $1}') 2>/dev/null || true
pactl unload-module $(pactl list short modules | grep "source=Dodo_Audio.monitor" | awk '{print $1}') 2>/dev/null || true

echo -e "${YELLOW}[1/2] Criando Dispositivo Virtual 'Dodo_Audio'...${NC}"
SINK_ID=$(pactl load-module module-null-sink sink_name=Dodo_Audio sink_properties=device.description="Dodo_Game_Audio")

echo -e "${YELLOW}[2/2] Conectando áudio aos seus fones (Loopback)...${NC}"
LOOP_ID=$(pactl load-module module-loopback source=Dodo_Audio.monitor sink=@DEFAULT_SINK@ latency_msec=1)

echo -e "${GREEN}✅ Canal de Áudio 'Dodo_Audio' configurado com sucesso!${NC}"
echo ""
echo -e "${CYAN}Como usar para isolar 100% o som do Discord:${NC}"
echo -e "1. Nas configurações do Discord -> ${GREEN}Voz e Vídeo${NC} -> ${GREEN}Dispositivo de Saída${NC}: Deixe seus ${YELLOW}Fones de Ouvido${NC} habituais."
echo -e "2. No seu jogo/navegador (ou no Controle de Volume do Linux - Pavucontrol): Selecione a saída ${GREEN}'Dodo_Game_Audio'${NC}."
echo -e "3. No App Desktop Dodo: Selecione ${GREEN}'Monitor of Dodo_Game_Audio'${NC}."
echo ""
echo -e "Dessa forma, você ouvirá o jogo e o Discord perfeitamente, mas a live capturará ${GREEN}APENAS o jogo${NC} e ${YELLOW}ZERO vozes do Discord${NC}!"
