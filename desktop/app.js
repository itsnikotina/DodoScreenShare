/**
 * Dodo Screen Share - Desktop Host Application (Electron Renderer)
 * - Captura nativa de telas e janelas via desktopCapturer IPC
 * - Suporte a loopback audio do sistema
 * - Conexão WebRTC e WebSocket Anti-Lag com o Servidor de Sinalização
 * - Sincronização em tempo real com a Atividade do Discord
 */

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ]
};

const PeerConnectionClass = window.RTCPeerConnection || window.webkitRTCPeerConnection || null;

const state = {
  serverUrl: localStorage.getItem('dodo_desktop_server_url') || 'http://localhost:3000',
  ws: null,
  peerId: null,
  roomId: 'call-geral',
  isHosting: false,
  selectedSourceId: null,
  selectedSourceType: 'screens',
  sourcesList: [],
  localStream: null,
  audioStream: null,
  captureCanvas: null,
  captureCtx: null,
  antiLagInterval: null,
  hostAudioCtx: null,
  scriptProcessor: null,
  hostPeerConnections: new Map(),
  fpsSentCount: 0,
  fpsInterval: null,
  viewers: [],
  logHistory: []
};

// DOM Elements
const dom = {
  wsStatusDot: document.getElementById('wsStatusDot'),
  roomBadgeTag: document.getElementById('roomBadgeTag'),
  serverUrlInput: document.getElementById('serverUrlInput'),
  btnApplyServerUrl: document.getElementById('btnApplyServerUrl'),
  btnOpenDiscordActivity: document.getElementById('btnOpenDiscordActivity'),

  btnOpenSourcePicker: document.getElementById('btnOpenSourcePicker'),
  btnStopStream: document.getElementById('btnStopStream'),
  btnChangeSource: document.getElementById('btnChangeSource'),
  selectResolution: document.getElementById('selectResolution'),
  selectFps: document.getElementById('selectFps'),
  chkSystemAudio: document.getElementById('chkSystemAudio'),

  audioVuBar: document.getElementById('audioVuBar'),
  audioDbText: document.getElementById('audioDbText'),

  liveVideoPreview: document.getElementById('liveVideoPreview'),
  liveCanvasPreview: document.getElementById('liveCanvasPreview'),
  previewPlaceholder: document.getElementById('previewPlaceholder'),
  btnPlaceholderStart: document.getElementById('btnPlaceholderStart'),
  liveStreamBadge: document.getElementById('liveStreamBadge'),

  statRole: document.getElementById('statRole'),
  statFps: document.getElementById('statFps'),
  statResolution: document.getElementById('statResolution'),
  statDiscordViewers: document.getElementById('statDiscordViewers'),

  countViewersHeader: document.getElementById('countViewersHeader'),
  viewersListContainer: document.getElementById('viewersListContainer'),

  logCountBadge: document.getElementById('logCountBadge'),
  btnCopyLogs: document.getElementById('btnCopyLogs'),
  btnClearLogs: document.getElementById('btnClearLogs'),
  logsTerminal: document.getElementById('logsTerminal'),

  // Modal Source Picker
  modalSourcePicker: document.getElementById('modalSourcePicker'),
  btnCloseSourcePicker: document.getElementById('btnCloseSourcePicker'),
  btnCancelSourcePicker: document.getElementById('btnCancelSourcePicker'),
  btnConfirmSourcePicker: document.getElementById('btnConfirmSourcePicker'),
  tabScreens: document.getElementById('tabScreens'),
  tabWindows: document.getElementById('tabWindows'),
  badgeScreensCount: document.getElementById('badgeScreensCount'),
  badgeWindowsCount: document.getElementById('badgeWindowsCount'),
  btnRefreshSources: document.getElementById('btnRefreshSources'),
  pickerGridContainer: document.getElementById('pickerGridContainer'),
  modalSelectResolution: document.getElementById('modalSelectResolution'),
  modalSelectFps: document.getElementById('modalSelectFps'),
  modalChkSystemAudio: document.getElementById('modalChkSystemAudio'),

  // Modal Activity Link
  modalActivityLink: document.getElementById('modalActivityLink'),
  btnCloseActivityLink: document.getElementById('btnCloseActivityLink'),
  btnDismissActivityLink: document.getElementById('btnDismissActivityLink'),
  inputActivityUrl: document.getElementById('inputActivityUrl'),
  btnCopyActivityUrl: document.getElementById('btnCopyActivityUrl')
};

