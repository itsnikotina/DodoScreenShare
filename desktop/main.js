import { app, BrowserWindow, ipcMain, desktopCapturer, session } from 'electron';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { fileURLToPath } from 'url';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let nativeAudioProcess = null;
let audioModuleSinkId = null;
let audioModuleLoopbackId = null;
let originalDefaultSink = null;
let isolationInterval = null;

const GITHUB_REPO = 'itsnikotina/DodoScreenShare';
const GITHUB_BRANCH = 'main';
const FILES_TO_UPDATE = [
  'desktop/app.js',
  'desktop/main.js',
  'desktop/index.html',
  'desktop/style.css',
  'desktop/preload.cjs',
  'public/app.js',
  'public/index.html',
  'public/style.css',
  'server.js',
  'package.json'
];

function fetchRawFile(filePath, sha = 'main') {
  return new Promise((resolve, reject) => {
    const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/${sha}/${filePath}?t=${Date.now()}`;
    https.get(url, { headers: { 'User-Agent': 'DodoScreenShare-App' } }, (res) => {
      if (res.statusCode === 200) {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve(data));
      } else {
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    }).on('error', reject);
  });
}

function fetchLatestCommit() {
  return new Promise((resolve) => {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`;
    https.get(url, { headers: { 'User-Agent': 'DodoScreenShare-App' } }, (res) => {
      if (res.statusCode === 200) {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.sha || null);
          } catch (e) { resolve(null); }
        });
      } else {
        resolve(null);
      }
    }).on('error', () => resolve(null));
  });
}

let lastAppliedCommitSha = null;

async function checkForUpdates(silent = true) {
  try {
    const latestSha = await fetchLatestCommit();
    if (!latestSha) return { updated: false, reason: 'Sem conexão com GitHub' };

    let filesChanged = 0;
    const rootDir = path.resolve(__dirname, '..');

    for (const relPath of FILES_TO_UPDATE) {
      try {
        const remoteContent = await fetchRawFile(relPath, latestSha);
        const localPath = path.join(rootDir, relPath);

        let localContent = '';
        if (fs.existsSync(localPath)) {
          localContent = fs.readFileSync(localPath, 'utf8');
        }

        if (remoteContent && remoteContent !== localContent) {
          const dir = path.dirname(localPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(localPath, remoteContent, 'utf8');
          filesChanged++;
        }
      } catch (fErr) {}
    }

    lastAppliedCommitSha = latestSha;

    if (filesChanged > 0) {
      console.log(`[Auto-Updater] ${filesChanged} arquivo(s) atualizados com sucesso (${latestSha.substring(0, 7)})!`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app-updated', {
          filesChanged,
          commitSha: latestSha.substring(0, 7)
        });
      }
      return { updated: true, filesChanged, commitSha: latestSha.substring(0, 7) };
    }

    return { updated: false, message: 'App já está na versão mais recente!' };
  } catch (err) {
    return { updated: false, error: err.message };
  }
}

ipcMain.handle('check-app-update', async () => {
  return await checkForUpdates(false);
});

ipcMain.handle('reload-app', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.reload();
  }
  return true;
});

