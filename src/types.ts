export type MaterialKind = 'wood' | 'plastic' | 'metal' | 'gold';
export type BlockKind = MaterialKind | 'seat' | 'rudder' | 'thruster' | 'balloon' | 'tnt';

export interface BlockDef {
  kind: BlockKind;
  label: string;
  cost: number;
  hp: number;
  density: number; // kg per m^3 (block is 1 m^3)
  color: number;
  rough: number;
  metal: number;
  emissive?: number;
  emissiveIntensity?: number;
  desc: string;
  functional?: boolean;
  dir?: boolean; // rotation matters (arrow shown on ghost)
}

export interface PlacedBlock {
  gx: number;
  gy: number;
  gz: number;
  rot: number; // 0..3, quarter turns around Y
  kind: BlockKind;
  owner?: string;
}

export type Design = PlacedBlock[];

export type Phase = 'boot' | 'build' | 'launching' | 'sailing' | 'treasure' | 'summary';

export interface RunStats {
  stage: number;
  goldEarned: number;
  time: number;
  blocksLost: number;
  finished: boolean;
  reason: string;
}

export const keyOf = (gx: number, gy: number, gz: number) => `${gx},${gy},${gz}`;

export class Emitter {
  private m = new Map<string, Set<(...a: any[]) => void>>();
  on(e: string, cb: (...a: any[]) => void) {
    if (!this.m.has(e)) this.m.set(e, new Set());
    this.m.get(e)!.add(cb);
    return () => this.m.get(e)?.delete(cb);
  }
  emit(e: string, ...a: any[]) {
    this.m.get(e)?.forEach((cb) => cb(...a));
  }
}

// ---- networking messages (relay protocol) ----
export interface NetPlayer {
  id: string;
  name: string;
  color: number; // team color index
}

export type C2S =
  | { t: 'hello'; room: string; create: boolean; name: string }
  | { t: 'place'; b: PlacedBlock }
  | { t: 'remove'; key: string }
  | { t: 'clear' }
  | { t: 'design'; d: Design }
  | { t: 'launch' }
  | { t: 'input'; s: number; th: number; j: number }
  | { t: 'xf'; data: XfPacket }
  | { t: 'ev'; ev: NetEvent };

export type S2C =
  | { t: 'joined'; room: string; you: string; host: string; players: NetPlayer[]; design: Design }
  | { t: 'player+'; p: NetPlayer }
  | { t: 'player-'; id: string; host: string }
  | { t: 'place'; b: PlacedBlock; from: string }
  | { t: 'remove'; key: string; from: string }
  | { t: 'clear'; from: string }
  | { t: 'design'; d: Design }
  | { t: 'launch'; from: string }
  | { t: 'input'; from: string; s: number; th: number; j: number }
  | { t: 'xf'; data: XfPacket }
  | { t: 'ev'; ev: NetEvent }
  | { t: 'err'; msg: string };

export interface XfPacket {
  // primary cluster + up to 3 wrecks: [x,y,z, qx,qy,qz,qw] each
  main: number[];
  wrecks: { id: number; xf: number[]; keys?: string[] }[];
  removed: string[]; // block keys broken since last packet
  seats: Record<string, string>; // playerId -> seat block key
}

export type NetEvent =
  | { k: 'stage'; n: number }
  | { k: 'end'; reason: string; finished: boolean; stage: number }
  | { k: 'treasure'; gold: number }
  | { k: 'countdown'; n: number };
