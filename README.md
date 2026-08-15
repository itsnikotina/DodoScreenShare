# Dodo Screen Share 🎮🖥️

Compartilhamento de tela e áudio em tempo real de alta performance com suporte a **Discord Activities**, resolução configurável (`480p`, `720p`, `1080p`) e taxas de quadros de até **60 FPS**.

---

## 🚀 Funcionalidades

- **🎮 Integração Nativa com Discord Activity:**
  - Galeria de membros da chamada de voz com avatares e nicknames reais.
  - Modo Foco / Cinema ao clicar na transmissão.
  - Menu de contexto (botão direito) para parar de assistir, mutar ou colocar em tela cheia.
  - Auto-Mudo inteligente ao assistir à própria transmissão para evitar qualquer eco.
- **⚡ Painel de Transmissão do Host:**
  - Seletores de Resolução em tempo real: `1080p (FHD)`, `720p (HD)` e `480p (SD)`.
  - Seletores de FPS em tempo real: `60 FPS`, `30 FPS` e `15 FPS`.
  - Botão **Trocar Janela** para alternar de jogo/aba sem derrubar a live.
  - VU Meter de áudio compacto e monitor de FPS real (envio vs recebimento).
- **🔊 Áudio de Ultra-Baixa Latência:**
  - Sincronização estrita de áudio e vídeo com tolerância de até 40ms de buffer.
  - Captura automática de áudio do sistema sem necessidade de cliques manuais.

---

## 🛠️ Tecnologias Utilizadas

- **Backend:** Node.js (ES Modules), Express, WebSocket (`ws`).
- **Frontend:** Vanilla JavaScript, HTML5, CSS3 moderno, Iconify Icons.
- **Discord SDK:** `@discord/embedded-app-sdk` com Rich Presence.
- **WebRTC / Web Audio API:** Processamento de áudio PCM em 48 kHz e compactação anti-lag.

---

## ⚙️ Como Executar Localmente

### 1. Instalar Dependências
```bash
npm install
```

### 2. Configurar Variáveis de Ambiente (`.env`)
```env
PORT=3000
DISCORD_CLIENT_ID=787371101177118750
DISCORD_CLIENT_SECRET=seu_client_secret_aqui
```

### 3. Iniciar Servidor
```bash
npm start
```

---

## ☁️ Deploy na Render.com

1. Crie um **Web Service** na Render conectado ao repositório GitHub.
2. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
3. Adicione as variáveis de ambiente `PORT`, `DISCORD_CLIENT_ID` e `DISCORD_CLIENT_SECRET`.
4. Adicione a URL gerada no seu **Discord Developer Portal -> Activities -> URL Mappings**.
