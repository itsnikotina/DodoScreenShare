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

// Configuração 100% Automática de Isolamento de Áudio (Estilo Parsec/Discord no Linux)
async function setupAutomaticAudioIsolation() {
  if (process.platform !== 'linux') return;
  try {
    await execAsync('pactl unload-module $(pactl list short modules | grep "sink_name=Dodo_Audio" | awk \'{print $1}\') 2>/dev/null || true');
    await execAsync('pactl unload-module $(pactl list short modules | grep "source=Dodo_Audio.monitor" | awk \'{print $1}\') 2>/dev/null || true');

    const { stdout: sinkOut } = await execAsync('pactl load-module module-null-sink sink_name=Dodo_Audio sink_properties=device.description="Dodo_Game_Audio"');
    audioModuleSinkId = sinkOut.trim();

    const { stdout: loopOut } = await execAsync('pactl load-module module-loopback source=Dodo_Audio.monitor sink=@DEFAULT_SINK@ latency_msec=1');
    audioModuleLoopbackId = loopOut.trim();

    console.log('[Audio Isolation] Canal virtual Dodo_Audio inicializado com sucesso!');
  } catch (err) {
    console.warn('[Audio Isolation] Inicialização do canal de áudio:', err.message);
  }
}

async function cleanupAudioIsolation() {
  if (process.platform !== 'linux') return;
  try {
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
