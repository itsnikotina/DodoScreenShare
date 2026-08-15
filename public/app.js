/**
 * Dodo Screen Share - Multi-Stream WebRTC & WebSocket Client
 * - FPS em tempo real no Host e no Viewer
 * - Espectadores categorizados (Discord vs Web)
 * - Auto-descoberta dinâmica de transmissões
 * - Multi-Host e seletor de streams estilo Discord
 * - Volume e Mudo individuais por stream
 * - VU Áudio compacto e discreto
 * - Rich Presence integrado com @discord/embedded-app-sdk
 */

// ==========================================
// Constantes e Configurações
// ==========================================
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

const PeerConnectionClass = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection || null;

// ==========================================
// ==========================================
// Web Worker para Anti-Throttling em Background (Host)
// ==========================================
let timerWorker = null;
try {
  const workerCode = `
    let intervalId = null;
    self.onmessage = function(e) {
      const action = typeof e.data === 'string' ? e.data : (e.data?.action || 'start');
      const interval = (typeof e.data === 'object' && e.data?.interval) ? e.data.interval : 33;
      if (action === 'start') {
        if (intervalId) clearInterval(intervalId);
        intervalId = setInterval(() => { self.postMessage('tick'); }, interval);
      } else if (action === 'stop') {
        if (intervalId) clearInterval(intervalId);
        intervalId = null;
      }
    };
  `;
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  timerWorker = new Worker(URL.createObjectURL(blob));
} catch (err) {
  console.warn('[WebWorker] Erro ao instanciar Web Worker:', err);
}

// ==========================================
// Estado Global da Aplicação
// ==========================================
const state = {
  peerId: null,
  roomId: 'call-geral',
  ws: null,
  isHosting: false,
  localStream: null,
  audioStream: null,
  remoteStream: null,
  
  // Perfil Discord
  userProfile: null,

  // Qualidade da Transmissão (Resolução e FPS)
  targetResolution: '720p',
  targetFps: 30,
  antiLagIntervalMs: 33,
  activeCaptureFunction: null,

  // Multi-Stream & Espectador
  availableStreams: [],
  watchingHostId: null,
  watchingProfile: null,

  // Volume Independente por Streamer (hostId -> { volume, isMuted, savedVolumeBeforeMute })
  streamVolumes: {},
  currentVolume: 1.0,
  savedVolumeBeforeMute: 1.0,
  isMuted: false,

  // Web Audio Context Viewer
  viewerAudioCtx: null,
  viewerGainNode: null,
  audioNextPlayTime: 0,

  // WebRTC
  viewerPeerConnection: null,
  hostPeerConnections: new Map(),

  // Fallback Engine Host
  captureCanvas: null,
  captureCtx: null,
  hostAudioCtx: null,
  scriptProcessor: null,
  antiLagInterval: null,

  // FPS & Estatísticas
  fpsSentCount: 0,
  fpsRenderedCount: 0,
  fpsInterval: null,

  // VU Meter
  audioAnalyser: null,
  audioAnimFrameId: null,

  logHistory: []
};

// ==========================================
// Elementos do DOM
// ==========================================
const dom = {
  appContainer: document.getElementById('appContainer'),
  wsStatusDot: document.getElementById('wsStatusDot'),
  diagRoomName: document.getElementById('diagRoomName'),
  btnToggleFocus: document.getElementById('btnToggleFocus'),
  btnFullscreen: document.getElementById('btnFullscreen'),
  
  // Auth Discord
  btnDiscordLogin: document.getElementById('btnDiscordLogin'),
  userProfileBadge: document.getElementById('userProfileBadge'),
  userAvatarSmall: document.getElementById('userAvatarSmall'),
  userNameSmall: document.getElementById('userNameSmall'),
  btnLogout: document.getElementById('btnLogout'),

  // Layout & Grid
  mainGrid: document.getElementById('mainGrid'),
  playerSection: document.getElementById('playerSection'),
  logsSection: document.getElementById('logsSection'),

  // Controles do Host
  btnHost: document.getElementById('btnHost'),
  btnStop: document.getElementById('btnStop'),
  btnChangeWindow: document.getElementById('btnChangeWindow'),
  selectResolution: document.getElementById('selectResolution'),
  selectFps: document.getElementById('selectFps'),
  btnAudioTip: document.getElementById('btnAudioTip'),
  audioTipBanner: document.getElementById('audioTipBanner'),
  btnCloseAudioTip: document.getElementById('btnCloseAudioTip'),
  btnWantToStream: document.getElementById('btnWantToStream'),
  modalStreamGuide: document.getElementById('modalStreamGuide'),
  btnCloseStreamModal: document.getElementById('btnCloseStreamModal'),
  btnDismissStreamModal: document.getElementById('btnDismissStreamModal'),
  streamUrlInput: document.getElementById('streamUrlInput'),
  btnCopyStreamUrl: document.getElementById('btnCopyStreamUrl'),
  btnOpenStreamUrl: document.getElementById('btnOpenStreamUrl'),
  audioVuBar: document.getElementById('audioVuBar'),
  audioDbText: document.getElementById('audioDbText'),

  // Painel de Espectadores
  myViewersCount: document.getElementById('myViewersCount'),
  myViewersList: document.getElementById('myViewersList'),
  badgeDiscordCount: document.getElementById('badgeDiscordCount'),
  badgeWebCount: document.getElementById('badgeWebCount'),

  // Player de Vídeo e Canvas
  videoWrapper: document.getElementById('videoWrapper'),
  preview: document.getElementById('preview'),
  canvasPreview: document.getElementById('canvasPreview'),
  videoPlaceholder: document.getElementById('videoPlaceholder'),
  placeholderText: document.getElementById('placeholderText'),
  placeholderTip: document.getElementById('placeholderTip'),
  btnFloatingFullscreen: document.getElementById('btnFloatingFullscreen'),
  volumeControlGroup: document.getElementById('volumeControlGroup'),
  btnMute: document.getElementById('btnMute'),
  volumeSlider: document.getElementById('volumeSlider'),
  volumePercent: document.getElementById('volumePercent'),

  // Overlay Streamer Ativo
  hostProfileBanner: document.getElementById('hostProfileBanner'),
  hostAvatar: document.getElementById('hostAvatar'),
  hostName: document.getElementById('hostName'),

  // Streamers Shelf (Miniaturas)
  streamersShelf: document.getElementById('streamersShelf'),
  shelfCardsContainer: document.getElementById('shelfCardsContainer'),

  // Estatísticas
  statRole: document.getElementById('statRole'),
  statFps: document.getElementById('statFps'),
  statResolution: document.getElementById('statResolution'),
  statViewers: document.getElementById('statViewers'),

  // Logs
  logs: document.getElementById('logs'),
  logCount: document.getElementById('logCount'),
  btnCopyLogs: document.getElementById('btnCopyLogs'),
  btnClearLogs: document.getElementById('btnClearLogs')
};

