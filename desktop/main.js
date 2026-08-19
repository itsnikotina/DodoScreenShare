import { app, BrowserWindow, ipcMain, desktopCapturer, session, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
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

// Autenticação Oficial Discord via Navegador Padrão + Callback Local
let authServer = null;

ipcMain.handle('login-with-discord', async () => {
  return new Promise((resolve) => {
    if (authServer) {
      try { authServer.close(); } catch (e) {}
      authServer = null;
    }

    const port = 48291;
    const CLIENT_ID = '787371101177118750';
    const REDIRECT_URI = 'https://dodoscreenshare.itsnikotina.deno.net/';

    authServer = http.createServer(async (req, res) => {
      try {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const parsedUrl = new URL(req.url, `http://127.0.0.1:${port}`);
        
        if (parsedUrl.pathname === '/callback') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
              <meta charset="utf-8">
              <title>Dodo Screen Share - Login Concluído</title>
              <style>
                * { box-sizing: border-box; }
                body { background-color: #0b0e14; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .card { background: #151922; border: 1px solid rgba(88, 101, 242, 0.4); border-radius: 16px; padding: 40px 32px; text-align: center; max-width: 420px; box-shadow: 0 16px 36px rgba(0,0,0,0.6); }
                .icon { width: 64px; height: 64px; background: rgba(88, 101, 242, 0.15); border: 2px solid #5865f2; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 32px; }
                h2 { margin: 0 0 10px; font-size: 22px; color: #fff; }
                p { color: #8a93a5; font-size: 14px; line-height: 1.5; margin: 0 0 20px; }
                .badge { background: #232836; padding: 8px 14px; border-radius: 8px; font-size: 13px; color: #5865f2; font-weight: 600; display: inline-block; }
              </style>
            </head>
            <body>
              <div class="card">
                <div class="icon">🎮</div>
                <h2>Login Concluído com Sucesso!</h2>
                <p>Sua conta do Discord foi autenticada no <strong>Dodo Screen Share</strong>.</p>
                <div class="badge" id="statusBadge">Sincronizando com o aplicativo...</div>
              </div>
              <script>
                const hash = window.location.hash.substring(1);
                const params = new URLSearchParams(hash);
                const token = params.get('access_token');
                if (token) {
                  fetch('/save-token?token=' + token)
                    .then(() => {
                      document.getElementById('statusBadge').textContent = '✅ Conectado! Pode fechar esta aba.';
                      setTimeout(() => window.close(), 2000);
                    })
                    .catch(() => {
                      document.getElementById('statusBadge').textContent = 'Erro ao sincronizar token.';
                    });
                } else {
                  document.getElementById('statusBadge').textContent = 'Token não encontrado.';
                }
              </script>
            </body>
            </html>
          `);
        } else if (parsedUrl.pathname === '/save-token') {
          const accessToken = parsedUrl.searchParams.get('token');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));

          if (authServer) {
            try { authServer.close(); } catch (e) {}
            authServer = null;
          }

          if (accessToken) {
            try {
              const userRes = await fetch('https://discord.com/api/v10/users/@me', {
                headers: { Authorization: `Bearer ${accessToken}` }
              });
              const userData = await userRes.json();
              let avatarUrl = 'https://cdn.discordapp.com/embed/avatars/0.png';
              if (userData.avatar) {
                avatarUrl = `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png?size=128`;
              }
              resolve({
                success: true,
                accessToken,
                user: {
                  id: userData.id,
                  username: userData.global_name || userData.username,
                  discriminator: userData.discriminator,
                  avatarUrl
                }
              });
            } catch (err) {
              resolve({ success: false, error: `Falha ao obter perfil: ${err.message}` });
            }
          }
        }
      } catch (_) {}
    });

    authServer.listen(port, '127.0.0.1', () => {
      const authUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&response_type=token&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=identify%20guilds%20voice`;
      shell.openExternal(authUrl);
    });

    authServer.on('error', (err) => {
      resolve({ success: false, error: `Erro no servidor local de autenticação: ${err.message}` });
    });
  });
});

// Captura Direta de Áudio Nativo em Estéreo 48kHz (L/R) via PulseAudio/PipeWire (parec)
ipcMain.handle('start-native-stereo-audio', async () => {
  if (process.platform !== 'linux') return { success: false, error: 'Não é Linux' };

  try {
    if (nativeAudioProcess) {
      try { nativeAudioProcess.kill('SIGKILL'); } catch (e) {}
      nativeAudioProcess = null;
    }
    // Garante que nenhum processo parec anterior ficou órfão em segundo plano
    await execAsync('pkill -9 -f parec 2>/dev/null || true; pkill -9 -f pw-record 2>/dev/null || true').catch(() => {});

    // Descobre o sink padrão atual do sistema
    let monitorDevice = null;
    try {
      const { stdout: sinkOut } = await execAsync('pactl get-default-sink 2>/dev/null || pactl info | grep "Default Sink" | cut -d: -f2');
      const defSink = sinkOut.trim();
      if (defSink) {
        monitorDevice = `${defSink}.monitor`;
      }
    } catch (e) {}

    const args = [
      '--format=s16le',
      '--rate=48000',
      '--channels=2',
      '--latency-msec=20'
    ];
    if (monitorDevice) {
      args.push('-d', monitorDevice);
    }

    console.log(`[Native Audio] Iniciando parec único com dispositivo: ${monitorDevice || 'Padrão'}`);

    let p = null;
    let toolName = 'parec';
    try {
      p = spawn('parec', args, { env: process.env });
    } catch (err) {
      try {
        toolName = 'pw-record';
        p = spawn('pw-record', ['--channels=2', '--rate=48000', '--format=s16', '-'], { env: process.env });
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
    console.log(`[Native Audio] Captura de áudio Estéreo HD (${toolName} 48kHz 2ch, ${monitorDevice || 'Padrão'}) iniciada com sucesso!`);
    return { success: true, tool: toolName, device: monitorDevice || 'default' };
  } catch (err) {
    console.warn('[Native Audio] Falha ao iniciar áudio nativo:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('stop-native-stereo-audio', async () => {
  if (nativeAudioProcess) {
    try { nativeAudioProcess.kill('SIGKILL'); } catch (e) {}
    nativeAudioProcess = null;
  }
  await execAsync('pkill -9 -f parec 2>/dev/null || true; pkill -9 -f pw-record 2>/dev/null || true').catch(() => {});
  return true;
});

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

    // 3. Cria o canal de áudio Dodo_Audio (Forçado em Estéreo 48kHz 2 Canais L/R)
    const { stdout: sinkOut } = await execAsync('pactl load-module module-null-sink sink_name=Dodo_Audio rate=48000 channels=2 channel_map=front-left,front-right sink_properties=device.description="Dodo_Game_Audio"');
    audioModuleSinkId = sinkOut.trim();

    // 4. Cria o loopback para os fones do usuário em Estéreo
    const targetSink = originalDefaultSink || '@DEFAULT_SINK@';
    const { stdout: loopOut } = await execAsync(`pactl load-module module-loopback source=Dodo_Audio.monitor sink="${targetSink}" rate=48000 channels=2 latency_msec=1`);
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

  // Auto-Updater: Verifica atualizações automaticamente ao abrir e a cada 2 minutos
  setTimeout(() => { checkForUpdates(true); }, 3000);
  setInterval(() => { checkForUpdates(true); }, 120000);

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