// Captura Direta de Áudio Nativo em Estéreo 48kHz (L/R) via PulseAudio/PipeWire (parec)
ipcMain.handle('start-native-stereo-audio', async () => {
  if (process.platform !== 'linux') return { success: false, error: 'Não é Linux' };

  try {
    if (nativeAudioProcess) {
      try { nativeAudioProcess.kill(); } catch (e) {}
      nativeAudioProcess = null;
    }

    // Configura o canal virtual Dodo_Audio de alta fidelidade 48kHz estéreo
    await setupAutomaticAudioIsolation();

    // Monitor do canal Dodo_Audio
    let monitorDevice = 'Dodo_Audio.monitor';

    const args = [
      '--format=s16le',
      '--rate=48000',
      '--channels=2',
      '--latency-msec=20',
      '-d', monitorDevice
    ];

    console.log(`[Native Audio] Iniciando parec gravando de: ${monitorDevice}`);

    let p = null;
    let toolName = 'parec';
    try {
      p = spawn('parec', args, { env: process.env });
    } catch (err) {
      try {
        toolName = 'pw-record';
        p = spawn('pw-record', ['--channels=2', '--rate=48000', '--format=s16', '-d', monitorDevice, '-'], { env: process.env });
      } catch (err2) {
        return { success: false, error: 'Nem parec nem pw-record encontrados' };
      }
    }

    p.stdout.on('data', (chunk) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('native-audio-chunk', {
          b64: chunk.toString('base64'),
          sampleRate: 48000,
          channels: 2
        });
      }
    });

    p.stderr.on('data', (errData) => {
      console.warn(`[Native Audio ${toolName} stderr]:`, errData.toString());
    });

    p.on('error', (err) => {
      console.warn(`[Native Audio] ${toolName} erro:`, err.message);
    });

    nativeAudioProcess = p;
    console.log(`[Native Audio] Captura de áudio Estéreo HD (${toolName} 48kHz 2ch, ${monitorDevice}) iniciada com sucesso!`);
    return { success: true, tool: toolName, device: monitorDevice };
  } catch (err) {
    console.warn('[Native Audio] Falha ao iniciar áudio nativo:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('stop-native-stereo-audio', async () => {
  if (nativeAudioProcess) {
    try { nativeAudioProcess.kill(); } catch (e) {}
    nativeAudioProcess = null;
  }
  await cleanupAudioIsolation();
  return true;
});

// Configuração 100% Automática de Isolamento de Áudio (Estilo Parsec/Discord no Linux)
async function setupAutomaticAudioIsolation() {
  if (process.platform !== 'linux') return;
  try {
    // 1. Detecta o dispositivo físico real do usuário (fones de ouvido)
    let physicalSink = originalDefaultSink;
    try {
      const { stdout: sinksList } = await execAsync('pactl list short sinks 2>/dev/null || true');
      const lines = sinksList.split('\n').filter(Boolean);
      for (const line of lines) {
        const parts = line.split('\t');
        const sName = parts[1] || line.split(' ')[1];
        if (sName && !sName.includes('Dodo_Audio') && !sName.includes('null')) {
          if (!physicalSink) {
            physicalSink = sName.trim();
            originalDefaultSink = physicalSink;
          }
          break;
        }
      }
    } catch (e) {}

    // 2. Limpa TODOS os módulos anteriores (null-sink e loopback) para evitar áudio duplicado
    try {
      await execAsync(`
        for mod in $(pactl list short modules 2>/dev/null | grep -E "Dodo_Audio|module-loopback.*Dodo" | awk '{print $1}'); do
          pactl unload-module $mod 2>/dev/null || true
        done
      `);
    } catch (e) {}

    // 3. Cria o canal de áudio Dodo_Audio (Forçado em Estéreo 48kHz 2 Canais L/R)
    const { stdout: sinkOut } = await execAsync('pactl load-module module-null-sink sink_name=Dodo_Audio rate=48000 channels=2 channel_map=front-left,front-right sink_properties=device.description="Dodo_Game_Audio"');
    audioModuleSinkId = sinkOut.trim();

    // 4. Cria o loopback exclusivo para os fones físicos do usuário (Zero duplicação)
    const targetSink = physicalSink || originalDefaultSink || '@DEFAULT_SINK@';
    const { stdout: loopOut } = await execAsync(`pactl load-module module-loopback source=Dodo_Audio.monitor sink="${targetSink}" rate=48000 channels=2 latency_msec=1`);
    audioModuleLoopbackId = loopOut.trim();

    // 5. Direciona os jogos/sistema para Dodo_Audio
    await execAsync('pactl set-default-sink Dodo_Audio');

    // 6. Move o Discord para os fones físicos (Zero eco da voz dos amigos)
    async function isolateDiscordAudio() {
      try {
        const { stdout: inputsOut } = await execAsync('pactl list sink-inputs');
        const blocks = inputsOut.split(/Entrada do destino #|Sink Input #/).filter(Boolean);
        for (const block of blocks) {
          const idMatch = block.match(/^(\d+)/);
          if (!idMatch) continue;
          const inputId = idMatch[1];
          const isDiscord = /application\.process\.binary\s*=\s*"Discord"|application\.name\s*=\s*"WEBRTC VoiceEngine"|application\.name\s*=\s*"Discord"/i.test(block);
          if (isDiscord) {
            const hwSink = physicalSink || originalDefaultSink || '@DEFAULT_SINK@';
            await execAsync(`pactl move-sink-input ${inputId} "${hwSink}" 2>/dev/null || true`);
          }
        }
      } catch (e) {}
    }

    await isolateDiscordAudio();

    if (isolationInterval) clearInterval(isolationInterval);
    isolationInterval = setInterval(isolateDiscordAudio, 2000);

    console.log('[Audio Isolation] Dodo_Audio criado com sucesso! Fones físicos:', targetSink);
  } catch (err) {
    console.warn('[Audio Isolation] Inicialização do canal de áudio:', err.message);
  }
}

async function cleanupAudioIsolation() {
  if (process.platform !== 'linux') return;
  try {
    if (isolationInterval) {
      clearInterval(isolationInterval);
      isolationInterval = null;
    }
    if (originalDefaultSink) {
      await execAsync(`pactl set-default-sink "${originalDefaultSink}" 2>/dev/null || true`);
    }
    await execAsync(`
      for mod in $(pactl list short modules 2>/dev/null | grep -E "Dodo_Audio|module-loopback.*Dodo" | awk '{print $1}'); do
        pactl unload-module $mod 2>/dev/null || true
      done
    `);
  } catch (e) {}
}

ipcMain.handle('ensure-audio-isolation', async () => {
  return true;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 840,
    minHeight: 600,
    backgroundColor: '#0f1117',
    title: 'Dodo Screen Share - Desktop Host',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false // Não congela FPS quando em segundo plano
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Configuração de captura de telas e janelas nativas do SO
ipcMain.handle('get-desktop-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false
    });

    return sources.map((s) => {
      return {
        id: s.id,
        name: s.name || 'Janela',
        thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : null,
        appIcon: null,
        isScreen: s.id.startsWith('screen:')
      };
    });
  } catch (err) {
    console.error('[Electron Main] Erro ao obter fontes de tela:', err);
    return [];
  }
});