// ==========================================
// Utilitários de Log e Diagnóstico
// ==========================================
function log(message, category = 'info') {
  const timestamp = new Date().toLocaleTimeString('pt-BR', { hour12: false });
  const entry = { timestamp, category, message };
  state.logHistory.push(entry);

  const entryEl = document.createElement('div');
  entryEl.className = `log-entry ${category}`;

  entryEl.innerHTML = `
    <span class="log-time">[${timestamp}]</span>
    <span class="log-badge ${category}">${category}</span>
    <span class="log-msg">${escapeHtml(message)}</span>
  `;

  dom.logs.appendChild(entryEl);
  dom.logs.scrollTop = dom.logs.scrollHeight;
  dom.logCount.textContent = `${state.logHistory.length} eventos`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ==========================================
// Discord Embedded App SDK & Rich Presence (Dodo)
// ==========================================
let discordSdk = null;
const sessionStartTime = Math.floor(Date.now() / 1000);

async function setupDiscordRichPresence() {
  const isIframe = window.self !== window.top;
  if (!isIframe) return;

  try {
    if (window.Discord && window.Discord.DiscordSDK) {
      discordSdk = new window.Discord.DiscordSDK('787371101177118750');
      await discordSdk.ready();
      log('Discord Embedded App SDK pronto!', 'success');
      updateDiscordPresence('Assistindo tela via Dodo', 'Dodo Screen Share');

      // Sincroniza todos os participantes da chamada do Discord
      syncVoiceChannelParticipants();
      try {
        discordSdk.subscribe('ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE', syncVoiceChannelParticipants);
      } catch (e) {}
    }
  } catch (err) {}
}

async function syncVoiceChannelParticipants() {
  if (!discordSdk || !discordSdk.commands) return;
  try {
    const data = await discordSdk.commands.getInstanceConnectedParticipants();
    if (data && data.participants && Array.isArray(data.participants)) {
      const channelUsers = data.participants.map(p => {
        let avatarUrl = 'https://cdn.discordapp.com/embed/avatars/0.png';
        if (p.avatar) {
          avatarUrl = `https://cdn.discordapp.com/avatars/${p.id}/${p.avatar}.png?size=128`;
        }
        return {
          id: p.id,
          platform: 'discord',
          profile: {
            id: p.id,
            username: p.global_name || p.nickname || p.username,
            avatarUrl: avatarUrl
          }
        };
      });

      if (!state.userProfile && channelUsers.length > 0) {
        state.userProfile = channelUsers[0].profile;
      }

      sendSignal({
        type: 'voice-participants-sync',
        participants: channelUsers
      });
    }
  } catch (err) {
    console.log('[DiscordSDK] Participantes da chamada info:', err);
  }
}

function updateDiscordPresence(details, stateText) {
  const isHosting = state.isHosting;
  const isWatching = !!state.watchingHostId;

  let finalDetails = details;
  let finalState = stateText || 'via Dodo';

  if (!finalDetails) {
    if (isHosting) {
      finalDetails = 'Transmitindo tela via Dodo';
      finalState = 'Dodo Screen Share';
    } else if (isWatching && state.watchingProfile) {
      finalDetails = `Assistindo ${state.watchingProfile.username}`;
      finalState = 'via Dodo Screen Share';
    } else {
      finalDetails = 'Assistindo tela via Dodo';
      finalState = 'via Dodo';
    }
  }

  document.title = isHosting ? '🔴 Transmitindo - Dodo' : (isWatching ? `📺 ${finalDetails} - Dodo` : 'Dodo Screen Share');

  if (discordSdk && discordSdk.commands && discordSdk.commands.setActivity) {
    try {
      discordSdk.commands.setActivity({
        activity: {
          details: finalDetails,
          state: finalState,
          timestamps: { start: sessionStartTime },
          assets: {
            large_image: state.userProfile?.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png',
            large_text: 'Dodo Screen Share'
          }
        }
      });
    } catch (e) {}
  }
}

// ==========================================
// Auto-Detecção do Canal de Voz e Ambiente
// ==========================================
function detectVoiceChannelRoom() {
  const urlParams = new URLSearchParams(window.location.search);
  const channelId = urlParams.get('channel_id') || urlParams.get('instance_id') || urlParams.get('room');
  
  if (channelId) {
    state.roomId = channelId;
    dom.diagRoomName.textContent = `Canal #${channelId.slice(0, 10)}`;
  } else {
    state.roomId = 'call-geral';
    dom.diagRoomName.textContent = 'Canal Principal';
  }

  const isIframe = window.self !== window.top;
  const isDiscordHost = window.location.hostname.includes('discordsays.com') || window.location.hostname.includes('discord.com');
  const isElectron = /Electron/i.test(navigator.userAgent) || /discord/i.test(navigator.userAgent);
  const isDiscordActivity = isIframe || isDiscordHost || (isElectron && isIframe);

  if (isDiscordActivity) {
    document.body.classList.add('discord-activity-mode');
  } else {
    document.body.classList.remove('discord-activity-mode');
  }
}

// ==========================================
// Discord OAuth2 Auth Manager
// ==========================================
function initDiscordAuth() {
  const urlParams = new URLSearchParams(window.location.search);

  if (urlParams.has('discord_user')) {
    try {
      const user = JSON.parse(decodeURIComponent(urlParams.get('discord_user')));
      localStorage.setItem('discord_user', JSON.stringify(user));
      state.userProfile = user;
      log(`Usuário autenticado: ${user.username}`, 'success');

      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    } catch (e) {}
  }

  if (urlParams.has('auth_error')) {
    log(`Erro no Login Discord: ${urlParams.get('auth_error')}`, 'error');
  }

  if (!state.userProfile) {
    const saved = localStorage.getItem('discord_user');
    if (saved) {
      try { state.userProfile = JSON.parse(saved); } catch (e) {}
    }
  }

  if (state.userProfile) {
    if (dom.btnDiscordLogin) dom.btnDiscordLogin.classList.add('hidden');
    if (dom.userProfileBadge) {
      dom.userProfileBadge.classList.remove('hidden');
      dom.userAvatarSmall.src = state.userProfile.avatarUrl;
      dom.userNameSmall.textContent = state.userProfile.username;
    }
  } else {
    if (dom.btnDiscordLogin) dom.btnDiscordLogin.classList.remove('hidden');
    if (dom.userProfileBadge) dom.userProfileBadge.classList.add('hidden');
  }
}

// ==========================================
// Gerenciador WebSocket e Sinalização
// ==========================================
const pendingSignals = [];

function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  log(`Conectando ao servidor: ${wsUrl}...`, 'info');
  dom.wsStatusDot.className = 'status-dot connecting';

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    log('WebSocket conectado com sucesso!', 'success');
    dom.wsStatusDot.className = 'status-dot connected';
    
    const isIframe = window.self !== window.top;
    const isDiscord = isIframe || window.location.hostname.includes('discordsays.com');

    // Entrar na sala identificando plataforma (discord vs web)
    sendSignal({
      type: 'join-room',
      roomId: state.roomId,
      platform: isDiscord ? 'discord' : 'web',
      profile: state.userProfile || null
    });

    while (pendingSignals.length > 0) {
      const s = pendingSignals.shift();
      try { state.ws.send(s); } catch (e) {}
    }
  };

  state.ws.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (err) {
      return;
    }

    handleSignalMessage(msg);
  };

  state.ws.onclose = () => {
    log('WebSocket desconectado. Reconectando em 3s...', 'warn');
    dom.wsStatusDot.className = 'status-dot disconnected';
    setTimeout(initWebSocket, 3000);
  };

  state.ws.onerror = (err) => {
    log(`Erro no WebSocket: ${err.message || 'Falha'}`, 'error');
  };
}

function sendSignal(payload) {
  const data = JSON.stringify({
    ...payload,
    roomId: state.roomId
  });

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(data);
  } else {
    pendingSignals.push(data);
  }
}

async function handleSignalMessage(msg) {
  switch (msg.type) {
    case 'connected':
      state.peerId = msg.peerId;
      break;

    // Confirmação de entrada na sala
    case 'room-joined':
      state.roomId = msg.roomId;
      dom.diagRoomName.textContent = msg.roomId.startsWith('call-') ? msg.roomId : `Canal #${msg.roomId.slice(0, 10)}`;
      log(`Conectado na sala "${msg.roomId}".`, 'success');
      updateAvailableStreams(msg.streams || [], msg.participants || []);
      break;

    // Atualização dinâmica de transmissões e membros da chamada
    case 'streams-updated':
      updateAvailableStreams(msg.streams || [], msg.participants || []);
      break;

    case 'stream-started':
      log('Sua transmissão está ativa no canal!', 'success');
      break;

    // Confirmação de que começamos a assistir um stream específico
    case 'watching-stream-confirmed':
      state.watchingHostId = msg.hostId;
      state.watchingProfile = msg.profile;
      updateActiveStreamHeader(msg.profile);
      restoreStreamVolume(msg.hostId);
      dom.statRole.textContent = `Assistindo (${msg.profile?.username || msg.hostId})`;
      updateDiscordPresence(`Assistindo ${msg.profile?.username || 'tela'}`, 'via Dodo');
      log(`Assistindo a transmissão de ${msg.profile?.username || msg.hostId}.`, 'info');
      break;

    // Transmissão encerrada
    case 'watched-stream-ended': {
      const endedName = state.watchingProfile?.username || 'O apresentador';
      log(`A transmissão de ${endedName} foi encerrada.`, 'warn');
      cleanupViewerMedia();
      state.watchingHostId = null;
      state.watchingProfile = null;
      updateActiveStreamHeader(null);
      dom.statRole.textContent = 'Na Chamada (Lobby)';
      updateDiscordPresence('Na chamada via Dodo', 'Dodo Screen Share');

      setFocusMode(false);
      state.userStoppedWatching = true;

      showStreamEndedScreen(endedName);
      break;
    }

    // Atualização dos espectadores que estão assistindo MINHA tela
    case 'stream-viewers-updated':
      updateHostViewersList(msg.viewers || [], msg.total || 0, msg.discordCount || 0, msg.webCount || 0);
      break;

    case 'new-viewer':
      if (state.isHosting && state.localStream) {
        log(`Novo espectador (${msg.viewerId}) [${msg.platform || 'web'}] conectado à sua tela.`, 'info');
        if (state.captureCanvas) {
          try {
            const frameData = state.captureCanvas.toDataURL('image/jpeg', 0.65);
            sendSignal({ type: 'stream-frame', frame: frameData });
          } catch (e) {}
        }
        if (PeerConnectionClass) {
          await createOfferForViewer(msg.viewerId);
        }
      }
      break;

    case 'offer':
      if (PeerConnectionClass && msg.from === state.watchingHostId) {
        await handleOfferAndCreateAnswer(msg.sdp, msg.from);
      }
      break;

    case 'answer':
      if (PeerConnectionClass && state.isHosting) {
        await handleAnswerFromViewer(msg.sdp, msg.from);
      }
      break;

    case 'ice-candidate':
      if (PeerConnectionClass) {
        handleRemoteIceCandidate(msg.candidate, msg.from);
      }
      break;

    // Quadro de vídeo recebido via WebSocket
    case 'stream-frame':
      if (msg.hostId === state.watchingHostId) {
        renderIncomingFrame(msg.frame);
      }
      break;

    // Áudio PCM recebido via WebSocket
    case 'stream-audio':
      if (msg.hostId === state.watchingHostId) {
        playIncomingAudioChunk(msg.audio);
      }
      break;
  }
}

