import { serveDir } from 'jsr:@std/http/file-server';

const DISCORD_CLIENT_ID = Deno.env.get('DISCORD_CLIENT_ID') || '787371101177118750';
const DISCORD_CLIENT_SECRET = Deno.env.get('DISCORD_CLIENT_SECRET') || '';

interface Participant {
  socket: WebSocket;
  id: string;
  platform: string;
  profile: any;
  watchingHostId: string | null;
}

interface Host {
  socket: WebSocket;
  id: string;
  profile: any;
  viewers: Set<string>;
}

interface Room {
  id: string;
  hosts: Map<string, Host>;
  participants: Map<string, Participant>;
  voiceParticipants?: any[];
}

const rooms = new Map<string, Room>();

function getOrCreateRoom(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      hosts: new Map(),
      participants: new Map(),
      voiceParticipants: []
    };
    rooms.set(roomId, room);
  }
  return room;
}

function cleanEmptyRoom(roomId: string) {
  const room = rooms.get(roomId);
  if (room && room.participants.size === 0 && room.hosts.size === 0) {
    rooms.delete(roomId);
  }
}

function getStreamsList(room: Room | null = null) {
  const list: any[] = [];
  const seen = new Set<string>();

  rooms.forEach((r) => {
    r.hosts.forEach((host, hostId) => {
      if (!seen.has(hostId)) {
        seen.add(hostId);
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

function getParticipantsList(room: Room) {
  const list: any[] = [];
  if (!room) return list;

  const seenUsernames = new Set<string>();
  const seenIds = new Set<string>();

  if (room.voiceParticipants && Array.isArray(room.voiceParticipants)) {
    room.voiceParticipants.forEach((vp) => {
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

  if (room.participants) {
    room.participants.forEach((p, pId) => {
      if (p.profile && p.profile.username) {
        const lowerName = p.profile.username.toLowerCase();
        if (!seenUsernames.has(lowerName) && !seenIds.has(pId)) {
          seenUsernames.add(lowerName);
          seenIds.add(pId);
          list.push({
            id: pId,
            platform: p.platform || 'web',
            profile: p.profile,
            isStreaming: room.hosts.has(pId),
            watchingHostId: p.watchingHostId
          });
        }
      }
    });
  }

  return list;
}

function broadcastToSingleRoom(r: Room) {
  const streams = getStreamsList(r);
  const participants = getParticipantsList(r);
  const payload = JSON.stringify({
    type: 'streams-updated',
    roomId: r.id,
    streams: streams,
    participants: participants
  });

  r.participants.forEach((p) => {
    if (p.socket.readyState === WebSocket.OPEN) {
      try { p.socket.send(payload); } catch (_) {}
    }
  });
}

function broadcastStreamsList(specificRoomId: string | null = null) {
  if (specificRoomId) {
    const r = rooms.get(specificRoomId);
    if (r) broadcastToSingleRoom(r);
    return;
  }
  rooms.forEach((r) => {
    broadcastToSingleRoom(r);
  });
}

function findSocketById(id: string): WebSocket | null {
  for (const r of rooms.values()) {
    if (r.hosts.has(id)) return r.hosts.get(id)!.socket;
    if (r.participants.has(id)) return r.participants.get(id)!.socket;
  }
  return null;
}

function notifyHostViewers(hostId: string) {
  let hostSocket: WebSocket | null = null;
  const viewersList: any[] = [];
  let discordCount = 0;
  let webCount = 0;

  rooms.forEach((r) => {
    if (r.hosts.has(hostId)) {
      hostSocket = r.hosts.get(hostId)!.socket;
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

  if (hostSocket && (hostSocket as WebSocket).readyState === WebSocket.OPEN) {
    try {
      (hostSocket as WebSocket).send(JSON.stringify({
        type: 'stream-viewers-updated',
        hostId: hostId,
        viewers: viewersList,
        total: viewersList.length,
        discordCount: discordCount,
        webCount: webCount
      }));
    } catch (_) {}
  }
}

// Sincronização periódica contínua a cada 2.5s para garantir atualização instantânea
setInterval(() => {
  if (rooms.size > 0) {
    broadcastStreamsList();
  }
}, 2500);

// Handler Principal HTTP & WebSocket do Deno
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // Headers de Segurança e Frame Embedding para Discord Activities
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Headers', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Content-Security-Policy', "frame-ancestors 'self' https://*.discord.com https://*.discordsays.com https://discord.com;");
  headers.set('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // 1. Upgrade WebSocket
  const isWs = req.headers.get('upgrade')?.toLowerCase().includes('websocket') || req.headers.has('sec-websocket-key');
  if (isWs) {
    const { socket, response } = Deno.upgradeWebSocket(req);
    const peerId = crypto.randomUUID().slice(0, 8);
    let currentRoomId: string | null = null;

    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: 'connected',
        peerId: peerId,
        publicUrl: `${url.origin}/`
      }));
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const { type, roomId, profile, platform, hostId, targetId, sdp, candidate, frame, audio } = data;

        switch (type) {
          case 'join-room': {
            const targetRoomId = roomId || 'call-geral';
            currentRoomId = targetRoomId;

            const room = getOrCreateRoom(targetRoomId);
            room.participants.set(peerId, {
              socket,
              id: peerId,
              platform: platform || 'web',
              profile: profile || null,
              watchingHostId: null
            });

            socket.send(JSON.stringify({
              type: 'room-joined',
              roomId: targetRoomId,
              peerId,
              streams: getStreamsList(room),
              participants: getParticipantsList(room)
            }));

            broadcastStreamsList();
            break;
          }

          case 'voice-participants-sync': {
            if (!currentRoomId) return;
            const room = rooms.get(currentRoomId);
            if (!room) return;
            room.voiceParticipants = data.participants || [];
            broadcastStreamsList();
            break;
          }

          case 'start-stream': {
            if (!currentRoomId) return;
            const room = rooms.get(currentRoomId);
            if (!room) return;

            const hostProfile = profile || { username: 'Host ' + peerId, avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png' };
            room.hosts.set(peerId, {
              socket,
              id: peerId,
              profile: hostProfile,
              viewers: new Set()
            });

            if (room.participants.has(peerId)) {
              room.participants.get(peerId)!.profile = hostProfile;
            }

            socket.send(JSON.stringify({
              type: 'stream-started',
              hostId: peerId
            }));

            broadcastStreamsList();
            break;
          }

          case 'stop-stream': {
            if (!currentRoomId) return;
            const room = rooms.get(currentRoomId);
            if (!room) return;

            if (room.hosts.has(peerId)) {
              room.hosts.delete(peerId);
              room.participants.forEach((p) => {
                if (p.watchingHostId === peerId) {
                  p.watchingHostId = null;
                  if (p.socket.readyState === WebSocket.OPEN) {
                    p.socket.send(JSON.stringify({
                      type: 'host-stopped-stream',
                      hostId: peerId
                    }));
                  }
                }
              });
              broadcastStreamsList();
            }
            break;
          }

          case 'watch-stream': {
            if (!hostId) return;
            for (const r of rooms.values()) {
              if (r.hosts.has(hostId)) {
                const host = r.hosts.get(hostId)!;
                host.viewers.add(peerId);
                if (host.socket.readyState === WebSocket.OPEN) {
                  host.socket.send(JSON.stringify({
                    type: 'new-viewer',
                    viewerId: peerId,
                    platform: platform || 'discord'
                  }));
                }
              }
            }

            if (currentRoomId) {
              const room = rooms.get(currentRoomId);
              if (room) {
                const participant = room.participants.get(peerId);
                if (participant) participant.watchingHostId = hostId;
              }
            }

            notifyHostViewers(hostId);
            broadcastStreamsList();
            break;
          }

          case 'leave-stream': {
            for (const r of rooms.values()) {
              const p = r.participants.get(peerId);
              if (p && p.watchingHostId) {
                const prev = p.watchingHostId;
                p.watchingHostId = null;
                notifyHostViewers(prev);
              }
              r.hosts.forEach((h) => h.viewers.delete(peerId));
            }
            broadcastStreamsList();
            break;
          }

          case 'stream-frame': {
            const payload = JSON.stringify({ type: 'stream-frame', hostId: peerId, frame });
            rooms.forEach((r) => {
              r.participants.forEach((p) => {
                if (p.watchingHostId === peerId && p.socket.readyState === WebSocket.OPEN) {
                  p.socket.send(payload);
                }
              });
            });
            break;
          }

          case 'stream-audio': {
            const payload = JSON.stringify({ type: 'stream-audio', hostId: peerId, audio });
            rooms.forEach((r) => {
              r.participants.forEach((p) => {
                if (p.watchingHostId === peerId && p.socket.readyState === WebSocket.OPEN) {
                  p.socket.send(payload);
                }
              });
            });
            break;
          }

          case 'offer': {
            if (!targetId) return;
            const targetSocket = findSocketById(targetId);
            if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
              targetSocket.send(JSON.stringify({ type: 'offer', from: peerId, sdp }));
            }
            break;
          }

          case 'answer': {
            if (!targetId) return;
            const targetSocket = findSocketById(targetId);
            if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
              targetSocket.send(JSON.stringify({ type: 'answer', from: peerId, sdp }));
            }
            break;
          }

          case 'ice-candidate': {
            if (!targetId) return;
            const targetSocket = findSocketById(targetId);
            if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
              targetSocket.send(JSON.stringify({ type: 'ice-candidate', from: peerId, candidate }));
            }
            break;
          }
        }
      } catch (_) {}
    };

    socket.onclose = () => {
      if (currentRoomId) {
        const room = rooms.get(currentRoomId);
        if (room) {
          if (room.hosts.has(peerId)) {
            room.hosts.delete(peerId);
            room.participants.forEach((p) => {
              if (p.watchingHostId === peerId && p.socket.readyState === WebSocket.OPEN) {
                p.socket.send(JSON.stringify({ type: 'host-stopped-stream', hostId: peerId }));
              }
            });
          }
          const p = room.participants.get(peerId);
          if (p && p.watchingHostId) {
            const prev = p.watchingHostId;
            p.watchingHostId = null;
            notifyHostViewers(prev);
          }
          room.participants.delete(peerId);
          broadcastStreamsList(currentRoomId);
          cleanEmptyRoom(currentRoomId);
        }
      }
    };

    return response;
  }

  // 2. Rotas de API
  if (url.pathname === '/api/config') {
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({
      publicUrl: `${url.origin}/`,
      platform: 'deno_deploy'
    }), { headers });
  }

  if (url.pathname === '/api/tunnel' || url.pathname === '/api/status') {
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({
      status: 'connected',
      tunnelUrl: `${url.origin}/`,
      targetDomain: url.host,
      platform: 'Deno Deploy (Edge Global)',
      instructions: `Cole '${url.host}' no Target do Discord Developer Portal!`
    }), { headers });
  }

  // Discord OAuth2 Token Exchange
  if (url.pathname === '/api/token' && req.method === 'POST') {
    headers.set('Content-Type', 'application/json');
    try {
      const body = await req.json();
      const code = body.code;
      if (!code) {
        return new Response(JSON.stringify({ error: 'Código de autorização ausente' }), { status: 400, headers });
      }

      const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code
      });

      const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        return new Response(JSON.stringify({ error: 'Erro no Discord', details: tokenData }), { status: tokenRes.status, headers });
      }

      return new Response(JSON.stringify({ access_token: tokenData.access_token }), { headers });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }

  // 3. Servir arquivos estáticos de ./public
  if (url.pathname === '/terms' || url.pathname === '/terms.html') {
    return serveDir(req, { fsRoot: 'public', urlRoot: '' });
  }
  if (url.pathname === '/privacy' || url.pathname === '/privacy.html') {
    return serveDir(req, { fsRoot: 'public', urlRoot: '' });
  }

  const fileResponse = await serveDir(req, {
    fsRoot: 'public',
    urlRoot: '',
    showIndex: true
  });

  // Anexa headers de segurança nas respostas de arquivos estáticos
  const resHeaders = new Headers(fileResponse.headers);
  headers.forEach((val, key) => resHeaders.set(key, val));

  return new Response(fileResponse.body, {
    status: fileResponse.status,
    statusText: fileResponse.statusText,
    headers: resHeaders
  });
});