// ==========================================
// Utilitários de Log
// ==========================================
function log(message, category = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  state.logHistory.push({ timestamp, message, category });

  const entryEl = document.createElement('div');
  entryEl.className = `log-entry ${category}`;
  entryEl.textContent = `[${timestamp}] [${category.toUpperCase()}] ${message}`;

  if (dom.logsTerminal) {
    dom.logsTerminal.appendChild(entryEl);
    dom.logsTerminal.scrollTop = dom.logsTerminal.scrollHeight;
  }

  if (dom.logCountBadge) {
    dom.logCountBadge.textContent = state.logHistory.length;
  }
}

// ==========================================
// Conexão WebSocket com o Servidor
// ==========================================
function getWsUrl(httpUrl) {
  let url = httpUrl.trim().replace(/\/$/, '');
  if (url.startsWith('https://')) return url.replace('https://', 'wss://') + '/ws';
  if (url.startsWith('http://')) return url.replace('http://', 'ws://') + '/ws';
  return 'ws://' + url + '/ws';
}

function initWebSocket() {
  if (state.reconnectTimeout) {
    clearTimeout(state.reconnectTimeout);
    state.reconnectTimeout = null;
  }

  if (state.ws) {
    state.ws.onclose = null;
    state.ws.onerror = null;
    state.ws.onmessage = null;
    try { state.ws.close(); } catch (e) {}
  }

  const wsUrl = getWsUrl(state.serverUrl);
  log(`Conectando ao servidor: ${wsUrl}...`, 'info');

  try {
    state.ws = new WebSocket(wsUrl);
  } catch (err) {
    log(`Erro ao instanciar WebSocket: ${err.message}`, 'error');
    dom.wsStatusDot.className = 'status-dot';
    return;
  }

  state.ws.onopen = () => {
    if (state.reconnectTimeout) {
      clearTimeout(state.reconnectTimeout);
      state.reconnectTimeout = null;
    }
    log('✅ Conectado com sucesso ao Servidor de Sinalização!', 'success');
    dom.wsStatusDot.className = 'status-dot connected';

    sendSignal({
      type: 'join-room',
      roomId: state.roomId,
      platform: 'desktop-host',
      profile: {
        username: 'Host Desktop',
        avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png'
      }
    });

    // Se já estiver transmitindo na máquina local, registra imediatamente no servidor
    if (state.isHosting && state.localStream) {
      log('🔄 Sincronizando transmissão ativa no servidor...', 'info');
      sendSignal({
        type: 'start-stream',
        profile: {
          username: 'Host Desktop',
          avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png'
        }
      });
    }
  };

  state.ws.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      return;
    }
    handleSignalMessage(msg);
  };

  state.ws.onclose = () => {
    dom.wsStatusDot.className = 'status-dot';
    if (!state.reconnectTimeout) {
      log('⚠️ WebSocket desconectado. Tentando reconectar em 3 segundos...', 'warn');
      state.reconnectTimeout = setTimeout(() => {
        state.reconnectTimeout = null;
        initWebSocket();
      }, 3000);
    }
  };

  state.ws.onerror = (err) => {
    log(`Erro de rede no WebSocket: ${err.message || 'Falha'}`, 'error');
  };
}

function sendSignal(payload) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({
      ...payload,
      roomId: state.roomId
    }));
  }
}

async function handleSignalMessage(msg) {
  switch (msg.type) {
    case 'connected':
      state.peerId = msg.peerId;
      log(`Registrado no servidor com ID: ${msg.peerId}`, 'info');
      break;

    case 'room-joined':
      state.roomId = msg.roomId;
      dom.roomBadgeTag.textContent = msg.roomId.startsWith('call-') ? msg.roomId : `Canal #${msg.roomId.slice(0, 10)}`;
      log(`Sincronizado na sala "${msg.roomId}".`, 'success');
      break;

    case 'stream-viewers-updated':
      updateViewersList(msg.viewers || [], msg.total || 0, msg.discordCount || 0);
      break;

    case 'call-empty-stop-stream':
      log('🚪 Todos os membros saíram da chamada do Discord. Transmissão encerrada automaticamente.', 'warn');
      if (state.isHosting) {
        stopSharing();
      }
      break;

    case 'new-viewer':
      if (state.isHosting && state.localStream) {
        log(`Novo espectador (${msg.viewerId}) [${msg.platform || 'discord'}] conectado à sua tela.`, 'info');
        if (state.captureCanvas) {
          try {
            const frameData = state.captureCanvas.toDataURL('image/jpeg', 0.7);
            sendSignal({ type: 'stream-frame', frame: frameData });
          } catch (e) {}
        }
        if (PeerConnectionClass) {
          await createOfferForViewer(msg.viewerId);
        }
      }
      break;

    case 'answer':
      if (PeerConnectionClass && state.isHosting) {
        await handleAnswerFromViewer(msg.sdp, msg.from);
      }
      break;

    case 'ice-candidate':
      if (PeerConnectionClass && state.isHosting) {
        const pc = state.hostPeerConnections.get(msg.from);
        if (pc && msg.candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch (e) {}
        }
      }
      break;
  }
}

