# PoC Discord Activity - WebRTC Screen Sharing & Áudio

Prova de Conceito (PoC) completa e funcional para validar o compartilhamento de tela com captura de áudio do sistema (`navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`) dentro de uma **Discord Activity**, comparando o comportamento no **Discord Desktop (Electron)** vs **Discord Web (Navegador)**.

---

## 📋 Sumário
1. [Objetivo e Arquitetura](#-objetivo-e-arquitetura)
2. [Diagnóstico Técnico: Desktop vs Web vs Modo Híbrido](#-diagnóstico-técnico-desktop-vs-web-vs-modo-híbrido)
3. [Como Executar no Linux Mint / Ubuntu](#-como-executar-no-linux-mint--ubuntu)
4. [Configuração no Discord Developer Portal](#-configuração-no-discord-developer-portal)
5. [Roteiro de Testes](#-roteiro-de-testes)
6. [Estrutura do Projeto](#-estrutura-do-projeto)

---

## 🎯 Objetivo e Arquitetura

O objetivo desta PoC é determinar na prática se o iframe isolado de uma Discord Activity permite invocar a API nativa de captura de tela/áudio ou se a transmissão deve operar em **Modo Híbrido**:
- **Host (Transmissor):** Transmite a tela/áudio a partir de um navegador externo com suporte completo a APIs nativas do SO (Chrome, Brave, Edge).
- **Viewers (Espectadores):** Assistem à transmissão e escutam o áudio com baixa latência diretamente dentro da Activity no canal de voz do Discord.

### Tecnologias Utilizadas
- **Backend:** Node.js (ES Modules), `express` e `ws` (servidor de sinalização WebRTC com multiplexação por salas).
- **Frontend:** HTML5, CSS moderno e Vanilla JavaScript (sem frameworks pesados).
- **WebRTC:** `RTCPeerConnection` nativo com STUN server público do Google (`stun:stun.l.google.com:19302`).
- **Web Audio API:** Analisador em tempo real e medidor de VU (dB) para validar se o áudio capturado contém sinal real ou silêncio.

---

## 🔬 Diagnóstico Técnico: Desktop vs Web vs Modo Híbrido

| Cenário / Ambiente | `getDisplayMedia` (Vídeo) | Captura de Áudio do Sistema | Diagnóstico & Resultado Esperado |
| :--- | :--- | :--- | :--- |
| **Discord Web (Navegador)** | ✅ **Permitido** | ✅ **Permitido** (Chrome/Edge) | O navegador exibe a caixa de seleção nativa de telas, janelas ou abas. |
| **Discord Desktop (Electron)** | ❌ **Bloqueado (`NotAllowedError`)** | ❌ **Bloqueado** | Por padrão de segurança do runtime Electron do Discord, iframes de terceiros não têm o handler nativo de prompt de captura exposto. O console de logs do painel capturará o erro exato. |
| **Modo Híbrido** | ✅ **100% Funcional** | ✅ **100% Funcional** | O Host abre a URL da PoC no navegador externo (fora do Discord) e os Viewers assistem sincronizados na Activity dentro do canal de voz. |

---

## 🐧 Como Executar no Linux Mint / Ubuntu

### Opção 1: Usando o Script Automatizado (`start.sh`)

O projeto inclui o script `start.sh` que verifica Node.js, instala dependências e oferece opções de servidor local e túneis HTTPS:

```bash
./start.sh
```

Menu interativo exibido:
1. **Opção 1:** Iniciar apenas o Servidor Local (`http://localhost:3000`)
2. **Opção 2:** Iniciar Servidor + Túnel Cloudflare (`cloudflared`) *(Recomendado para Discord)*
3. **Opção 3:** Iniciar Servidor + Túnel LocalTunnel (`npx localtunnel`) *(Gratuito, sem cadastro)*
4. **Opção 4:** Iniciar Servidor + Túnel Ngrok (`ngrok`)

---

### Opção 2: Execução Manual via Terminal

1. **Instalar dependências:**
   ```bash
   npm install
   ```

2. **Iniciar o servidor:**
   ```bash
   npm start
   ```
   *(O servidor rodará em `http://localhost:3000`)*

3. **Gerar URL HTTPS pública (obrigatório para o Discord):**
   - **Com Cloudflared:**
     ```bash
     cloudflared tunnel --url http://localhost:3000
     ```
   - **Com LocalTunnel:**
     ```bash
     npx localtunnel --port 3000
     ```
   - **Com Ngrok:**
     ```bash
     ngrok http 3000
     ```

---

## 🛠️ Configuração no Discord Developer Portal

Para rodar esta aplicação dentro de um canal de voz como Discord Activity:

1. Acesse o [Discord Developer Portal](https://discord.com/developers/applications).
2. Clique em **"New Application"** e dê um nome (ex: `ScreenShare PoC`).
3. No menu lateral esquerdo, vá para **"Activities"** (ou **"Embedded App"**).
4. Em **"URL Mappings"**:
   - Clique em **"Add Mapping"**.
   - **Prefix:** `/`
   - **Target:** Cole a URL HTTPS pública gerada pelo túnel (ex: `https://meu-tunel.trycloudflare.com` ou `https://xxxx.loca.lt`).
5. Role até **"Supported Platforms"** e marque:
   - `DESKTOP (PC)`
   - `WEB (Browser)`
6. Salve as alterações.
7. Em **"OAuth2" -> "URL Generator"**:
   - Marque o escopo `applications.commands`.
   - Adicione o bot ao seu servidor de testes no Discord.

---

## 🧪 Roteiro de Testes

### Teste 1: Validação Local no Navegador (Host e Viewer)
1. Abra `http://localhost:3000` em duas abas ou navegadores diferentes.
2. Na **Aba 1**, clique em **"1. Testar Compartilhar Tela (Host)"**:
   - Marque a caixa para compartilhar áudio.
   - Escolha uma tela ou aba que esteja tocando algum som (ex: vídeo no YouTube).
   - Observe o medidor de VU de áudio oscilando no painel.
3. Na **Aba 2**, clique em **"2. Assistir Transmissão (Viewer)"**:
   - O stream WebRTC conectará automaticamente.
   - O vídeo e áudio serão reproduzidos em tempo real na aba receptora.

### Teste 2: Teste Direto na Discord Activity (Desktop)
1. Entre em um canal de voz no Discord Desktop.
2. Clique no ícone de **Foguete (Iniciar uma Atividade)** e selecione a sua aplicação.
3. Clique em **"1. Testar Compartilhar Tela (Host)"**:
   - Observe a mensagem capturada no **Console de Diagnóstico em Tempo Real**.
   - Se retornar `NotAllowedError` ou `SecurityError`, o log detalhará a restrição de segurança do Electron do Discord.

### Teste 3: Teste no Modo Híbrido (Host Externo + Viewers no Discord)
1. O apresentador abre a URL pública HTTPS no navegador Chrome/Edge do PC.
2. Clica em **"1. Testar Compartilhar Tela (Host)"**.
3. Os demais membros do servidor entram no canal de voz do Discord e iniciam a Activity.
4. Na Activity do Discord, clicam em **"2. Assistir Transmissão (Viewer)"**.
5. Todos assistem à transmissão com áudio sincronizado e baixa latência WebRTC dentro da chamada!

---

## 📂 Estrutura do Projeto

```
screensharingbot/
├── package.json          # Dependências (express, ws) e scripts
├── server.js             # Servidor Express + WebSocket de Sinalização
├── start.sh              # Script de inicialização facilitada para Linux Mint
├── README.md             # Documentação completa
└── public/
    ├── index.html        # Interface de diagnóstico, vídeo e logs
    ├── style.css         # Design system escuro, moderno e responsivo
    └── app.js            # Lógica WebRTC, getDisplayMedia, VU meter e logs
```