// ==========================================
// Gerenciador de Transmissões e Membros da Chamada (Discord Layout)
// ==========================================
function setFocusMode(focused) {
  state.isFocusedMode = focused;
  if (state.isFocusedMode) {
    dom.videoWrapper.classList.add('is-focused');
  } else {
    dom.videoWrapper.classList.remove('is-focused');
  }
}

function isInsideDiscordActivity() {
  return window.self !== window.top || window.location.search.includes('frame_id') || window.location.search.includes('instance_id');
}

function updateAvailableStreams(streams, participants = []) {
  state.availableStreams = streams;
  if (participants && participants.length > 0) {
    state.callParticipants = participants;
  }

  // No navegador externo, o site opera exclusivamente como Painel de Envio (Host).
  // A galeria de membros e transmissões só é exibida dentro da Atividade do Discord!
  if (!isInsideDiscordActivity()) {
    if (dom.callGalleryShelf) dom.callGalleryShelf.style.display = 'none';
    if (!state.isHosting) {
      dom.videoPlaceholder.classList.remove('hidden');
      dom.placeholderText.textContent = 'Painel de Transmissão do Host';
      dom.placeholderTip.textContent = 'Clique em "Compartilhar Minha Tela" acima para transmitir. Os membros da call assistirão pela Atividade do Discord!';
    }
    return;
  }

  // Verifica se o stream que estávamos assistindo ainda existe
  const currentStreamExists = streams.some(s => s.hostId === state.watchingHostId);
  if (!currentStreamExists) {
    state.watchingHostId = null;
    state.watchingProfile = null;
  }

  const container = document.getElementById('galleryCardsRow') || dom.shelfCardsContainer;
  if (!container) return;
  container.innerHTML = '';

  const totalCards = streams.length + (state.callParticipants ? state.callParticipants.filter(p => !streams.some(s => s.hostId === p.id)).length : 0);

  if (totalCards === 0 && !state.isHosting) {
    if (dom.callGalleryShelf) dom.callGalleryShelf.classList.add('hidden');
    dom.videoPlaceholder.classList.remove('hidden');
    dom.placeholderText.textContent = 'Aguardando membros ou transmissões nesta chamada...';
    dom.placeholderTip.textContent = 'As transmissões iniciadas aparecerão automaticamente aqui!';
    updateActiveStreamHeader(null);
    return;
  }

  if (dom.callGalleryShelf) dom.callGalleryShelf.classList.remove('hidden');

  // 1. Renderiza Cards de Transmissão (Streams Ao Vivo)
  streams.forEach((s) => {
    const isSelected = s.hostId === state.watchingHostId;
    const card = document.createElement('div');
    card.className = `call-card stream-card ${isSelected ? 'active-stream' : ''}`;
    
    // Ao clicar na live, seleciona e entra no modo foco imediatamente!
    card.onclick = (e) => {
      e.stopPropagation();
      selectStream(s.hostId, true);
      setFocusMode(true);
    };

    const avatarUrl = s.profile?.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';
    const username = s.profile?.username || 'Host ' + s.hostId;

    card.innerHTML = `
      <span class="card-badge-live">AO VIVO</span>
      <div class="stream-icon-center">
        <iconify-icon icon="lucide:screen-share" width="36" style="color: #5865f2;"></iconify-icon>
      </div>
      <div class="card-user-tag">${escapeHtml(username)}</div>
    `;

    container.appendChild(card);
  });

  // 2. Renderiza Cards de Membros da Chamada (Que não estão transmitindo)
  if (state.callParticipants) {
    const renderedNames = new Set(streams.map(s => (s.profile?.username || '').toLowerCase()));

    state.callParticipants.forEach((p) => {
      const username = p.profile?.username || (p.platform === 'discord' ? 'Membro da Call' : 'Usuário Web');
      const lowerName = username.toLowerCase();

      // Ignora o placeholder genérico "Membro da Call" quando há outros usuários ou transmissões
      if (username === 'Membro da Call') return;

      // Ignora se já estiver transmitindo ou já foi renderizado
      const isAlreadyStreaming = streams.some(s => s.hostId === p.id) || renderedNames.has(lowerName);
      if (isAlreadyStreaming) return;

      renderedNames.add(lowerName);

      const card = document.createElement('div');
      card.className = 'call-card member-card';
      card.onclick = (e) => {
        e.stopPropagation();
        setFocusMode(!state.isFocusedMode);
      };

      const avatarUrl = p.profile?.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';

      card.innerHTML = `
        <img src="${avatarUrl}" class="member-avatar-center" alt="${escapeHtml(username)}">
        <div class="card-user-tag">${escapeHtml(username)}</div>
      `;

      container.appendChild(card);
    });
  }

  // Auto-seleciona na entrada da Activity se o usuário ainda não escolheu parar
  if (!state.watchingHostId && !state.isHosting && streams.length > 0 && !state.userStoppedWatching) {
    selectStream(streams[0].hostId, true);
  }
}

function selectStream(hostId, force = false) {
  state.userStoppedWatching = false;
  ensureViewerAudioContext();

  log(`Conectando à transmissão: ${hostId}...`, 'info');
  state.watchingHostId = hostId;

  // Envia sempre a solicitação de inscrição
  sendSignal({
    type: 'watch-stream',
    hostId: hostId
  });

  // Atualiza borda de seleção nos cards
  const container = document.getElementById('galleryCardsRow') || dom.shelfCardsContainer;
  if (container) {
    const cards = container.querySelectorAll('.call-card.stream-card');
    state.availableStreams.forEach((s, idx) => {
      if (cards[idx]) {
        if (s.hostId === hostId) {
          cards[idx].classList.add('active-stream');
        } else {
          cards[idx].classList.remove('active-stream');
        }
      }
    });
  }
}

function updateActiveStreamHeader(profile) {
  if (!dom.hostProfileBanner) return;

  if (profile) {
    dom.hostName.textContent = profile.username || 'Host';
    dom.hostAvatar.src = profile.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';
    dom.hostProfileBanner.classList.remove('hidden');
  } else {
    dom.hostProfileBanner.classList.add('hidden');
  }
}

// Atualiza a lista de quem está assistindo (separado por Discord e Web)
function updateHostViewersList(viewers, total, discordCount, webCount) {
  dom.myViewersCount.textContent = total;
  dom.badgeDiscordCount.innerHTML = `<iconify-icon icon="ic:baseline-discord" width="12"></iconify-icon> Discord: ${discordCount}`;
  dom.badgeWebCount.innerHTML = `<iconify-icon icon="lucide:globe" width="12"></iconify-icon> Web: ${webCount}`;
  dom.statViewers.textContent = `${total} (🎮 ${discordCount} | 🌐 ${webCount})`;

  dom.myViewersList.innerHTML = '';

  if (viewers.length === 0) {
    dom.myViewersList.innerHTML = `<p class="empty-viewers-msg">Nenhum espectador assistindo no momento.</p>`;
    return;
  }

  viewers.forEach((v) => {
    const isDiscord = v.platform === 'discord';
    const chip = document.createElement('div');
    chip.className = 'viewer-chip';
    chip.innerHTML = `
      <img src="${v.profile?.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png'}" class="viewer-chip-avatar" alt="Avatar">
      <span class="viewer-chip-name">${escapeHtml(v.profile?.username || 'Espectador')}</span>
      <span class="viewer-chip-platform">
        <iconify-icon icon="${isDiscord ? 'ic:baseline-discord' : 'lucide:globe'}" width="12"></iconify-icon>
      </span>
    `;
    dom.myViewersList.appendChild(chip);
  });
}