// ==========================================
// Atualização de Espectadores
// ==========================================
function updateViewersList(viewers, total, discordCount) {
  state.viewers = viewers;
  dom.countViewersHeader.textContent = discordCount;
  dom.statDiscordViewers.textContent = discordCount;

  dom.viewersListContainer.innerHTML = '';

  if (viewers.length === 0) {
    dom.viewersListContainer.innerHTML = `
      <div class="empty-viewers-notice">
        <iconify-icon icon="lucide:users" width="32" style="opacity: 0.4;"></iconify-icon>
        <p>Nenhum membro assistindo no momento. Os membros aparecerão aqui assim que abrirem a Atividade na call do Discord!</p>
      </div>
    `;
    return;
  }

  viewers.forEach((v) => {
    const isDiscord = v.platform === 'discord';
    const avatarUrl = v.profile?.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';
    const username = v.profile?.username || (isDiscord ? 'Espectador no Discord' : 'Espectador');

    const row = document.createElement('div');
    row.className = 'viewer-row';
    row.innerHTML = `
      <img src="${avatarUrl}" class="viewer-avatar" alt="Avatar">
      <span class="viewer-name">${escapeHtml(username)}</span>
      <iconify-icon icon="${isDiscord ? 'ic:baseline-discord' : 'lucide:globe'}" width="16" style="margin-left: auto; color: ${isDiscord ? '#5865f2' : '#949ba4'};"></iconify-icon>
    `;
    dom.viewersListContainer.appendChild(row);
  });
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ==========================================
// Modal Seletor de Telas / Janelas (desktopCapturer)
// ==========================================
async function openSourcePickerModal() {
  dom.modalSourcePicker.classList.remove('hidden');
  await refreshDesktopSources();
}

function closeSourcePickerModal() {
  dom.modalSourcePicker.classList.add('hidden');
}

async function refreshDesktopSources() {
  dom.pickerGridContainer.innerHTML = `
    <div class="loading-sources">
      <iconify-icon icon="lucide:loader-2" width="32" class="spin"></iconify-icon>
      <p>Carregando janelas e telas do sistema...</p>
    </div>
  `;

  if (!window.electronAPI || !window.electronAPI.getDesktopSources) {
    dom.pickerGridContainer.innerHTML = `
      <div class="loading-sources">
        <iconify-icon icon="lucide:alert-triangle" width="32" style="color: #da373c;"></iconify-icon>
        <p>API nativa do Electron não encontrada. Certifique-se de executar no Electron Desktop.</p>
      </div>
    `;
    return;
  }

  try {
    const sources = await window.electronAPI.getDesktopSources();
    state.sourcesList = sources;

    const screens = sources.filter((s) => s.isScreen);
    const windows = sources.filter((s) => !s.isScreen);

    dom.badgeScreensCount.textContent = screens.length;
    dom.badgeWindowsCount.textContent = windows.length;

    renderSourcesGrid();
  } catch (err) {
    dom.pickerGridContainer.innerHTML = `
      <div class="loading-sources">
        <iconify-icon icon="lucide:alert-triangle" width="32" style="color: #da373c;"></iconify-icon>
        <p>Erro ao listar telas: ${err.message}</p>
      </div>
    `;
  }
}

function renderSourcesGrid() {
  const currentTab = state.selectedSourceType;
  const filtered = state.sourcesList.filter((s) => currentTab === 'screens' ? s.isScreen : !s.isScreen);

  dom.pickerGridContainer.innerHTML = '';

  if (filtered.length === 0) {
    dom.pickerGridContainer.innerHTML = `
      <div class="loading-sources">
        <iconify-icon icon="lucide:monitor-off" width="32" style="opacity: 0.4;"></iconify-icon>
        <p>Nenhuma ${currentTab === 'screens' ? 'tela' : 'janela de aplicativo'} encontrada.</p>
      </div>
    `;
    dom.btnConfirmSourcePicker.disabled = true;
    return;
  }

  filtered.forEach((source) => {
    const isSelected = state.selectedSourceId === source.id;
    const card = document.createElement('div');
    card.className = `source-item-card ${isSelected ? 'selected' : ''}`;
    card.dataset.sourceId = source.id;

    const thumbSrc = source.thumbnail || '';
    const iconSrc = source.appIcon || '';

    card.innerHTML = `
      <div class="source-thumb-box">
        ${thumbSrc ? `<img src="${thumbSrc}" class="source-thumb-img" alt="${escapeHtml(source.name)}">` : '<iconify-icon icon="lucide:monitor" width="32"></iconify-icon>'}
      </div>
      <div class="source-info-row">
        ${iconSrc ? `<img src="${iconSrc}" class="source-app-icon" alt="App">` : '<iconify-icon icon="lucide:app-window" width="16" style="color: #949ba4;"></iconify-icon>'}
        <span class="source-title-text" title="${escapeHtml(source.name)}">${escapeHtml(source.name)}</span>
      </div>
    `;

    card.addEventListener('click', () => {
      state.selectedSourceId = source.id;
      document.querySelectorAll('.source-item-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      dom.btnConfirmSourcePicker.disabled = false;
    });

    card.addEventListener('dblclick', () => {
      state.selectedSourceId = source.id;
      confirmSourceSelection();
    });

    dom.pickerGridContainer.appendChild(card);
  });
}

function selectPickerTab(tab) {
  state.selectedSourceType = tab;
  dom.tabScreens.classList.toggle('active', tab === 'screens');
  dom.tabWindows.classList.toggle('active', tab === 'windows');
  renderSourcesGrid();
}

async function confirmSourceSelection() {
  if (!state.selectedSourceId) return;

  const res = dom.modalSelectResolution.value;
  const fps = dom.modalSelectFps.value;
  const audio = dom.modalChkSystemAudio.checked;

  dom.selectResolution.value = res;
  dom.selectFps.value = fps;
  dom.chkSystemAudio.checked = audio;

  closeSourcePickerModal();
  await startNativeScreenSharing(state.selectedSourceId, res, Number(fps), audio);
}

// ==========================================
// Captura Nativa & Streaming WebRTC
// ==========================================
async function startNativeScreenSharing(sourceId, resolution = '720p', fps = 30, includeAudio = true) {
  log(`================ INICIANDO TRANSMISSÃO DESKTOP NATIVA ===============`, 'info');
  log(`ID da Fonte: "${sourceId}" | Resolução: ${resolution} @ ${fps} FPS | Áudio: ${includeAudio ? 'SIM' : 'NÃO'}`, 'info');

  let maxW = 1280;
  let maxH = 720;
  if (resolution === '1080p') { maxW = 1920; maxH = 1080; }
  else if (resolution === '480p') { maxW = 854; maxH = 480; }

  try {
    if (window.electronAPI && window.electronAPI.setActiveCaptureSource) {
      await window.electronAPI.setActiveCaptureSource(sourceId);
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: fps, max: fps },
          width: { ideal: maxW, max: maxW },
          height: { ideal: maxH, max: maxH }
        },
        audio: includeAudio
      });
    } catch (err1) {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });
    }

    state.localStream = stream;
    state.isHosting = true;

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length > 0) {
      state.audioStream = stream;
      initAudioVisualizer(stream);
      startAudioStreamer(stream);
      log('🔊 Áudio do sistema capturado com sucesso!', 'success');
    } else if (includeAudio) {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          video: false
        });
        state.audioStream = micStream;
        initAudioVisualizer(micStream);
        startAudioStreamer(micStream);
        log('🔊 Áudio conectado com sucesso!', 'success');
      } catch (e) {}
    }

    // UI Updates
    dom.liveVideoPreview.srcObject = stream;
    dom.liveVideoPreview.classList.remove('hidden');
    dom.previewPlaceholder.classList.add('hidden');
    dom.liveStreamBadge.classList.remove('hidden');

    dom.btnOpenSourcePicker.classList.add('hidden');
    dom.btnStopStream.classList.remove('hidden');
    dom.btnStopStream.disabled = false;
    dom.btnChangeSource.classList.remove('hidden');

    dom.statRole.textContent = 'HOST (Ao Vivo)';
    dom.statResolution.textContent = `${maxW}x${maxH}`;

    // Listeners para encerramento de faixas
    stream.getTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        log(`Faixa de captura (${track.kind}) finalizada.`, 'warn');
        if (state.isHosting) stopSharing();
      });
    });

    // Inicia Anti-Lag Streamer e sinaliza ao servidor
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      sendSignal({
        type: 'start-stream',
        profile: {
          username: 'Host Desktop',
          avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png'
        }
      });
    } else {
      log('⚠️ Servidor não conectado no momento. A transmissão local está ativa.', 'warn');
    }

    startAntiLagStreamer(stream, fps);
    log('🎉 Transmissão iniciada! Os membros da call podem assistir agora na Atividade do Discord.', 'success');

  } catch (err) {
    log(`❌ Erro ao iniciar captura nativa: ${err.message}`, 'error');
  }
}

