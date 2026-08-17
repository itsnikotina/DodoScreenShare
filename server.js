import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carregar variáveis de ambiente de .env se existir
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...values] = trimmed.split('=');
      if (key && values.length > 0) {
        process.env[key.trim()] = values.join('=').trim();
      }
    }
  });
}

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({
  server,
  maxPayload: 16 * 1024 * 1024 // 16MB
});

const PORT = process.env.PORT || 3000;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '787371101177118750';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';

// Servir arquivos estáticos da pasta /public
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0
}));
app.use(express.json());

// Headers de segurança e CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Rotas de Termos de Serviço e Privacidade
app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

function getPublicServerUrl(req) {
  if (process.env.PUBLIC_URL) {
    const u = process.env.PUBLIC_URL.trim();
    return u.endsWith('/') ? u : `${u}/`;
  }
  if (process.env.RENDER_EXTERNAL_URL) {
    const u = process.env.RENDER_EXTERNAL_URL.trim();
    return u.endsWith('/') ? u : `${u}/`;
  }
  const host = req ? (req.headers['x-forwarded-host'] || req.headers.host || '') : '';
  const proto = req ? (req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')) : 'https';
  
  if (host && !host.includes('discordsays.com') && !host.includes('discord.com')) {
    return `${proto}://${host}/`;
  }
  return 'https://dodoscreenshare.onrender.com/';
}

// Rota de Configuração Dinâmica para Clientes Web / Discord Activity
app.get('/api/config', (req, res) => {
  res.json({
    publicUrl: getPublicServerUrl(req)
  });
});

function getDiscordRedirectUri(req) {
  const baseUrl = getPublicServerUrl(req).replace(/\/+$/, '');
  return `${baseUrl}/api/auth/discord/callback`;
}

// ==========================================
// Rotas de Discord OAuth2
// ==========================================
app.get('/api/auth/discord/login', (req, res) => {
  if (!DISCORD_CLIENT_ID) {
    return res.status(500).send('DISCORD_CLIENT_ID não configurado no servidor.');
  }

  const redirectUri = getDiscordRedirectUri(req);
  console.log(`[Discord OAuth Debug] Iniciando login com client_id: ${DISCORD_CLIENT_ID} | redirect_uri: ${redirectUri}`);

  const authUrl = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=identify`;
  res.redirect(authUrl);
});

app.get('/api/auth/discord/callback', async (req, res) => {
  const { code, error, error_description } = req.query;

  if (error) {
    console.error(`[Discord OAuth Debug] Erro retornado pelo Discord: ${error} - ${error_description}`);
    return res.redirect(`/?auth_error=${encodeURIComponent(`discord_${error}: ${error_description || ''}`)}`);
  }

  if (!code) {
    console.error('[Discord OAuth Debug] Nenhum code recebido no callback');
    return res.redirect('/?auth_error=no_code_provided');
  }

  if (!DISCORD_CLIENT_SECRET) {
    console.error('[Discord OAuth Debug] DISCORD_CLIENT_SECRET não configurado!');
    return res.redirect('/?auth_error=missing_client_secret_on_server');
  }

  try {
    const redirectUri = getDiscordRedirectUri(req);
    console.log(`[Discord OAuth Debug] Trocando code com redirect_uri: ${redirectUri} | client_id: ${DISCORD_CLIENT_ID}`);

    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri
    });

    const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'DiscordBot (https://github.com/itsnikotina/DodoScreenShare, 1.0.0)'
      },
      body: params.toString()
    });

    const tokenText = await tokenResponse.text();
    console.log(`[Discord OAuth Debug] Token HTTP Status: ${tokenResponse.status} | Resposta: ${tokenText.slice(0, 300)}`);

    let tokenData;
    try {
      tokenData = JSON.parse(tokenText);
    } catch (e) {
      console.error('[Discord OAuth Debug] Resposta não-JSON ao obter token:', tokenText);
      return res.redirect(`/?auth_error=${encodeURIComponent(`non_json_status_${tokenResponse.status}: ${tokenText.slice(0, 60)}`)}`);
    }

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error('[Discord OAuth Debug] Erro retornado ao obter token:', tokenData);
      const errMsg = tokenData.error_description || tokenData.error || `http_error_${tokenResponse.status}`;
      return res.redirect(`/?auth_error=${encodeURIComponent(errMsg)}`);
    }

    const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Accept': 'application/json',
        'User-Agent': 'DiscordBot (https://github.com/itsnikotina/DodoScreenShare, 1.0.0)'
      }
    });

    const userText = await userResponse.text();
    console.log(`[Discord OAuth Debug] User HTTP Status: ${userResponse.status} | Resposta: ${userText.slice(0, 300)}`);

    let userData;
    try {
      userData = JSON.parse(userText);
    } catch (e) {
      console.error('[Discord OAuth Debug] Erro ao decodificar perfil:', userText);
      return res.redirect('/?auth_error=user_fetch_failed');
    }

    if (!userResponse.ok) {
      console.error('[Discord OAuth Debug] Erro ao obter perfil:', userData);
      return res.redirect('/?auth_error=user_fetch_failed');
    }

    let avatarUrl = 'https://cdn.discordapp.com/embed/avatars/0.png';
    if (userData.avatar) {
      avatarUrl = `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png?size=128`;
    }

    const profile = {
      id: userData.id,
      username: userData.global_name || userData.username,
      avatarUrl: avatarUrl
    };

    console.log(`[Discord OAuth Debug] Login concluído com sucesso: ${profile.username} (${profile.id})`);
    res.redirect(`/?discord_user=${encodeURIComponent(JSON.stringify(profile))}`);
  } catch (err) {
    console.error('[Discord OAuth Debug] Exceção interna no callback:', err);
    res.redirect(`/?auth_error=${encodeURIComponent(err.message)}`);
  }
});

// Endpoint para troca de token do Embedded App SDK (Rich Presence)
app.post('/api/token', async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'Code is required' });
  }

  if (!DISCORD_CLIENT_SECRET) {
    return res.status(500).json({ error: 'DISCORD_CLIENT_SECRET missing' });
  }

  try {
    const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'DiscordBot (https://github.com/itsnikotina/DodoScreenShare, 1.0.0)'
      },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code
      }).toString()
    });

    const data = await tokenResponse.json();
    if (!tokenResponse.ok) {
      console.error('[Discord SDK Token] Erro na troca de token:', data);
      return res.status(tokenResponse.status).json(data);
    }

    res.json({ access_token: data.access_token });
  } catch (err) {
    console.error('[Discord SDK Token] Exceção:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint de diagnóstico do servidor
app.get('/api/status', (req, res) => {
  const roomsSummary = {};
  for (const [roomId, room] of rooms.entries()) {
    const activeStreams = [];
    room.hosts.forEach((h, hId) => {
      activeStreams.push({
        hostId: hId,
        username: h.profile?.username || 'Anônimo',
        viewersCount: h.viewers.size
      });
    });

    roomsSummary[roomId] = {
      totalParticipants: room.participants.size,
      activeStreams: activeStreams
    };
  }

  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    totalRooms: rooms.size,
    rooms: roomsSummary
  });
});

/**
 * Estrutura de Salas Multi-Host:
 * rooms = Map<roomId, {
 *   hosts: Map<hostId, {
 *     ws: WebSocket,
 *     id: string,
 *     profile: { id, username, avatarUrl },
 *     viewers: Set<viewerId>
 *   }>,
 *   participants: Map<peerId, {
 *     ws: WebSocket,
 *     id: string,
 *     platform: 'discord' | 'web',
 *     profile: { id, username, avatarUrl } | null,
 *     watchingHostId: string | null
 *   }>
 * }>
 */
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      hosts: new Map(),
      participants: new Map()
    });
    console.log(`[Sala Criada] Canal/Sala: ${roomId}`);
  }
  return rooms.get(roomId);
}

function cleanEmptyRoom(roomId) {
  const room = rooms.get(roomId);
  if (room && room.participants.size === 0 && room.hosts.size === 0) {
    rooms.delete(roomId);
    console.log(`[Sala Removida] Canal/Sala vazia: ${roomId}`);
  }
}

// Retorna lista com todas as transmissões ativas no servidor
function getStreamsList(room) {
  const list = [];
  const seenHostIds = new Set();

  if (room && room.hosts) {
    room.hosts.forEach((host, hostId) => {
      seenHostIds.add(hostId);
      list.push({
        hostId: hostId,
        profile: host.profile || { username: 'Host ' + hostId, avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png' },
        viewersCount: host.viewers.size
      });
    });
  }

  rooms.forEach((otherRoom) => {
    otherRoom.hosts.forEach((host, hostId) => {
      if (!seenHostIds.has(hostId)) {
        seenHostIds.add(hostId);
        list.push({
          hostId: hostId,
          profile: host.profile || { username: 'Host ' + hostId, avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png' },
          viewersCount: host.viewers.size
        });
      }
    });
  });

  return list;
}

// Retorna lista de todos os participantes conectados na chamada (sem duplicatas genéricas)
function getParticipantsList(room) {
  const list = [];
  const seenUsernames = new Set();
  const seenIds = new Set();

  // 1. Membros reais da chamada vindos do Discord Voice SDK
  rooms.forEach((r) => {
    if (r.voiceParticipants && Array.isArray(r.voiceParticipants)) {
      r.voiceParticipants.forEach((vp) => {
        if (vp.profile && vp.profile.username) {
          const lowerName = vp.profile.username.toLowerCase();
          if (!seenUsernames.has(lowerName)) {
            seenUsernames.add(lowerName);
            seenIds.add(vp.id);
            list.push(vp);
          }
        }
      });
    }
  });

  // 2. Participantes conectados via Web / OAuth2 com perfil conhecido
  rooms.forEach((r) => {
    r.participants.forEach((p, pId) => {
      if (p.profile && p.profile.username) {
        const lowerName = p.profile.username.toLowerCase();
        if (!seenUsernames.has(lowerName) && !seenIds.has(pId)) {
          seenUsernames.add(lowerName);
          seenIds.add(pId);
          list.push({
            id: pId,
            platform: p.platform || 'web',
            profile: p.profile,
            isStreaming: r.hosts.has(pId),
            watchingHostId: p.watchingHostId
          });
        }
      }
    });
  });

  return list;
}

// Notifica TODOS os participantes sobre transmissões e membros da chamada
function broadcastStreamsList() {
  rooms.forEach((r) => {
    const streams = getStreamsList(r);
    const participants = getParticipantsList(r);
    const payload = JSON.stringify({
      type: 'streams-updated',
      streams: streams,
      participants: participants
    });

    r.participants.forEach((p) => {
      if (p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(payload);
      }
    });
  });
}

// Notifica o Host com contagem separada de espectadores do Discord e do Navegador
function notifyHostViewers(room, hostId) {
  let hostWs = null;
  const viewersList = [];
  let discordCount = 0;
  let webCount = 0;

  rooms.forEach((r) => {
    if (r.hosts.has(hostId)) {
      hostWs = r.hosts.get(hostId).ws;
    }
    r.participants.forEach((p, pId) => {
      if (p.watchingHostId === hostId) {
        const isDiscord = p.platform === 'discord';
        if (isDiscord) discordCount++;
        else webCount++;

        viewersList.push({
          id: pId,
          platform: p.platform || 'web',
          profile: p.profile || { username: isDiscord ? 'Espectador no Discord' : 'Espectador Web', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png' }
        });
      }
    });
  });

  if (hostWs && hostWs.readyState === WebSocket.OPEN) {
    hostWs.send(JSON.stringify({
      type: 'stream-viewers-updated',
      hostId: hostId,
      viewers: viewersList,
      total: viewersList.length,
      discordCount: discordCount,
      webCount: webCount
    }));
  }
}

// Sincronização periódica de streams (3s) para garantir atualização contínua em segundo plano
setInterval(() => {
  if (rooms.size > 0) {
    broadcastStreamsList();
  }
}, 3000);

wss.on('connection', (ws, req) => {
  const peerId = crypto.randomUUID().slice(0, 8);
  ws.peerId = peerId;
  ws.roomId = null;

  console.log(`[WebSocket] Cliente conectado: ID ${peerId} (${req.socket.remoteAddress})`);

  ws.send(JSON.stringify({
    type: 'connected',
    peerId: peerId,
    publicUrl: getPublicServerUrl(req)
  }));

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (err) {
      console.error(`[WebSocket] Mensagem JSON inválida de ${peerId}:`, err);
      return;
    }

    const { type, roomId, profile, platform, hostId, targetId, sdp, candidate, frame, audio, message: logMsg, category: logCat } = data;

    switch (type) {
      case 'client-log': {
        console.log(`[Client Log ${peerId} | ${logCat || 'info'}] ${logMsg}`);
        break;
      }

      // 1. Entrar no Canal / Sala de Voz
      case 'join-room': {
        let targetRoomId = roomId || 'call-geral';
        ws.roomId = targetRoomId;
        ws.platform = platform || 'web';

        const room = getOrCreateRoom(targetRoomId);
        room.participants.set(peerId, {
          ws,
          id: peerId,
          platform: platform || 'web',
          profile: profile || null,
          watchingHostId: null
        });

        console.log(`[Sala ${targetRoomId}] Participante ${peerId} [${platform || 'web'}] (${profile?.username || 'Anônimo'}) conectado.`);

        // Envia confirmação e a lista atual de transmissões e participantes
        const allStreams = getStreamsList(room);
        const allParticipants = getParticipantsList(room);
        ws.send(JSON.stringify({
          type: 'room-joined',
          roomId: targetRoomId,
          peerId,
          streams: allStreams,
          participants: allParticipants
        }));

        // Notifica todos para sincronização instantânea
        broadcastStreamsList();
        break;
      }

      // Sincronização de todos os membros presentes na chamada do Discord
      case 'voice-participants-sync': {
        if (!ws.roomId) return;
        const room = rooms.get(ws.roomId);
        if (!room) return;
        room.voiceParticipants = data.participants || [];
        console.log(`[Sala ${ws.roomId}] 👥 Sincronizados ${room.voiceParticipants.length} membros reais do canal de voz.`);
        broadcastStreamsList();
        break;
      }

      // 2. Iniciar Transmissão de Tela (Host)
      case 'start-stream': {
        if (!ws.roomId) return;
        const room = rooms.get(ws.roomId);
        if (!room) return;

        const hostProfile = profile || { username: 'Host ' + peerId, avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png' };

        room.hosts.set(peerId, {
          ws,
          id: peerId,
          profile: hostProfile,
          viewers: new Set()
        });

        if (room.participants.has(peerId)) {
          room.participants.get(peerId).profile = hostProfile;
        }

        console.log(`[Sala ${ws.roomId}] 🖥️ Novo Stream Iniciado por ${hostProfile.username} (${peerId})`);

        ws.send(JSON.stringify({
          type: 'stream-started',
          hostId: peerId
        }));

        // Notifica todos na chamada na hora!
        broadcastStreamsList();
        break;
      }

      // 3. Parar Transmissão de Tela (Host)
      case 'stop-stream': {
        if (!ws.roomId) return;
        const room = rooms.get(ws.roomId);
        if (!room) return;

        if (room.hosts.has(peerId)) {
          const host = room.hosts.get(peerId);
          console.log(`[Sala ${ws.roomId}] ⏹️ Transmissão de ${host.profile?.username || peerId} encerrada.`);

          rooms.forEach((r) => {
            r.participants.forEach((p) => {
              if (p.watchingHostId === peerId && p.ws.readyState === WebSocket.OPEN) {
                p.ws.send(JSON.stringify({
                  type: 'watched-stream-ended',
                  hostId: peerId
                }));
                p.watchingHostId = null;
              }
            });
          });

          room.hosts.delete(peerId);
          broadcastStreamsList();
        }
        break;
      }

      // 4. Selecionar qual tela assistir (Viewer)
      case 'watch-stream': {
        let targetHost = null;
        for (const [rId, rObj] of rooms.entries()) {
          if (rObj.hosts.has(hostId)) {
            targetHost = rObj.hosts.get(hostId);
            break;
          }
        }

        let participant = null;
        for (const [rId, rObj] of rooms.entries()) {
          if (rObj.participants.has(peerId)) {
            participant = rObj.participants.get(peerId);
            break;
          }
        }

        if (participant && targetHost) {
          rooms.forEach((r) => {
            r.hosts.forEach((h) => h.viewers.delete(peerId));
          });

          participant.watchingHostId = hostId;
          targetHost.viewers.add(peerId);

          console.log(`[Watch] 👁️ ${participant.profile?.username || peerId} [${participant.platform}] assistindo ${targetHost.profile?.username || hostId}`);

          ws.send(JSON.stringify({
            type: 'watching-stream-confirmed',
            hostId: hostId,
            profile: targetHost.profile
          }));

          notifyHostViewers(null, hostId);

          if (targetHost.ws.readyState === WebSocket.OPEN) {
            targetHost.ws.send(JSON.stringify({
              type: 'new-viewer',
              viewerId: peerId,
              platform: participant.platform
            }));
          }
        }
        break;
      }

      // 5. Parar de Assistir um Stream (Viewer)
      case 'unwatch-stream': {
        rooms.forEach((r) => {
          if (r.participants.has(peerId)) {
            const p = r.participants.get(peerId);
            if (p.watchingHostId) {
              const prev = p.watchingHostId;
              p.watchingHostId = null;
              notifyHostViewers(null, prev);
            }
          }
          r.hosts.forEach((h) => h.viewers.delete(peerId));
        });
        break;
      }

      // 6. Encaminhamento de Quadros de Vídeo (Para todos os espectadores inscritos neste Host)
      case 'stream-frame': {
        const payload = JSON.stringify({
          type: 'stream-frame',
          hostId: peerId,
          frame: frame
        });

        rooms.forEach((r) => {
          r.participants.forEach((p) => {
            if (p.watchingHostId === peerId && p.ws.readyState === WebSocket.OPEN) {
              p.ws.send(payload);
            }
          });
        });
        break;
      }

      // 7. Encaminhamento de Áudio PCM (Para todos os espectadores inscritos neste Host)
      case 'stream-audio': {
        const payload = JSON.stringify({
          type: 'stream-audio',
          hostId: peerId,
          audio: audio
        });

        rooms.forEach((r) => {
          r.participants.forEach((p) => {
            if (p.watchingHostId === peerId && p.ws.readyState === WebSocket.OPEN) {
              p.ws.send(payload);
            }
          });
        });
        break;
      }

      // 8. Sinalização WebRTC (Offer, Answer, ICE)
      case 'offer': {
        if (!targetId) return;
        rooms.forEach((r) => {
          const target = r.participants.get(targetId);
          if (target && target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(JSON.stringify({
              type: 'offer',
              from: peerId,
              sdp
            }));
          }
        });
        break;
      }

      case 'answer': {
        if (!targetId) return;
        rooms.forEach((r) => {
          const target = r.hosts.get(targetId) || r.participants.get(targetId);
          if (target && target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(JSON.stringify({
              type: 'answer',
              from: peerId,
              sdp
            }));
          }
        });
        break;
      }

      case 'ice-candidate': {
        if (!targetId) return;
        rooms.forEach((r) => {
          const target = r.participants.get(targetId) || r.hosts.get(targetId);
          if (target && target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(JSON.stringify({
              type: 'ice-candidate',
              from: peerId,
              candidate
            }));
          }
        });
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log(`[WebSocket] Desconectado: ID ${peerId}`);
    rooms.forEach((r, rId) => {
      if (r.hosts.has(peerId)) {
        const host = r.hosts.get(peerId);
        console.log(`[Sala ${rId}] ⏹️ Host ${host?.profile?.username || peerId} desconectou. Encerrando transmissão.`);

        // Notifica todos que estavam assistindo esse host que a live encerrou
        rooms.forEach((allRoom) => {
          allRoom.participants.forEach((p) => {
            if (p.watchingHostId === peerId && p.ws.readyState === WebSocket.OPEN) {
              p.ws.send(JSON.stringify({
                type: 'watched-stream-ended',
                hostId: peerId
              }));
              p.watchingHostId = null;
            }
          });
        });

        r.hosts.delete(peerId);
      }

      if (r.participants.has(peerId)) {
        const p = r.participants.get(peerId);
        if (p.watchingHostId) {
          notifyHostViewers(null, p.watchingHostId);
        }
        r.participants.delete(peerId);
      }
    });

    // Calcula total de usuários no Discord ativos em todas as salas
    let totalDiscordParticipants = 0;
    rooms.forEach((r) => {
      r.participants.forEach((p) => {
        if (p.platform === 'discord' && p.ws.readyState === WebSocket.OPEN) {
          totalDiscordParticipants++;
        }
      });
    });

    // Se NÃO SOBROU NENHUM usuário no Discord ativo no servidor, encerra todas as transmissões
    if (totalDiscordParticipants === 0) {
      console.log('🚪 Nenhum usuário no Discord ativo no servidor. Encerrando transmissões ativas.');
      rooms.forEach((r) => {
        r.hosts.forEach((h) => {
          if (h.ws && h.ws.readyState === WebSocket.OPEN) {
            h.ws.send(JSON.stringify({
              type: 'call-empty-stop-stream',
              message: 'Todos os participantes saíram da chamada do Discord.'
            }));
          }
        });
        r.hosts.clear();
      });
    }

    broadcastStreamsList();
    if (ws.roomId) cleanEmptyRoom(ws.roomId);
  });

  ws.on('error', (err) => {
    console.error(`[WebSocket] Erro na conexão com ${peerId}:`, err);
  });
});

server.listen(PORT, () => {
  console.log(`
=====================================================
🚀 Servidor Multi-Stream Discord Activity PoC Rodando!
📡 Porta HTTP & WebSocket: http://localhost:${PORT}
🔑 Discord Client ID: ${DISCORD_CLIENT_ID}
📁 Arquivos servidos da pasta: /public
=====================================================
  `);
});