// ==========================================
// Volume e Mudo Independentes por Stream
// ==========================================
function isStreamOwnedByMe(hostId) {
  if (!hostId) return false;
  if (hostId === state.peerId) return true;

  const s = state.availableStreams.find(item => item.hostId === hostId);
  const myProfile = state.userProfile || (state.callParticipants && state.callParticipants.length > 0 ? state.callParticipants[0].profile : null);

  if (s && s.profile) {
    if (myProfile) {
      if (s.profile.id && myProfile.id && String(s.profile.id) === String(myProfile.id)) return true;
      if (s.profile.username && myProfile.username && s.profile.username.trim().toLowerCase() === myProfile.username.trim().toLowerCase()) return true;
    }

    // Se estiver na Activity e houver correspondência com participante da chamada
    if (state.callParticipants && state.callParticipants.length > 0) {
      const match = state.callParticipants.some(p => p.profile && p.profile.username && p.profile.username.trim().toLowerCase() === s.profile.username.trim().toLowerCase());
      if (match) return true;
    }
  }

  return false;
}

function restoreStreamVolume(hostId) {
  const isMine = isStreamOwnedByMe(hostId);

  // Se for a própria transmissão do usuário, carrega sempre mutado (0%)
  if (isMine) {
    state.streamVolumes[hostId] = {
      volume: 0,
      savedVolumeBeforeMute: 1.0,
      isMuted: true
    };
  } else if (!state.streamVolumes[hostId]) {
    state.streamVolumes[hostId] = {
      volume: 1.0,
      savedVolumeBeforeMute: 1.0,
      isMuted: false
    };
  }

  const volData = state.streamVolumes[hostId];
  state.currentVolume = volData.volume;
  state.savedVolumeBeforeMute = volData.savedVolumeBeforeMute;
  state.isMuted = volData.isMuted;

  const percent = state.isMuted ? 0 : Math.round(state.currentVolume * 100);
  if (dom.volumeSlider) dom.volumeSlider.value = percent;
  if (dom.volumePercent) dom.volumePercent.textContent = `${percent}%`;
  if (dom.btnMute) {
    dom.btnMute.innerHTML = state.isMuted 
      ? '<iconify-icon icon="lucide:volume-x" width="18"></iconify-icon>' 
      : '<iconify-icon icon="lucide:volume-2" width="18"></iconify-icon>';
  }

  applyVolumeGain();
  if (isMine) {
    log('🔇 Sua própria transmissão foi mutada automaticamente (0%) para evitar eco.', 'info');
  }
}

function updateVolume(val) {
  const normalized = Math.max(0, Math.min(100, Math.round(val)));
  state.currentVolume = normalized / 100;
  dom.volumeSlider.value = normalized;
  dom.volumePercent.textContent = `${normalized}%`;

  if (normalized === 0) {
    state.isMuted = true;
    dom.btnMute.innerHTML = '<iconify-icon icon="lucide:volume-x" width="18"></iconify-icon>';
  } else {
    state.isMuted = false;
    state.savedVolumeBeforeMute = state.currentVolume;
    dom.btnMute.innerHTML = '<iconify-icon icon="lucide:volume-2" width="18"></iconify-icon>';
  }

  if (state.watchingHostId) {
    state.streamVolumes[state.watchingHostId] = {
      volume: state.currentVolume,
      savedVolumeBeforeMute: state.savedVolumeBeforeMute,
      isMuted: state.isMuted
    };
  }

  applyVolumeGain();
}

function toggleMute() {
  state.isMuted = !state.isMuted;

  if (state.isMuted) {
    if (state.currentVolume > 0) {
      state.savedVolumeBeforeMute = state.currentVolume;
    }
    dom.btnMute.innerHTML = '<iconify-icon icon="lucide:volume-x" width="18"></iconify-icon>';
    dom.volumeSlider.value = 0;
    dom.volumePercent.textContent = '0%';
  } else {
    dom.btnMute.innerHTML = '<iconify-icon icon="lucide:volume-2" width="18"></iconify-icon>';
    state.currentVolume = state.savedVolumeBeforeMute > 0 ? state.savedVolumeBeforeMute : 1.0;
    const percent = Math.round(state.currentVolume * 100);
    dom.volumeSlider.value = percent;
    dom.volumePercent.textContent = `${percent}%`;
  }

  if (state.watchingHostId) {
    state.streamVolumes[state.watchingHostId] = {
      volume: state.currentVolume,
      savedVolumeBeforeMute: state.savedVolumeBeforeMute,
      isMuted: state.isMuted
    };
  }

  applyVolumeGain();
}

function applyVolumeGain() {
  const effectiveGain = state.isMuted ? 0 : state.currentVolume;

  if (state.viewerGainNode && state.viewerAudioCtx) {
    try {
      state.viewerGainNode.gain.setValueAtTime(effectiveGain, state.viewerAudioCtx.currentTime);
    } catch (err) {}
  }

  if (dom.preview) {
    dom.preview.volume = effectiveGain;
    dom.preview.muted = state.isMuted;
  }
}

// ==========================================
// FPS Counter Monitor (Host e Viewer)
// ==========================================
function startFpsMonitor() {
  if (state.fpsInterval) clearInterval(state.fpsInterval);
  state.fpsInterval = setInterval(() => {
    if (state.isHosting) {
      dom.statFps.textContent = `${state.fpsSentCount} fps (Envio)`;
      state.fpsSentCount = 0;
    } else if (state.watchingHostId) {
      dom.statFps.textContent = `${state.fpsRenderedCount} fps (Recebido)`;
      state.fpsRenderedCount = 0;
    } else {
      dom.statFps.textContent = '0 fps';
      state.fpsSentCount = 0;
      state.fpsRenderedCount = 0;
    }
  }, 1000);
}

// ==========================================
// Lógica do HOST (Compartilhamento de Tela & Áudio)
// ==========================================
async function startScreenSharing() {
  log('================ INICIANDO TRANSMISSÃO DO HOST ===============', 'info');
  log('Solicitando captura de tela (getDisplayMedia)...', 'perm');

  const fps = Number(dom.selectFps?.value || 30);
  const res = dom.selectResolution?.value || '720p';
  state.targetFps = fps;
  state.targetResolution = res;

  let maxW = 1280;
  let maxH = 720;
  if (res === '1080p') { maxW = 1920; maxH = 1080; }
  else if (res === '480p') { maxW = 854; maxH = 480; }

  log(`⚙️ Configuração de Saída: ${res} @ ${fps} FPS`, 'info');

  const displayMediaOptions = {
    video: {
      cursor: 'always',
      displaySurface: 'monitor',
      frameRate: { ideal: fps, max: fps },
      width: { ideal: maxW, max: maxW },
      height: { ideal: maxH, max: maxH }
    },
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2
    },
    systemAudio: 'include',
    surfaceSwitching: 'include',
    selfBrowserSurface: 'include'
  };

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
    state.localStream = stream;
    state.isHosting = true;

    log('✅ Captura de tela autorizada!', 'success');

    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();

    if (videoTracks.length > 0) {
      const vTrack = videoTracks[0];
      const settings = vTrack.getSettings();
      log(`🎥 Vídeo Nativo: "${vTrack.label}" (${settings.width || '?'}x${settings.height || '?'} @ ${settings.frameRate || '?'}fps)`, 'info');
      dom.statResolution.textContent = `${settings.width || '?'}x${settings.height || '?'}`;
    }

    if (audioTracks.length > 0) {
      log(`🔊 Áudio da Tela Capturado: "${audioTracks[0].label}"`, 'success');
      initAudioVisualizer(stream);
      startAudioStreamer(stream);
    } else {
      // Captura automática de áudio no Linux / Desktop para nunca precisar clicar em forçar áudio!
      log('Captura iniciada. Conectando fonte de áudio do sistema automaticamente...', 'info');
      attachSystemAudio();
    }

    dom.preview.classList.remove('hidden');
    dom.canvasPreview.classList.add('hidden');
    dom.preview.srcObject = stream;
    dom.preview.muted = true;
    dom.videoPlaceholder.classList.add('hidden');
    
    dom.btnStop.classList.remove('hidden');
    dom.btnStop.disabled = false;
    dom.btnChangeWindow.classList.remove('hidden');
    dom.btnChangeWindow.disabled = false;
    dom.btnHost.classList.add('hidden');

    dom.statRole.textContent = 'HOST (Transmitindo)';

    if (state.userProfile) {
      updateActiveStreamHeader(state.userProfile);
    }

    stream.getVideoTracks()[0].addEventListener('ended', () => {
      log('O compartilhamento foi encerrado.', 'warn');
      stopSharing();
    });

    sendSignal({
      type: 'start-stream',
      profile: state.userProfile || null
    });

    startAntiLagStreamer(stream);
    updateDiscordPresence('Transmitindo tela via Dodo', 'Dodo Screen Share');

  } catch (err) {
    handleCaptureError(err);
  }
}

