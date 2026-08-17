import { app, BrowserWindow, ipcMain, desktopCapturer, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;

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