let selectedSourceId = null;

ipcMain.handle('set-active-capture-source', (event, sourceId) => {
  selectedSourceId = sourceId;
  return true;
});

// Informações do sistema e versão
ipcMain.handle('get-app-info', () => {
  return {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch
  };
});

app.whenReady().then(() => {
  // Permissões completas para captura de tela e áudio loopback nativo
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'media' || permission === 'display-capture';
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });

  // Interceptador oficial do Electron para seleção de janela/tela sem diálogos
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const target = sources.find(s => s.id === selectedSourceId) || sources[0];
      if (target) {
        callback({ video: target, audio: 'loopback' });
      } else {
        callback({});
      }
    } catch (e) {
      console.error('[Electron Main] Erro no setDisplayMediaRequestHandler:', e);
      callback({});
    }
  });

  createWindow();

  // Limpa quaisquer módulos virtuais residuais para não duplicar o som do usuário
  if (process.platform === 'linux') {
    cleanupAudioIsolation().catch(() => {});
  }

  // Auto-Updater: Verifica atualizações automaticamente ao abrir e a cada 2 minutos
  setTimeout(() => { checkForUpdates(true); }, 3000);
  setInterval(() => { checkForUpdates(true); }, 120000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  await cleanupAudioIsolation();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  await cleanupAudioIsolation();
});

app.on('will-quit', async () => {
  await cleanupAudioIsolation();
});

// Captura encerramento via Ctrl + C ou fechamento do terminal
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((sig) => {
  process.on(sig, async () => {
    await cleanupAudioIsolation();
    process.exit(0);
  });
});