// Anti-Lag Video Frame Streamer
function startAntiLagStreamer(stream, targetFps = 30) {
  if (state.antiLagInterval) clearInterval(state.antiLagInterval);

  state.captureCanvas = dom.liveCanvasPreview;
  state.captureCtx = state.captureCanvas.getContext('2d', { alpha: false });

  const intervalMs = Math.round(1000 / targetFps);

  state.antiLagInterval = setInterval(() => {
    if (!state.isHosting || !dom.liveVideoPreview || dom.liveVideoPreview.readyState < 2) return;

    const w = dom.liveVideoPreview.videoWidth;
    const h = dom.liveVideoPreview.videoHeight;
    if (!w || !h) return;

    if (state.captureCanvas.width !== w || state.captureCanvas.height !== h) {
      state.captureCanvas.width = w;
      state.captureCanvas.height = h;
    }

    state.captureCtx.drawImage(dom.liveVideoPreview, 0, 0, w, h);
    const frameData = state.captureCanvas.toDataURL('image/jpeg', 0.65);

    sendSignal({
      type: 'stream-frame',
      frame: frameData
    });

    state.fpsSentCount++;
  }, intervalMs);
}

// Audio Streamer via ScriptProcessor
function startAudioStreamer(audioStream) {
  try {
    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtxClass) return;

    state.hostAudioCtx = new AudioCtxClass({ sampleRate: 48000 });
    const source = state.hostAudioCtx.createMediaStreamSource(audioStream);
    state.scriptProcessor = state.hostAudioCtx.createScriptProcessor(2048, 1, 1);

    state.scriptProcessor.onaudioprocess = (e) => {
      if (!state.isHosting) return;
      const inputData = e.inputBuffer.getChannelData(0);
      
      const int16Array = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      const bytes = new Uint8Array(int16Array.buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const b64 = btoa(binary);

      sendSignal({
        type: 'stream-audio',
        audio: { b64, sampleRate: state.hostAudioCtx.sampleRate }
      });
    };

    source.connect(state.scriptProcessor);
    state.scriptProcessor.connect(state.hostAudioCtx.destination);
  } catch (err) {
    log(`Erro no streamer de áudio: ${err.message}`, 'warn');
  }
}

