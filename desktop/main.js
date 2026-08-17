import { app, BrowserWindow, ipcMain, desktopCapturer, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let audioModuleSinkId = null;
let audioModuleLoopbackId = null;
let originalDefaultSink = null;
let isolationInterval = null;

// Configuração 100% Automática de Isolamento de Áudio (Estilo Parsec/Discord no Linux)
async function setupAutomaticAudioIsolation() {
  if (process.platform !== 'linux') return;
  try {
    // 1. Salva o dispositivo físico padrão original do usuário (fones de ouvido)
    if (!originalDefaultSink) {
      try {
        const { stdout: defSinkOut } = await execAsync('pactl get-default-sink 2>/dev/null || pactl info | grep "Default Sink" | cut -d: -f2');
        const trimmed = defSinkOut.trim();
        if (trimmed && trimmed !== 'Dodo_Audio') {
          originalDefaultSink = trimmed;
        }
      } catch (e) {}
    }

    // 2. Limpa instâncias anteriores
    await execAsync('pactl unload-module $(pactl list short modules | grep "sink_name=Dodo_Audio" | awk \'{print $1}\') 2>/dev/null || true');
    await execAsync('pactl unload-module $(pactl list short modules | grep "source=Dodo_Audio.monitor" | awk \'{print $1}\') 2>/dev/null || true');

    // 3. Cria o canal de áudio Dodo_Audio
    const { stdout: sinkOut } = await execAsync('pactl load-module module-null-sink sink_name=Dodo_Audio sink_properties=device.description="Dodo_Game_Audio"');
    audioModuleSinkId = sinkOut.trim();

    // 4. Cria o loopback para os fones do usuário
    const targetSink = originalDefaultSink || '@DEFAULT_SINK@';
    const { stdout: loopOut } = await execAsync(`pactl load-module module-loopback source=Dodo_Audio.monitor sink="${targetSink}" latency_msec=1`);
    audioModuleLoopbackId = loopOut.trim();

    // 5. Direciona os jogos/sistema para Dodo_Audio
    await execAsync('pactl set-default-sink Dodo_Audio');

    // 6. Move imediatamente e continuamente o Discord para os fones físicos (Zero eco na live)
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
            const hwSink = originalDefaultSink || '@DEFAULT_SINK@';
            await execAsync(`pactl move-sink-input ${inputId} "${hwSink}" 2>/dev/null || true`);
          }
        }
      } catch (e) {}
    }

    await isolateDiscordAudio();

    if (isolationInterval) clearInterval(isolationInterval);
    isolationInterval = setInterval(isolateDiscordAudio, 2000);

    console.log('[Audio Isolation] Isolamento ativo! Jogos -> Dodo_Audio | Discord -> Fones físicos.');
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
    if (audioModuleLoopbackId) await execAsync(`pactl unload-module ${audioModuleLoopbackId} 2>/dev/null || true`);
    if (audioModuleSinkId) await execAsync(`pactl unload-module ${audioModuleSinkId} 2>/dev/null || true`);
  } catch (e) {}
}

ipcMain.handle('ensure-audio-isolation', async () => {
  if (process.platform === 'linux') {
    await setupAutomaticAudioIsolation();
  }
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
  setupAutomaticAudioIsolation();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  await cleanupAudioIsolation();
});