async function changeScreenSharingSource() {
  if (!state.isHosting) return;

  log('Solicitando nova janela ou tela para transmissão...', 'perm');

  const fps = Number(dom.selectFps?.value || 30);
  const res = dom.selectResolution?.value || '720p';

  let maxW = 1280;
  let maxH = 720;
  if (res === '1080p') { maxW = 1920; maxH = 1080; }
  else if (res === '480p') { maxW = 854; maxH = 480; }

  const displayMediaOptions = {
    video: {
      cursor: 'always',
      displaySurface: 'monitor',
      frameRate: { ideal: fps, max: fps },
      width: { ideal: maxW, max: maxW },
      height: { ideal: maxH, max: maxH }
    },
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2
    },
    systemAudio: 'include',
    surfaceSwitching: 'include',
    selfBrowserSurface: 'include'
  };

  try {
    const newStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
    const oldStream = state.localStream;

    // Para as faixas de vídeo antigas
    if (oldStream) {
      oldStream.getVideoTracks().forEach(t => t.stop());
    }

    state.localStream = newStream;
    dom.preview.srcObject = newStream;

    const newVideoTrack = newStream.getVideoTracks()[0];
    const settings = newVideoTrack.getSettings();
    log(`🎥 Nova Janela/Tela Selecionada: "${newVideoTrack.label}" (${settings.width || '?'}x${settings.height || '?'} @ ${settings.frameRate || '?'}fps)`, 'success');

    newVideoTrack.addEventListener('ended', () => {
      log('O compartilhamento foi encerrado pelo usuário.', 'warn');
      stopSharing();
    });

    // Se a nova janela tiver áudio nativo, atualiza
    const newAudioTracks = newStream.getAudioTracks();
    if (newAudioTracks.length > 0) {
      log(`🔊 Novo Áudio da Janela: "${newAudioTracks[0].label}"`, 'success');
      initAudioVisualizer(newStream);
      startAudioStreamer(newStream);
    }

    // Reinicia o streamer de Anti-Lag na nova janela
    startAntiLagStreamer(newStream);

    // Substitui trilhas no WebRTC caso existam conexões P2P ativas
    state.hostPeerConnections.forEach((pc) => {
      const senders = pc.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      if (videoSender) {
        videoSender.replaceTrack(newVideoTrack).catch(() => {});
      }
    });

  } catch (err) {
    if (err.name !== 'NotAllowedError') {
      log(`Erro ao trocar janela: ${err.message}`, 'error');
    }
  }
}

async function attachSystemAudio() {
  log(`Conectando entrada de som do sistema (Anti-Retorno: ${state.echoCancellation ? 'ATIVADO' : 'DESATIVADO'})...`, 'perm');
  try {
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: state.echoCancellation,
        noiseSuppression: state.echoCancellation,
        autoGainControl: false,
        channelCount: 2
      }
    });

    state.audioStream = micStream;
    const aTrack = micStream.getAudioTracks()[0];
    log(`🔊 Fonte de Áudio Conectada: "${aTrack.label}"`, 'success');

    initAudioVisualizer(micStream);
    startAudioStreamer(micStream);

    state.hostPeerConnections.forEach((pc) => {
      pc.addTrack(aTrack, micStream);
    });

  } catch (err) {
    log(`Erro ao obter áudio: ${err.message}`, 'error');
  }
}

function handleCaptureError(err) {
  log(`Erro ao capturar tela: ${err.name} - ${err.message}`, 'error');
  if (err.name === 'NotAllowedError') {
    log('💡 DICA: Abra o site no Chrome/Brave externo para transmitir como Host!', 'warn');
  }
}

// ==========================================
// Motor Anti-Lag do Host (Resolução & FPS Dinâmicos)
// ==========================================
function restartAntiLagTimer() {
  const intervalMs = Math.round(1000 / state.targetFps);
  state.antiLagIntervalMs = intervalMs;

  if (state.antiLagInterval) {
    clearInterval(state.antiLagInterval);
    state.antiLagInterval = null;
  }

  if (state.activeCaptureFunction && state.isHosting) {
    if (timerWorker) {
      timerWorker.onmessage = (e) => {
        if ((e.data === 'tick' || e.data?.action === 'tick') && state.localStream && state.isHosting) {
          state.activeCaptureFunction();
        }
      };
      timerWorker.postMessage({ action: 'start', interval: intervalMs });
    } else {
      // Fallback apenas se Web Worker não estiver disponível no navegador
      state.antiLagInterval = setInterval(state.activeCaptureFunction, intervalMs);
    }
  }
}

