import type { BlockDef, BlockKind } from './types';

// ---------- world layout ----------
export const PLOT = {
  half: 5, // grid gx,gz in [-5..5]  => 11x11
  h: 7, // gy in [0..6]
  cz: -8, // plot center world z (dock)
  floorTop: -0.55, // plot deck height; water rises to 0 => bottom row floats
};
export const MAX_BLOCKS = 130;

export const RIVER = {
  wallX: 7.5, // channel walls at +-7.5
  stageLen: 52,
  stages: 8,
  dockZ0: -15.5,
  gateZ: -0.5,
  floorY: -2.6,
};
export const Z_WF = RIVER.stageLen * RIVER.stages; // 416 - waterfall lip
export const POOL = { z1: Z_WF + 54, floorY: -19, level: -16 };
export const END = { gateZ: Z_WF + 54, z1: Z_WF + 88, chestZ: Z_WF + 76, triggerZ: Z_WF + 70 };

export const WATER = { level: 0, dockFrom: -3.2 };

// ---------- physics tuning (fun > realism) ----------
export const PHYS = {
  g: 13,
  buoyN: 17550, // uplift per fully submerged 1m^3 block
  dragH: 950, // horizontal water drag N per m/s per submerged block
  dragV: 2300, // vertical water drag
  angDamp: 430, // angular water damping torque per submerged block
  turnPower: 8.5, // yaw torque per kg of boat at full steer
  rudderBonus: 0.85, // +85% turn authority per rudder
  thrusterForce: 26000,
  thrusterTime: 2.2,
  thrusterCd: 4.5,
  jumpVel: 4.6, // applied as delta-v
  jumpCd: 2.0,
  balloonLift: 8800,
  currentByTier: [4.6, 6.2, 7.9],
  dockCurrent: 2.8,
  poolCurrent: 2.4,
  maxAngVel: 1.7,
};

export const DMG = {
  defaultMult: 0.42,
  minImpact: 5200, // N of contact force before damage starts
  scale: 1 / 950, // damage per N above threshold
  maxHit: 42, // no one-shot wipes - big hits chip, repeated hits kill
  iframes: 0.12,
  sawDps: 26,
  spikeDps: 18,
  tnt: { r: 2.9, dmg: 85, imp: 16000, trigger: 12 },
  bomb: { r: 2.3, dmg: 45, imp: 8500 },
};

// ---------- economy ----------
export const ECON = {
  startGold: 30,
  starter: { wood: 24, seat: 1 } as Partial<Record<BlockKind, number>>,
  stageGold: 8,
  treasureBase: 50,
  perStage: 12,
  firstClear: 100,
  timeBonusMax: 40,
  timePar: 95, // seconds; slower than this decays the time bonus
};

export const TIERS = [
  { name: 'ЛЁГКИЙ', color: 0x7fb069, css: '#7fb069' },
  { name: 'СРЕДНИЙ', color: 0xf2a93b, css: '#f2a93b' },
  { name: 'СЛОЖНЫЙ', color: 0xe2574c, css: '#e2574c' },
];
export const tierOfStage = (i: number) => (i < 3 ? 0 : i < 6 ? 1 : 2);

export const TEAM_COLORS = [0x66e0ff, 0x4d7bff, 0x35e06f, 0xff4d5e, 0xf3f6ff, 0xffd23f, 0xff5ce1];

// ---------- block catalog ----------
export const BLOCKS: Record<BlockKind, BlockDef> = {
  wood: { kind: 'wood', label: 'Дерево', cost: 3, hp: 35, density: 420, color: 0xb97a45, rough: 0.78, metal: 0.02, desc: 'Дёшево, отлично плавает, быстро ломается' },
  plastic: { kind: 'plastic', label: 'Пластик', cost: 5, hp: 55, density: 560, color: 0x3ec3ff, rough: 0.2, metal: 0.05, desc: 'Лёгкий и скользкий' },
  metal: { kind: 'metal', label: 'Металл', cost: 10, hp: 115, density: 1650, color: 0xbac7d5, rough: 0.32, metal: 0.95, desc: 'Броня - тонет без корпуса' },
  gold: { kind: 'gold', label: 'Золото', cost: 25, hp: 145, density: 2300, color: 0xffc94d, rough: 0.16, metal: 1, emissive: 0x3a2a00, emissiveIntensity: 0.25, desc: 'Тяжёлое, блестит, почти не ломается' },
  seat: { kind: 'seat', label: 'Сиденье', cost: 8, hp: 62, density: 480, color: 0x8a5cff, rough: 0.4, metal: 0.3, emissive: 0x2a1560, emissiveIntensity: 0.5, desc: 'Здесь едет твой капитан', functional: true, dir: true },
  rudder: { kind: 'rudder', label: 'Руль', cost: 10, hp: 45, density: 520, color: 0x37e6c8, rough: 0.35, metal: 0.5, emissive: 0x0b4a40, emissiveIntensity: 0.5, desc: '+ управляемость', functional: true, dir: true },
  thruster: { kind: 'thruster', label: 'Двигатель', cost: 30, hp: 55, density: 850, color: 0x2a3346, rough: 0.3, metal: 0.8, emissive: 0x0d3a4a, emissiveIntensity: 0.6, desc: 'Рывок скорости, есть перезарядка', functional: true, dir: true },
  balloon: { kind: 'balloon', label: 'Шар', cost: 15, hp: 14, density: 90, color: 0xff5c8a, rough: 0.35, metal: 0, emissive: 0x40101f, emissiveIntensity: 0.4, desc: 'Подъём! Легко лопается', functional: true },
  tnt: { kind: 'tnt', label: 'Динамит', cost: 12, hp: 30, density: 520, color: 0xff3b30, rough: 0.5, metal: 0.1, emissive: 0x4a0d08, emissiveIntensity: 0.5, desc: 'Взрывается от сильного удара', functional: true },
};
export const PALETTE_ORDER: BlockKind[] = ['wood', 'plastic', 'metal', 'gold', 'seat', 'rudder', 'thruster', 'balloon', 'tnt'];