// VU Meter
function initAudioVisualizer(audioStream) {
  try {
    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtxClass();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const source = ctx.createMediaStreamSource(audioStream);
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    function updateVU() {
      if (!state.isHosting) {
        if (dom.audioVuBar) dom.audioVuBar.style.width = '0%';
        if (dom.audioDbText) dom.audioDbText.textContent = '-inf dB';
        return;
      }

      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const avg = sum / dataArray.length;
      const percent = Math.min(100, Math.round((avg / 128) * 100));

      if (dom.audioVuBar) dom.audioVuBar.style.width = `${percent}%`;
      if (dom.audioDbText) dom.audioDbText.textContent = percent > 0 ? `${Math.round(percent * 0.6 - 60)} dB` : '-inf dB';

      requestAnimationFrame(updateVU);
    }
    updateVU();
  } catch (e) {}
}

// WebRTC PeerConnection
async function createOfferForViewer(viewerId) {
  if (!PeerConnectionClass) return;
  try {
    const pc = new PeerConnectionClass(RTC_CONFIG);
    state.hostPeerConnections.set(viewerId, pc);

    if (state.localStream) {
      state.localStream.getTracks().forEach(t => pc.addTrack(t, state.localStream));
    }
    if (state.audioStream) {
      state.audioStream.getTracks().forEach(t => pc.addTrack(t, state.audioStream));
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

async function handleAnswerFromViewer(sdp, viewerId) {
  const pc = state.hostPeerConnections.get(viewerId);
  if (!pc) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  } catch (err) {}
}

// ==========================================
// Encerramento da Transmissão
// ==========================================
function stopSharing() {
  log('Encerrando transmissão...', 'info');

  state.isHosting = false;

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
    state.localStream.getTracks().forEach(t => t.stop());
    state.localStream = null;
  }
  if (state.audioStream) {
    state.audioStream.getTracks().forEach(t => t.stop());
    state.audioStream = null;
  }

  sendSignal({ type: 'stop-stream' });

  state.hostPeerConnections.forEach(pc => pc.close());
  state.hostPeerConnections.clear();

  updateViewersList([], 0, 0);

  dom.liveVideoPreview.srcObject = null;
  dom.liveVideoPreview.classList.add('hidden');
  dom.previewPlaceholder.classList.remove('hidden');
  dom.liveStreamBadge.classList.add('hidden');

  dom.btnOpenSourcePicker.classList.remove('hidden');
  dom.btnStopStream.classList.add('hidden');
  dom.btnStopStream.disabled = true;
  dom.btnChangeSource.classList.add('hidden');

  dom.statRole.textContent = 'Standby';
  dom.statFps.textContent = '0 fps (Envio)';
  dom.statResolution.textContent = '---';

  log('⏹️ Transmissão encerrada.', 'info');
}

// FPS Monitor
function startFpsMonitor() {
  if (state.fpsInterval) clearInterval(state.fpsInterval);
  state.fpsInterval = setInterval(() => {
    if (state.isHosting) {
      dom.statFps.textContent = `${state.fpsSentCount} fps (Envio)`;
      state.fpsSentCount = 0;
    } else {
      dom.statFps.textContent = '0 fps (Envio)';
      state.fpsSentCount = 0;
    }
  }, 1000);
}

// ==========================================
// Event Listeners
// ==========================================
dom.btnOpenSourcePicker.addEventListener('click', openSourcePickerModal);
dom.btnPlaceholderStart.addEventListener('click', openSourcePickerModal);
dom.btnChangeSource.addEventListener('click', openSourcePickerModal);
dom.btnStopStream.addEventListener('click', stopSharing);

dom.btnCloseSourcePicker.addEventListener('click', closeSourcePickerModal);
dom.btnCancelSourcePicker.addEventListener('click', closeSourcePickerModal);
dom.btnConfirmSourcePicker.addEventListener('click', confirmSourceSelection);
dom.btnRefreshSources.addEventListener('click', refreshDesktopSources);

dom.tabScreens.addEventListener('click', () => selectPickerTab('screens'));
dom.tabWindows.addEventListener('click', () => selectPickerTab('windows'));

dom.btnApplyServerUrl.addEventListener('click', () => {
  const val = dom.serverUrlInput.value.trim();
  if (val) {
    state.serverUrl = val;
    localStorage.setItem('dodo_desktop_server_url', val);
    initWebSocket();
  }
});

dom.btnOpenDiscordActivity.addEventListener('click', () => {
  dom.inputActivityUrl.value = state.serverUrl;
  dom.modalActivityLink.classList.remove('hidden');
});

dom.btnCloseActivityLink.addEventListener('click', () => dom.modalActivityLink.classList.add('hidden'));
dom.btnDismissActivityLink.addEventListener('click', () => dom.modalActivityLink.classList.add('hidden'));

dom.btnCopyActivityUrl.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(dom.inputActivityUrl.value);
    dom.btnCopyActivityUrl.textContent = 'Copiado!';
    setTimeout(() => { dom.btnCopyActivityUrl.textContent = 'Copiar'; }, 2000);
  } catch (e) {}
});

dom.btnCopyLogs.addEventListener('click', async () => {
  const text = state.logHistory.map(l => `[${l.timestamp}] [${l.category.toUpperCase()}] ${l.message}`).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    dom.btnCopyLogs.textContent = 'Copiado!';
    setTimeout(() => { dom.btnCopyLogs.textContent = 'Copiar'; }, 2000);
  } catch (e) {}
});

dom.btnClearLogs.addEventListener('click', () => {
  state.logHistory = [];
  dom.logsTerminal.innerHTML = '';
  dom.logCountBadge.textContent = '0';
});

// Inicialização
dom.serverUrlInput.value = state.serverUrl;
initWebSocket();
startFpsMonitor();