function startAntiLagStreamer(stream) {
  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.play().catch(() => {});

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  state.captureCanvas = canvas;
  state.captureCtx = ctx;

  let isBusy = false;
  let lastFrameTime = 0;

  function captureAndSendFrame() {
    if (!video.videoWidth || !state.localStream || !state.isHosting || isBusy) return;

    const now = performance.now();
    const minInterval = (1000 / state.targetFps) * 0.85;
    if (now - lastFrameTime < minInterval) return;
    lastFrameTime = now;

    try {
      isBusy = true;
      let targetMaxW = 1280;
      if (state.targetResolution === '1080p') targetMaxW = 1920;
      else if (state.targetResolution === '480p') targetMaxW = 854;

      const scale = Math.min(1, targetMaxW / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);

      if (state.isHosting && dom.statResolution && dom.statResolution.textContent !== `${canvas.width}x${canvas.height}`) {
        dom.statResolution.textContent = `${canvas.width}x${canvas.height}`;
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const quality = state.targetResolution === '1080p' ? 0.70 : (state.targetResolution === '480p' ? 0.60 : 0.65);
      const frameData = canvas.toDataURL('image/jpeg', quality);

      sendSignal({
        type: 'stream-frame',
        frame: frameData
      });

      state.fpsSentCount++;
    } catch (e) {
    } finally {
      isBusy = false;
    }
  }

  video.onloadedmetadata = () => {
    captureAndSendFrame();
  };

  state.activeCaptureFunction = captureAndSendFrame;
  restartAntiLagTimer();
}

// ==========================================
// Compactação e Áudio de Ultra-Baixa Latência do Host
// ==========================================
function float32ToInt16Base64(float32Array) {
  const len = float32Array.length;
  const int16Array = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  const uint8 = new Uint8Array(int16Array.buffer);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < uint8.length; i += chunk) {
    binary += String.fromCharCode.apply(null, uint8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToInt16Float32(base64Str) {
  const binary = atob(base64Str);
  const len = binary.length;
  const uint8 = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    uint8[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(uint8.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7FFF);
  }
  return float32;
}

function startAudioStreamer(stream) {
  try {
    if (stream.getAudioTracks().length === 0) return;

    if (state.hostAudioCtx) state.hostAudioCtx.close();

    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    state.hostAudioCtx = new AudioCtxClass({ latencyHint: 'interactive', sampleRate: 48000 });
    const source = state.hostAudioCtx.createMediaStreamSource(stream);

    // Buffer reduzido para 1024 (apenas ~21ms de empacotamento) para sincronização perfeita com vídeo
    const processor = state.hostAudioCtx.createScriptProcessor(1024, 1, 1);
    source.connect(processor);
    processor.connect(state.hostAudioCtx.destination);

    processor.onaudioprocess = (e) => {
      if (!state.localStream && !state.audioStream) return;
      const inputData = e.inputBuffer.getChannelData(0);
      const base64Data = float32ToInt16Base64(inputData);

      sendSignal({
        type: 'stream-audio',
        audio: {
          sampleRate: state.hostAudioCtx.sampleRate,
          b64: base64Data
        }
      });
    };

    state.scriptProcessor = processor;
  } catch (err) {}
}

// ==========================================
// Renderização do Viewer (Áudio & Vídeo Sincronizados)
// ==========================================
function ensureViewerAudioContext() {
  try {
    if (!state.viewerAudioCtx) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      state.viewerAudioCtx = new AudioCtxClass({ latencyHint: 'interactive', sampleRate: 48000 });
      state.viewerGainNode = state.viewerAudioCtx.createGain();
      state.viewerGainNode.connect(state.viewerAudioCtx.destination);
      applyVolumeGain();
      state.audioNextPlayTime = state.viewerAudioCtx.currentTime;
    }
    if (state.viewerAudioCtx.state === 'suspended') {
      state.viewerAudioCtx.resume().then(() => {
        state.audioNextPlayTime = state.viewerAudioCtx.currentTime;
      }).catch(() => {});
    }
  } catch (err) {}
}

function renderIncomingFrame(frameData) {
  if (!frameData) return;

  dom.preview.classList.add('hidden');
  dom.canvasPreview.classList.remove('hidden');
  dom.videoPlaceholder.classList.add('hidden');

  const img = new Image();
  img.onload = () => {
    const canvas = dom.canvasPreview;
    if (canvas.width !== img.width || canvas.height !== img.height) {
      canvas.width = img.width;
      canvas.height = img.height;
      dom.statResolution.textContent = `${img.width}x${img.height}`;
    }
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    state.fpsRenderedCount++;
  };
  img.src = frameData;
}

function playIncomingAudioChunk(audioPayload) {
  if (!audioPayload || (!audioPayload.b64 && !audioPayload.data)) return;
  if (state.isMuted || state.currentVolume <= 0 || isStreamOwnedByMe(state.watchingHostId)) return;

  try {
    ensureViewerAudioContext();
    const ctx = state.viewerAudioCtx;
    if (!ctx || !state.viewerGainNode) return;

    const sampleRate = audioPayload.sampleRate || 48000;
    let floatArray;
    if (audioPayload.b64) {
      floatArray = base64ToInt16Float32(audioPayload.b64);
    } else {
      floatArray = new Float32Array(audioPayload.data);
    }

    const audioBuffer = ctx.createBuffer(1, floatArray.length, sampleRate);
    audioBuffer.getChannelData(0).set(floatArray);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(state.viewerGainNode);

    const now = ctx.currentTime;
    // Sincronização ultra-estrita (máximo 40ms de margem) para áudio sem nenhum atraso em relação ao vídeo
    if (state.audioNextPlayTime < now || (state.audioNextPlayTime - now) > 0.04) {
      state.audioNextPlayTime = now + 0.005;
    }

    source.start(state.audioNextPlayTime);
    state.audioNextPlayTime += audioBuffer.duration;
  } catch (err) {}
}

// ==========================================
// WebRTC Suporte
// ==========================================
async function createOfferForViewer(viewerId) {
  if (!PeerConnectionClass) return;
  try {
    const pc = new PeerConnectionClass(RTC_CONFIG);
    state.hostPeerConnections.set(viewerId, pc);

    if (state.localStream) {
      state.localStream.getTracks().forEach((track) => pc.addTrack(track, state.localStream));
    }
    if (state.audioStream) {
      state.audioStream.getTracks().forEach((track) => pc.addTrack(track, state.audioStream));
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({
          type: 'ice-candidate',
          candidate: event.candidate,
          targetId: viewerId
        });
      }
    };

    const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
    await pc.setLocalDescription(offer);

    sendSignal({
      type: 'offer',
      sdp: pc.localDescription,
      targetId: viewerId
    });
  } catch (err) {}
}

async function handleOfferAndCreateAnswer(sdp, hostId) {
  if (!PeerConnectionClass) return;
  try {
    if (state.viewerPeerConnection) state.viewerPeerConnection.close();

    const pc = new PeerConnectionClass(RTC_CONFIG);
    state.viewerPeerConnection = pc;

    state.remoteStream = new MediaStream();
    dom.preview.srcObject = state.remoteStream;
    dom.preview.muted = state.isMuted;
    dom.preview.volume = state.currentVolume;
    dom.preview.classList.remove('hidden');
    dom.canvasPreview.classList.add('hidden');
    dom.videoPlaceholder.classList.add('hidden');

    pc.ontrack = (event) => {
      state.remoteStream.addTrack(event.track);
      if (event.track.kind === 'audio') {
        initAudioVisualizer(state.remoteStream);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({
          type: 'ice-candidate',
          candidate: event.candidate,
          targetId: hostId
        });
      }
    };

    const RTCSessionClass = window.RTCSessionDescription || window.webkitRTCSessionDescription;
    await pc.setRemoteDescription(new RTCSessionClass(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    sendSignal({
      type: 'answer',
      sdp: pc.localDescription,
      targetId: hostId
    });
  } catch (err) {}
}

async function handleAnswerFromViewer(sdp, viewerId) {
  const pc = state.hostPeerConnections.get(viewerId);
  if (!pc) return;
  try {
    const RTCSessionClass = window.RTCSessionDescription || window.webkitRTCSessionDescription;
    await pc.setRemoteDescription(new RTCSessionClass(sdp));
  } catch (err) {}
}

function handleRemoteIceCandidate(candidate, fromId) {
  try {
    const RTCIceClass = window.RTCIceCandidate || window.webkitRTCIceCandidate;
    const ice = new RTCIceClass(candidate);
    if (state.isHosting) {
      const pc = state.hostPeerConnections.get(fromId);
      if (pc) pc.addIceCandidate(ice);
    } else if (state.viewerPeerConnection) {
      state.viewerPeerConnection.addIceCandidate(ice);
    }
  } catch (err) {}
}

// ==========================================
// Visualizador de VU de Áudio Compacto
// ==========================================
function initAudioVisualizer(stream) {
  try {
    if (stream.getAudioTracks().length === 0) return;

    if (state.audioContext) state.audioContext.close();

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContextClass();
    const source = state.audioContext.createMediaStreamSource(stream);
    state.audioAnalyser = state.audioContext.createAnalyser();
    state.audioAnalyser.fftSize = 256;

    source.connect(state.audioAnalyser);

    const bufferLength = state.audioAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function updateVU() {
      if (!state.audioAnalyser) return;
      state.audioAnalyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
      const avg = sum / bufferLength;
      const percent = Math.min(100, Math.round((avg / 128) * 100));

      if (dom.audioVuBar) dom.audioVuBar.style.width = `${percent}%`;

      if (dom.audioDbText) {
        if (percent > 0) {
          const db = Math.round(20 * Math.log10(avg / 255));
          dom.audioDbText.textContent = `${db} dB`;
        } else {
          dom.audioDbText.textContent = 'Mudo';
        }
      }

      state.audioAnimFrameId = requestAnimationFrame(updateVU);
    }

    updateVU();
  } catch (err) {}
}

// ==========================================
// Tela Cheia & Modo Foco
// ==========================================
function toggleFullscreen() {
  ensureViewerAudioContext();
  const elem = dom.videoWrapper;
  const isNativeFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
  const isPseudoFullscreen = elem.classList.contains('pseudo-fullscreen');

  if (isNativeFullscreen) {
    if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  } else if (isPseudoFullscreen) {
    elem.classList.remove('pseudo-fullscreen');
    document.body.classList.remove('no-scroll');
  } else {
    let reqPromise = null;
    try {
      if (elem.requestFullscreen) reqPromise = elem.requestFullscreen();
      else if (elem.webkitRequestFullscreen) reqPromise = elem.webkitRequestFullscreen();
    } catch (err) {}

    if (reqPromise && typeof reqPromise.catch === 'function') {
      reqPromise.catch(() => {
        elem.classList.add('pseudo-fullscreen');
        document.body.classList.add('no-scroll');
      });
    } else if (!reqPromise && !document.fullscreenElement) {
      elem.classList.add('pseudo-fullscreen');
      document.body.classList.add('no-scroll');
    }
  }
}

function toggleFocusMode() {
  ensureViewerAudioContext();
  dom.mainGrid.classList.toggle('focus-mode');
  const isFocus = dom.mainGrid.classList.contains('focus-mode');
  dom.btnToggleFocus.textContent = isFocus ? '📋 Mostrar Painéis' : '📺 Modo Foco';
}

// ==========================================
// Encerramento e Limpeza
// ==========================================
function stopSharing() {
  log('Encerrando sua transmissão...', 'info');

  state.isHosting = false;

  if (timerWorker) timerWorker.postMessage('stop');
  if (state.antiLagInterval) clearInterval(state.antiLagInterval);
  if (state.scriptProcessor) {
    state.scriptProcessor.disconnect();
    state.scriptProcessor = null;
  }
  if (state.hostAudioCtx) {
    state.hostAudioCtx.close();
    state.hostAudioCtx = null;
  }
  if (state.localStream) {
    state.localStream.getTracks().forEach((t) => t.stop());
    state.localStream = null;
  }
  if (state.audioStream) {
    state.audioStream.getTracks().forEach((t) => t.stop());
    state.audioStream = null;
  }

  sendSignal({ type: 'stop-stream' });

  state.hostPeerConnections.forEach((pc) => pc.close());
  state.hostPeerConnections.clear();

  updateHostViewersList([], 0, 0, 0);

  dom.btnHost.classList.remove('hidden');
  dom.btnHost.disabled = false;
  dom.btnStop.classList.add('hidden');
  dom.btnStop.disabled = true;
  if (dom.btnChangeWindow) {
    dom.btnChangeWindow.classList.add('hidden');
    dom.btnChangeWindow.disabled = true;
  }

  dom.statRole.textContent = 'Standby';
  dom.statFps.textContent = '0 fps';
  dom.statResolution.textContent = '---';

  if (state.availableStreams.length > 0) {
    selectStream(state.availableStreams[0].hostId);
  } else {
    dom.videoPlaceholder.classList.remove('hidden');
    updateActiveStreamHeader(null);
  }

  updateDiscordPresence();
}

function cleanupViewerMedia() {
  if (state.viewerPeerConnection) {
    state.viewerPeerConnection.close();
    state.viewerPeerConnection = null;
  }

  if (state.viewerAudioCtx) {
    state.viewerAudioCtx.close();
    state.viewerAudioCtx = null;
    state.viewerGainNode = null;
  }

  if (state.audioAnimFrameId) {
    cancelAnimationFrame(state.audioAnimFrameId);
    state.audioAnimFrameId = null;
  }

  dom.preview.srcObject = null;
  dom.preview.classList.add('hidden');
  dom.canvasPreview.classList.add('hidden');
  if (dom.audioVuBar) dom.audioVuBar.style.width = '0%';
  if (dom.audioDbText) dom.audioDbText.textContent = '-inf dB';
}

// ==========================================
// Event Listeners
// ==========================================
dom.btnHost.addEventListener('click', startScreenSharing);
dom.btnStop.addEventListener('click', stopSharing);
if (dom.btnChangeWindow) {
  dom.btnChangeWindow.addEventListener('click', changeScreenSharingSource);
}

dom.btnFullscreen.addEventListener('click', toggleFullscreen);
dom.btnFloatingFullscreen.addEventListener('click', toggleFullscreen);
dom.btnToggleFocus.addEventListener('click', toggleFocusMode);
dom.videoWrapper.addEventListener('dblclick', toggleFullscreen);

// ==========================================
// Parar de Assistir e Menu de Contexto (Botão Direito)
// ==========================================
function stopWatchingStream() {
  if (!state.watchingHostId) return;

  log(`Parando de assistir a transmissão de ${state.watchingProfile?.username || state.watchingHostId}...`, 'info');
  state.userStoppedWatching = true;

  sendSignal({
    type: 'unwatch-stream'
  });

  cleanupViewerMedia();
  state.watchingHostId = null;
  state.watchingProfile = null;
  updateActiveStreamHeader(null);

  dom.videoPlaceholder.classList.remove('hidden');
  dom.placeholderText.textContent = 'Chamada de Voz Ativa';
  dom.placeholderTip.textContent = 'Clique em qualquer transmissão AO VIVO abaixo para assistir a tela!';
  dom.statRole.textContent = 'Na Chamada (Lobby)';

  setFocusMode(false);
  updateAvailableStreams(state.availableStreams, state.callParticipants);
  updateDiscordPresence('Na chamada via Dodo', 'Dodo Screen Share');
}

function showStreamEndedScreen(streamerName) {
  dom.videoPlaceholder.classList.remove('hidden');
  dom.placeholderText.textContent = 'A transmissão terminou';
  dom.placeholderTip.innerHTML = `
    <div style="margin-bottom: 12px; color: #949ba4; font-size: 0.85rem;">
      A transmissão de <strong>${escapeHtml(streamerName)}</strong> foi encerrada.
    </div>
    <button class="btn btn-secondary btn-sm" id="btnBackToLobby" style="margin: 0 auto; pointer-events: auto;">
      <iconify-icon icon="lucide:layout-grid" width="14"></iconify-icon> Voltar para a Chamada
    </button>
  `;

  const btn = document.getElementById('btnBackToLobby');
  if (btn) {
    btn.onclick = (e) => {
      e.stopPropagation();
      dom.placeholderText.textContent = 'Chamada de Voz Ativa';
      dom.placeholderTip.textContent = 'Clique em qualquer transmissão AO VIVO abaixo para assistir a tela!';
    };
  }

  updateAvailableStreams(state.availableStreams, state.callParticipants);
}

const contextMenu = document.getElementById('streamContextMenu');
const ctxStopWatching = document.getElementById('ctxStopWatching');
const ctxToggleMute = document.getElementById('ctxToggleMute');
const ctxMuteIcon = document.getElementById('ctxMuteIcon');
const ctxMuteText = document.getElementById('ctxMuteText');
const ctxFullscreen = document.getElementById('ctxFullscreen');

function hideContextMenu() {
  if (contextMenu) contextMenu.classList.add('hidden');
}

dom.videoWrapper.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!contextMenu) return;

  // Atualiza opções do menu
  if (ctxStopWatching) {
    if (state.watchingHostId) {
      ctxStopWatching.classList.remove('hidden');
    } else {
      ctxStopWatching.classList.add('hidden');
    }
  }

  if (ctxMuteText && ctxMuteIcon) {
    if (state.isMuted) {
      ctxMuteText.textContent = 'Desmutar transmissão';
      ctxMuteIcon.setAttribute('icon', 'lucide:volume-2');
    } else {
      ctxMuteText.textContent = 'Mutar transmissão';
      ctxMuteIcon.setAttribute('icon', 'lucide:volume-x');
    }
  }

  // Posiciona menu na tela respeitando os limites da janela
  const x = Math.min(e.clientX, window.innerWidth - 230);
  const y = Math.min(e.clientY, window.innerHeight - 150);

  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.classList.remove('hidden');
});

