import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BLOCKS } from '../config';
import type { BlockKind } from '../types';

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key)!;
}

const cube = () => geo('cube', () => new RoundedBoxGeometry(0.98, 0.98, 0.98, 2, 0.07));
const slab = () => geo('slab', () => new RoundedBoxGeometry(0.98, 0.42, 0.98, 2, 0.06));

function std(kind: BlockKind) {
  const d = BLOCKS[kind];
  return new THREE.MeshStandardMaterial({
    color: d.color,
    roughness: d.rough,
    metalness: d.metal,
    emissive: d.emissive ?? 0x000000,
    emissiveIntensity: d.emissiveIntensity ?? 0,
  });
}

interface TintState { mats: THREE.MeshStandardMaterial[]; base: THREE.Color[]; baseEm: THREE.Color[]; baseEmI: number[] }

/** Builds the visual for one block. group.userData.tint(fracHp, flash) recolors it as it takes damage. */
export function makeBlockGroup(kind: BlockKind, accent = 0x66e0ff): THREE.Group {
  const g = new THREE.Group();
  const tintable: THREE.Mesh[] = [];
  const add = (mesh: THREE.Mesh, tint = true) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    if (tint) tintable.push(mesh);
    return mesh;
  };

  switch (kind) {
    case 'seat': {
      add(new THREE.Mesh(slab(), std(kind))).position.y = -0.28;
      const back = add(new THREE.Mesh(geo('seatback', () => new RoundedBoxGeometry(0.9, 0.8, 0.22, 2, 0.06)), std(kind)));
      back.position.set(0, 0.1, -0.38);
      const glow = add(new THREE.Mesh(geo('seattrim', () => new THREE.BoxGeometry(0.94, 0.05, 0.05)), new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.6 })), false);
      glow.position.set(0, 0.46, -0.38);
      break;
    }
    case 'thruster': {
      add(new THREE.Mesh(geo('thrbody', () => new RoundedBoxGeometry(0.9, 0.9, 0.78, 2, 0.08)), std(kind))).position.z = 0.08;
      const nozzle = add(new THREE.Mesh(geo('nozzle', () => new THREE.CylinderGeometry(0.28, 0.4, 0.34, 14)), new THREE.MeshStandardMaterial({ color: 0x1a2233, roughness: 0.4, metalness: 0.9 })));
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.z = -0.42;
      const ring = add(new THREE.Mesh(geo('thring', () => new THREE.TorusGeometry(0.34, 0.05, 8, 20)), new THREE.MeshStandardMaterial({ color: accent, emissive: 0x22d3ee, emissiveIntensity: 2.2 })), false);
      ring.position.z = -0.55;
      (g as any).flameAnchor = new THREE.Vector3(0, 0, -0.7);
      break;
    }
    case 'rudder': {
      add(new THREE.Mesh(slab(), std(kind))).position.y = 0.28;
      const fin = add(new THREE.Mesh(geo('fin', () => new RoundedBoxGeometry(0.14, 0.9, 0.8, 2, 0.05)), std(kind)));
      fin.position.set(0, -0.25, 0.05);
      break;
    }
    case 'balloon': {
      add(new THREE.Mesh(geo('bbase', () => new RoundedBoxGeometry(0.5, 0.3, 0.5, 2, 0.05)), std('metal'))).position.y = -0.34;
      const ball = add(new THREE.Mesh(geo('ball', () => new THREE.SphereGeometry(0.42, 18, 14)), std(kind)));
      ball.position.y = 0.12;
      ball.scale.y = 1.15;
      break;
    }
    case 'tnt': {
      add(new THREE.Mesh(cube(), std(kind)));
      const band = add(new THREE.Mesh(geo('tntband', () => new THREE.BoxGeometry(1.0, 0.18, 1.0)), new THREE.MeshStandardMaterial({ color: 0xfff3a8, roughness: 0.5, emissive: 0xffa02f, emissiveIntensity: 0.35 })), false);
      band.position.y = 0.12;
      break;
    }
    default:
      add(new THREE.Mesh(cube(), std(kind)));
  }

  // per-instance materials so damage tinting doesn't leak across blocks
  const ts: TintState = { mats: [], base: [], baseEm: [], baseEmI: [] };
  for (const m of tintable) {
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    m.material = mat;
    ts.mats.push(mat);
    ts.base.push(mat.color.clone());
    ts.baseEm.push(mat.emissive.clone());
    ts.baseEmI.push(mat.emissiveIntensity);
  }
  const dark = new THREE.Color(0x140b08);
  const red = new THREE.Color(0xff2222);
  g.userData.tint = (frac: number, flash: number) => {
    const dmg = 1 - frac;
    for (let i = 0; i < ts.mats.length; i++) {
      const m = ts.mats[i];
      m.color.copy(ts.base[i]).lerp(dark, dmg * 0.55);
      if (flash > 0) {
        m.emissive.copy(red);
        m.emissiveIntensity = flash * 2.2;
      } else {
        m.emissive.copy(ts.baseEm[i]);
        m.emissiveIntensity = ts.baseEmI[i];
      }
    }
  };
  g.userData.kind = kind;
  return g;
}

/** Semi-transparent placement preview with a heading arrow for directional blocks. */
export function makeGhost(kind: BlockKind): THREE.Group {
  const g = makeBlockGroup(kind);
  const mats: THREE.MeshStandardMaterial[] = [];
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
      m.transparent = true;
      m.opacity = 0.45;
      m.depthWrite = false;
      (o as THREE.Mesh).castShadow = false;
      (o as THREE.Mesh).receiveShadow = false;
      mats.push(m);
    }
  });
  if (BLOCKS[kind].dir) {
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.42, 10),
      new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.9 }),
    );
    arrow.rotation.x = Math.PI / 2;
    arrow.position.set(0, 0.75, 0.25);
    g.add(arrow);
  }
  g.userData.setValid = (ok: boolean) => {
    for (const m of mats) {
      m.emissive.setHex(ok ? 0x0d5a6a : 0x6a0d1a);
      m.emissiveIntensity = 0.9;
    }
  };
  return g;
}

/** Little captain figure that rides a seat. */
export function makeAvatar(color: number, name?: string): THREE.Group {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.4, emissive: color, emissiveIntensity: 0.25 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.3, 4, 10), suit);
  body.position.y = 0.42;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), suit);
  head.position.y = 0.82;
  head.castShadow = true;
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.145, 12, 8, 0, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x0a1020, roughness: 0.1, metalness: 0.9, emissive: 0x66e0ff, emissiveIntensity: 0.5 }),
  );
  visor.position.set(0, 0.82, 0.055);
  g.add(body, head, visor);
  if (name) {
    const cnv = document.createElement('canvas');
    cnv.width = 256; cnv.height = 56;
    const c = cnv.getContext('2d')!;
    c.font = '700 30px -apple-system, system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillStyle = 'rgba(6,10,18,0.55)';
    const w = Math.min(240, c.measureText(name).width + 26);
    c.beginPath();
    (c as any).roundRect?.(128 - w / 2, 6, w, 44, 12);
    c.fill();
    c.fillStyle = '#e8f6ff';
    c.fillText(name.slice(0, 14), 128, 37);
    const tex = new THREE.CanvasTexture(cnv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    spr.scale.set(1.7, 0.38, 1);
    spr.position.y = 1.35;
    g.add(spr);
  }
  return g;
}
