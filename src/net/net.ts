// Multiplayer client: room join/create over the WebSocket relay.
// Build phase: block placements are mirrored to everyone on the shared plot.
// Sail phase: the HOST simulates physics and streams transforms; guests render
// the replicated boat and send their steering/boost inputs to the host.

import type { C2S, Design, NetPlayer, PlacedBlock, S2C, XfPacket, NetEvent } from '../types';
import { tg } from '../telegram';

function defaultRelayUrl(): string {
  const env = (import.meta as any).env?.VITE_RELAY_URL;
  if (env) return env;
  if (location.hostname === 'localhost' || location.hostname.startsWith('127.') || location.hostname.startsWith('192.168.')) {
    return `ws://${location.hostname}:8791`;
  }
  return `wss://${location.host}/relay`;
}

export class Net {
  private ws: WebSocket | null = null;
  room = '';
  you = '';
  hostId = '';
  players: NetPlayer[] = [];
  get inRoom() {
    return !!this.room && this.ws?.readyState === WebSocket.OPEN;
  }
  get isHost() {
    return !this.inRoom || this.you === this.hostId;
  }

  // wired by main.ts
  onJoined: ((design: Design) => void) | null = null;
  onPlayers: (() => void) | null = null;
  onPlace: ((b: PlacedBlock) => void) | null = null;
  onRemove: ((key: string) => void) | null = null;
  onClear: (() => void) | null = null;
  onDesign: ((d: Design) => void) | null = null;
  onLaunch: (() => void) | null = null;
  onInput: ((from: string, s: number, th: number, j: number) => void) | null = null;
  onXf: ((data: XfPacket) => void) | null = null;
  onEv: ((ev: NetEvent) => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  onLeft: (() => void) | null = null;

  join(roomCode: string | null): Promise<string> {
    this.leave();
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(defaultRelayUrl());
      this.ws = ws;
      const fail = (msg: string) => {
        if (!settled) {
          settled = true;
          reject(new Error(msg));
        }
      };
      ws.onerror = () => fail('Relay unreachable - is the relay server running?');
      ws.onclose = () => {
        if (!settled) fail('Connection closed');
        else {
          this.room = '';
          this.onLeft?.();
        }
      };
      ws.onopen = () => {
        this.send({ t: 'hello', room: roomCode ?? '', create: !roomCode, name: tg.user.name });
      };
      ws.onmessage = (e) => {
        let msg: S2C;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        switch (msg.t) {
          case 'joined':
            this.room = msg.room;
            this.you = msg.you;
            this.hostId = msg.host;
            this.players = msg.players;
            if (!settled) {
              settled = true;
              resolve(msg.room);
            }
            this.onJoined?.(msg.design);
            this.onPlayers?.();
            break;
          case 'player+':
            this.players.push(msg.p);
            this.onPlayers?.();
            break;
          case 'player-':
            this.players = this.players.filter((p) => p.id !== msg.id);
            this.hostId = msg.host;
            this.onPlayers?.();
            break;
          case 'place':
            this.onPlace?.(msg.b);
            break;
          case 'remove':
            this.onRemove?.(msg.key);
            break;
          case 'clear':
            this.onClear?.();
            break;
          case 'design':
            this.onDesign?.(msg.d);
            break;
          case 'launch':
            this.onLaunch?.();
            break;
          case 'input':
            this.onInput?.(msg.from, msg.s, msg.th, msg.j);
            break;
          case 'xf':
            this.onXf?.(msg.data);
            break;
          case 'ev':
            this.onEv?.(msg.ev);
            break;
          case 'err':
            this.onError?.(msg.msg);
            fail(msg.msg);
            break;
        }
      };
      setTimeout(() => fail('Relay timeout'), 6000);
    });
  }

  leave() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.room = '';
    this.you = '';
    this.players = [];
  }

  send(msg: C2S) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendPlace(b: PlacedBlock) {
    if (this.inRoom) this.send({ t: 'place', b });
  }
  sendRemove(key: string) {
    if (this.inRoom) this.send({ t: 'remove', key });
  }
  sendDesign(d: Design) {
    if (this.inRoom && this.isHost) this.send({ t: 'design', d });
  }
  sendLaunch() {
    if (this.inRoom && this.isHost) this.send({ t: 'launch' });
  }
  sendInput(s: number, th: number, j: number) {
    if (this.inRoom && !this.isHost) this.send({ t: 'input', s, th, j });
  }
  sendXf(data: XfPacket) {
    if (this.inRoom && this.isHost) this.send({ t: 'xf', data });
  }
  sendEv(ev: NetEvent) {
    if (this.inRoom && this.isHost) this.send({ t: 'ev', ev });
  }
}

export const net = new Net();