document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target)) {
    hideContextMenu();
  }
});

if (ctxStopWatching) {
  ctxStopWatching.addEventListener('click', () => {
    hideContextMenu();
    stopWatchingStream();
  });
}

if (ctxToggleMute) {
  ctxToggleMute.addEventListener('click', () => {
    hideContextMenu();
    toggleMute();
  });
}

if (ctxFullscreen) {
  ctxFullscreen.addEventListener('click', () => {
    hideContextMenu();
    toggleFullscreen();
  });
}

// Seletores de Qualidade (Resolução e FPS em Tempo Real)
if (dom.selectResolution) {
  dom.selectResolution.addEventListener('change', (e) => {
    state.targetResolution = e.target.value;
    log(`⚙️ Resolução ajustada em tempo real para: ${e.target.value}`, 'info');

    let maxW = 1280;
    let maxH = 720;
    if (e.target.value === '1080p') { maxW = 1920; maxH = 1080; }
    else if (e.target.value === '480p') { maxW = 854; maxH = 480; }

    if (state.localStream) {
      const vTrack = state.localStream.getVideoTracks()[0];
      if (vTrack && vTrack.applyConstraints) {
        vTrack.applyConstraints({ width: { ideal: maxW }, height: { ideal: maxH } }).catch(() => {});
      }
    }
  });
}

