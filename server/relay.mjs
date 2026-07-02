// WebSocket room relay for NEON TIDE multiplayer.
// Host-authoritative: build ops mirror to a shared design, the host streams
// boat transforms during a run, guests stream inputs back.
//
//   attachRelay(httpServer, '/relay')   — share a port with the web server (prod)
//   node server/relay.mjs               — standalone on RELAY_PORT (default 8791)

import { WebSocketServer } from 'ws';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => Array.from({ length: 5 }, () => ALPHABET[(Math.random() * ALPHABET.length) | 0]).join('');
const genId = () => Math.random().toString(36).slice(2, 10);

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(room, msg, exceptId = null) {
  for (const [id, client] of room.clients) if (id !== exceptId) send(client, msg);
}
const playerList = (room) => [...room.players.values()];

/** Wires relay behavior onto a WebSocketServer instance. */
function wireRelay(wss, label) {
  const rooms = new Map();

  wss.on('connection', (ws) => {
    ws.id = genId();
    ws.roomCode = null;
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));

    ws.on('message', (raw) => {
      if (raw.length > 128 * 1024) return;
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const room = ws.roomCode ? rooms.get(ws.roomCode) : null;

      switch (msg.t) {
        case 'hello': {
          let code = String(msg.room || '').toUpperCase().slice(0, 8);
          if (msg.create) {
            code = genCode();
            while (rooms.has(code)) code = genCode();
            rooms.set(code, { clients: new Map(), players: new Map(), host: ws.id, design: [] });
          }
          const r = rooms.get(code);
          if (!r) return send(ws, { t: 'err', msg: 'Room not found' });
          if (r.clients.size >= 6) return send(ws, { t: 'err', msg: 'Room is full' });
          ws.roomCode = code;
          r.clients.set(ws.id, ws);
          const player = { id: ws.id, name: String(msg.name || 'Captain').slice(0, 24), color: r.players.size % 7 };
          r.players.set(ws.id, player);
          send(ws, { t: 'joined', room: code, you: ws.id, host: r.host, players: playerList(r), design: r.design });
          broadcast(r, { t: 'player+', p: player }, ws.id);
          break;
        }
        case 'place': {
          if (!room || !msg.b) return;
          room.design = room.design.filter((b) => !(b.gx === msg.b.gx && b.gy === msg.b.gy && b.gz === msg.b.gz));
          room.design.push(msg.b);
          broadcast(room, { t: 'place', b: msg.b, from: ws.id }, ws.id);
          break;
        }
        case 'remove': {
          if (!room || typeof msg.key !== 'string') return;
          room.design = room.design.filter((b) => `${b.gx},${b.gy},${b.gz}` !== msg.key);
          broadcast(room, { t: 'remove', key: msg.key, from: ws.id }, ws.id);
          break;
        }
        case 'clear': {
          if (!room) return;
          room.design = [];
          broadcast(room, { t: 'clear', from: ws.id }, ws.id);
          break;
        }
        case 'design': {
          if (!room || ws.id !== room.host || !Array.isArray(msg.d)) return;
          room.design = msg.d.slice(0, 200);
          broadcast(room, { t: 'design', d: room.design }, ws.id);
          break;
        }
        case 'launch': {
          if (!room || ws.id !== room.host) return;
          broadcast(room, { t: 'launch', from: ws.id }, ws.id);
          break;
        }
        case 'input': {
          if (!room) return;
          const host = room.clients.get(room.host);
          if (host && host !== ws) send(host, { t: 'input', from: ws.id, s: +msg.s || 0, th: msg.th ? 1 : 0, j: msg.j ? 1 : 0 });
          break;
        }
        case 'xf': {
          if (!room || ws.id !== room.host) return;
          broadcast(room, { t: 'xf', data: msg.data }, ws.id);
          break;
        }
        case 'ev': {
          if (!room || ws.id !== room.host) return;
          broadcast(room, { t: 'ev', ev: msg.ev }, ws.id);
          break;
        }
      }
    });

    ws.on('close', () => {
      const room = ws.roomCode ? rooms.get(ws.roomCode) : null;
      if (!room) return;
      room.clients.delete(ws.id);
      room.players.delete(ws.id);
      if (room.clients.size === 0) { rooms.delete(ws.roomCode); return; }
      if (room.host === ws.id) room.host = room.clients.keys().next().value;
      broadcast(room, { t: 'player-', id: ws.id, host: room.host });
    });
  });

  const reaper = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 25000);
  wss.on('close', () => clearInterval(reaper));

  console.log(`[relay] NEON TIDE relay ready (${label})`);
  return { rooms };
}

/** Production: share the web server's port, upgrade only `path` requests. */
export function attachRelay(httpServer, path = '/relay') {
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try { pathname = new URL(req.url, 'http://x').pathname; } catch {}
    if (pathname !== path) return; // let other upgrade handlers (or nothing) deal with it
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  return wireRelay(wss, `path ${path}`);
}

/** Standalone dev relay on its own port. */
export function startStandalone(port = Number(process.env.RELAY_PORT || 8791)) {
  const wss = new WebSocketServer({ port });
  wireRelay(wss, `standalone :${port}`);
  return wss;
}

// Run directly → standalone.
if (import.meta.url === `file://${process.argv[1]}`) startStandalone();