// ---------- stage obstacle layouts ----------
export type ObSpec =
  | { t: 'rock'; x: number; z: number; s?: number }
  | { t: 'wall'; z: number; gapX: number; gapW: number }
  | { t: 'axe'; z: number; phase?: number; period?: number }
  | { t: 'saw'; x: number; z: number; r?: number }
  | { t: 'cannon'; side: 1 | -1; z: number }
  | { t: 'geyser'; x: number; z: number; phase?: number }
  | { t: 'spikes'; x0: number; x1: number; z0: number; z1: number }
  | { t: 'ceiling'; z: number; h?: number };

// z is local to the stage (0..52), x in [-6.5..6.5]
export const STAGES: ObSpec[][] = [
  // 1 GREEN - learn to steer
  [
    { t: 'rock', x: -3, z: 16 },
    { t: 'rock', x: 2.6, z: 28, s: 1.3 },
    { t: 'rock', x: -1, z: 42 },
  ],
  // 2 GREEN - walls with gaps
  [
    { t: 'wall', z: 14, gapX: -2.8, gapW: 6 },
    { t: 'rock', x: 3.2, z: 26 },
    { t: 'geyser', x: 0, z: 34 },
    { t: 'wall', z: 46, gapX: 3, gapW: 6.5 },
  ],
  // 3 GREEN - first saw
  [
    { t: 'saw', x: -4.6, z: 13 },
    { t: 'wall', z: 24, gapX: 0, gapW: 5.5 },
    { t: 'rock', x: 4, z: 34 },
    { t: 'rock', x: -3.4, z: 40, s: 1.2 },
    { t: 'geyser', x: 2, z: 46 },
  ],
  // 4 YELLOW - swinging axes
  [
    { t: 'axe', z: 13 },
    { t: 'rock', x: -4, z: 24 },
    { t: 'axe', z: 34, phase: Math.PI * 0.6 },
    { t: 'wall', z: 46, gapX: -3.4, gapW: 5 },
  ],
  // 5 YELLOW - saw weave + geysers
  [
    { t: 'saw', x: -5, z: 15 },
    { t: 'saw', x: 0, z: 15 },
    { t: 'saw', x: 5, z: 15 },
    { t: 'geyser', x: -2.5, z: 26 },
    { t: 'geyser', x: 2.5, z: 32, phase: 1.4 },
    { t: 'saw', x: -2.6, z: 42 },
    { t: 'saw', x: 2.6, z: 42 },
  ],
  // 6 YELLOW - cannons + low ceiling
  [
    { t: 'cannon', side: -1, z: 8 },
    { t: 'cannon', side: 1, z: 22 },
    { t: 'ceiling', z: 34, h: 2.7 },
    { t: 'rock', x: 0, z: 44, s: 1.5 },
  ],
  // 7 RED - spikes + fast axes
  [
    { t: 'spikes', x0: -6.5, x1: -0.5, z0: 6, z1: 12 },
    { t: 'axe', z: 19, period: 2.0 },
    { t: 'spikes', x0: 0.5, x1: 6.5, z0: 26, z1: 32 },
    { t: 'axe', z: 38, period: 1.9, phase: 2 },
    { t: 'saw', x: 0, z: 47 },
  ],
  // 8 RED - the gauntlet
  [
    { t: 'cannon', side: -1, z: 5 },
    { t: 'cannon', side: 1, z: 12 },
    { t: 'saw', x: -4, z: 20 },
    { t: 'saw', x: 4, z: 20 },
    { t: 'geyser', x: 0, z: 25 },
    { t: 'cannon', side: -1, z: 28 },
    { t: 'ceiling', z: 36, h: 2.6 },
    { t: 'wall', z: 46, gapX: 0, gapW: 4.6 },
  ],
];

export const QUESTS = [
  { id: 'stage5', label: 'Дойти до этапа 5', gold: 40 },
  { id: 'woodrun', label: 'Пройти заплыв - только дерево и сиденье', gold: 75 },
  { id: 'waterfall', label: 'Пережить водопад', gold: 50 },
];

export const SAVE_KEY = 'neon-tide-v1';