if (dom.selectFps) {
  dom.selectFps.addEventListener('change', (e) => {
    state.targetFps = Number(e.target.value);
    restartAntiLagTimer();
    log(`⚙️ Taxa de quadros ajustada em tempo real para: ${e.target.value} FPS`, 'info');

    if (state.localStream) {
      const vTrack = state.localStream.getVideoTracks()[0];
      if (vTrack && vTrack.applyConstraints) {
        vTrack.applyConstraints({ frameRate: { ideal: state.targetFps, max: state.targetFps } }).catch(() => {});
      }
    }
  });
}

// Botão de Dica de Áudio (Anti-Eco)
if (dom.btnAudioTip && dom.audioTipBanner) {
  dom.btnAudioTip.addEventListener('click', () => {
    dom.audioTipBanner.classList.toggle('hidden');
  });
}

if (dom.btnCloseAudioTip && dom.audioTipBanner) {
  dom.btnCloseAudioTip.addEventListener('click', () => {
    dom.audioTipBanner.classList.add('hidden');
  });
}

// Alternância da Galeria / Foco ao Clicar na Tela
dom.videoWrapper.addEventListener('click', (e) => {
  if (e.target.closest('.video-floating-bar') || e.target.closest('.call-gallery-shelf') || e.target.closest('.host-actions-bar') || e.target.closest('.custom-context-menu')) {
    return;
  }
  ensureViewerAudioContext();
  setFocusMode(!state.isFocusedMode);
});

// Controles de Volume
dom.volumeSlider.addEventListener('input', (e) => {
  ensureViewerAudioContext();
  updateVolume(Number(e.target.value));
});

dom.btnMute.addEventListener('click', (e) => {
  e.stopPropagation();
  ensureViewerAudioContext();
  toggleMute();
});

// Logout do Discord
if (dom.btnLogout) {
  dom.btnLogout.addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.removeItem('discord_user');
    state.userProfile = null;
    initDiscordAuth();
    log('Desconectado da conta do Discord.', 'info');
  });
}

// Auto-Hide de Controles na Inatividade do Mouse
let mouseIdleTimeout = null;

function resetMouseIdleTimer() {
  dom.videoWrapper.classList.remove('user-idle');
  if (mouseIdleTimeout) clearTimeout(mouseIdleTimeout);

  const isPlaying = dom.videoPlaceholder.classList.contains('hidden');
  if (isPlaying) {
    mouseIdleTimeout = setTimeout(() => {
      dom.videoWrapper.classList.add('user-idle');
    }, 2500);
  }
}

dom.videoWrapper.addEventListener('mousemove', resetMouseIdleTimer);
dom.videoWrapper.addEventListener('mouseenter', resetMouseIdleTimer);
dom.videoWrapper.addEventListener('touchstart', resetMouseIdleTimer);
dom.videoWrapper.addEventListener('mouseleave', () => {
  if (dom.videoPlaceholder.classList.contains('hidden')) {
    if (mouseIdleTimeout) clearTimeout(mouseIdleTimeout);
    mouseIdleTimeout = setTimeout(() => {
      dom.videoWrapper.classList.add('user-idle');
    }, 800);
  }
});

// Desbloqueio de Áudio em Tempo Real e Atalhos Globais
document.addEventListener('click', ensureViewerAudioContext);
document.addEventListener('pointerdown', ensureViewerAudioContext);
document.addEventListener('touchstart', ensureViewerAudioContext);
window.addEventListener('focus', ensureViewerAudioContext);
document.addEventListener('keydown', (e) => {
  ensureViewerAudioContext();
  if (document.activeElement.tagName === 'INPUT') return;

  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  if (e.key === 'Escape' && dom.videoWrapper.classList.contains('pseudo-fullscreen')) toggleFullscreen();
  if (e.key === 'm' || e.key === 'M') toggleMute();
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    updateVolume(Math.min(100, Math.round(state.currentVolume * 100) + 5));
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    updateVolume(Math.max(0, Math.round(state.currentVolume * 100) - 5));
  }
});

dom.btnCopyLogs.addEventListener('click', async () => {
  const logText = state.logHistory
    .map((e) => `[${e.timestamp}] [${e.category.toUpperCase()}] ${e.message}`)
    .join('\n');
  try {
    await navigator.clipboard.writeText(logText);
    dom.btnCopyLogs.textContent = '✅ Copiado!';
    setTimeout(() => { dom.btnCopyLogs.textContent = '📋 Copiar'; }, 2000);
  } catch (err) {}
});

dom.btnClearLogs.addEventListener('click', () => {
  dom.logs.innerHTML = '';
  state.logHistory = [];
  dom.logCount.textContent = '0 eventos';
  log('Logs limpos pelo usuário.', 'info');
});

// Modal de Guia de Transmissão (Quero Transmitir)
const PUBLIC_STREAM_PANEL_URL = 'https://beverly-discusses-souls-bug.trycloudflare.com/';

function getPublicPanelUrl() {
  if (window.location.origin.includes('discordsays.com')) {
    return PUBLIC_STREAM_PANEL_URL;
  }
  return `${window.location.origin}/`;
}

function openStreamModal() {
  const targetUrl = getPublicPanelUrl();
  if (dom.streamUrlInput) {
    dom.streamUrlInput.value = targetUrl;
  }
  if (dom.btnOpenStreamUrl) {
    dom.btnOpenStreamUrl.href = targetUrl;
  }
  if (dom.modalStreamGuide) {
    dom.modalStreamGuide.classList.remove('hidden');
  }
}

function closeStreamModal() {
  if (dom.modalStreamGuide) dom.modalStreamGuide.classList.add('hidden');
}

const btnLobbyWantToStream = document.getElementById('btnLobbyWantToStream');
const btnFloatingWantToStream = document.getElementById('btnFloatingWantToStream');

if (btnLobbyWantToStream) btnLobbyWantToStream.addEventListener('click', (e) => { e.stopPropagation(); openStreamModal(); });
if (btnFloatingWantToStream) btnFloatingWantToStream.addEventListener('click', (e) => { e.stopPropagation(); openStreamModal(); });
if (dom.btnWantToStream) dom.btnWantToStream.addEventListener('click', (e) => { e.stopPropagation(); openStreamModal(); });

if (dom.btnCloseStreamModal) dom.btnCloseStreamModal.addEventListener('click', closeStreamModal);
if (dom.btnDismissStreamModal) dom.btnDismissStreamModal.addEventListener('click', closeStreamModal);

if (dom.modalStreamGuide) {
  dom.modalStreamGuide.addEventListener('click', (e) => {
    if (e.target === dom.modalStreamGuide) closeStreamModal();
  });
}

if (dom.streamUrlInput) {
  dom.streamUrlInput.addEventListener('click', () => {
    dom.streamUrlInput.focus();
    dom.streamUrlInput.select();
  });
}

const copyFeedbackMsg = document.getElementById('copyFeedbackMsg');

if (dom.btnCopyStreamUrl && dom.streamUrlInput) {
  dom.btnCopyStreamUrl.addEventListener('click', async (e) => {
    e.stopPropagation();
    const input = dom.streamUrlInput;
    input.focus();
    input.select();
    input.setSelectionRange(0, 99999);

    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (err) {}

    if (!copied && navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(input.value);
        copied = true;
      } catch (err) {}
    }

    if (copyFeedbackMsg) copyFeedbackMsg.classList.remove('hidden');
    dom.btnCopyStreamUrl.innerHTML = '<iconify-icon icon="lucide:check" width="14"></iconify-icon> Copiado!';
    setTimeout(() => {
      dom.btnCopyStreamUrl.innerHTML = '<iconify-icon icon="lucide:copy" width="14"></iconify-icon> Copiar Link';
      if (copyFeedbackMsg) copyFeedbackMsg.classList.add('hidden');
    }, 3500);
  });
}

// Inicialização
detectVoiceChannelRoom();
initDiscordAuth();
initWebSocket();
setupDiscordRichPresence();
startFpsMonitor();

if (!isInsideDiscordActivity()) {
  if (dom.btnWantToStream) dom.btnWantToStream.style.display = 'none';
  if (btnFloatingWantToStream) btnFloatingWantToStream.style.display = 'none';
  if (btnLobbyWantToStream) btnLobbyWantToStream.style.display = 'none';
  if (dom.volumeControlGroup) dom.volumeControlGroup.style.display = 'none';
  if (dom.callGalleryShelf) dom.callGalleryShelf.style.display = 'none';
  dom.placeholderText.textContent = 'Painel de Transmissão do Host';
  dom.placeholderTip.textContent = 'Clique em "Compartilhar Minha Tela" acima para transmitir. Os membros da call assistirão pela Atividade do Discord!';
}
