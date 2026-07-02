import * as THREE from 'three';
import { waterLevelAt } from './water';

const MAX_P = 1400;
const MAX_D = 90;

const P_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vA;
varying vec3 vC;
void main() {
  vC = aColor; vA = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (260.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const P_FRAG = /* glsl */ `
varying float vA;
varying vec3 vC;
void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float d = dot(uv, uv);
  if (d > 1.0) discard;
  gl_FragColor = vec4(vC, smoothstep(1.0, 0.45, d) * vA);
}`;

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number; r: number; g: number; b: number;
  grav: number; drag: number;
}

export interface BurstOpts {
  n?: number;
  colors?: number[];
  speed?: number;
  up?: number;
  life?: number;
  size?: number;
  grav?: number;
  drag?: number;
  spreadY?: number;
}

const C = new THREE.Color();

export class Particles {
  private pool: P[] = [];
  private cursor = 0;
  private geo = new THREE.BufferGeometry();
  private pos = new Float32Array(MAX_P * 3);
  private col = new Float32Array(MAX_P * 3);
  private sizes = new Float32Array(MAX_P);
  private alphas = new Float32Array(MAX_P);
  points: THREE.Points;

  // debris (instanced chunky cubes with fake physics)
  private dGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
  debris: THREE.InstancedMesh;
  private dItems: { p: THREE.Vector3; v: THREE.Vector3; e: THREE.Euler; av: THREE.Vector3; life: number; s: number; sink: boolean }[] = [];
  private dCursor = 0;
  private dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < MAX_P; i++) {
      this.pool.push({ x: 0, y: -9999, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, r: 1, g: 1, b: 1, grav: 0, drag: 0 });
      this.pos[i * 3 + 1] = -9999;
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: P_VERT,
      fragmentShader: P_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.debris = new THREE.InstancedMesh(this.dGeo, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.25 }), MAX_D);
    this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debris.frustumCulled = false;
    for (let i = 0; i < MAX_D; i++) {
      this.dItems.push({ p: new THREE.Vector3(0, -9999, 0), v: new THREE.Vector3(), e: new THREE.Euler(), av: new THREE.Vector3(), life: 0, s: 1, sink: true });
      this.debris.setColorAt(i, C.setHex(0xffffff));
    }
    scene.add(this.debris);
  }

  burst(at: THREE.Vector3 | { x: number; y: number; z: number }, o: BurstOpts = {}) {
    const n = o.n ?? 12;
    const colors = o.colors ?? [0xbfefff];
    const speed = o.speed ?? 3;
    for (let i = 0; i < n; i++) {
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % MAX_P;
      C.setHex(colors[(Math.random() * colors.length) | 0]);
      const a = Math.random() * Math.PI * 2;
      const m = (0.3 + Math.random() * 0.7) * speed;
      p.x = at.x; p.y = at.y; p.z = at.z;
      p.vx = Math.cos(a) * m;
      p.vz = Math.sin(a) * m;
      p.vy = (o.up ?? 2.5) * (0.4 + Math.random() * (o.spreadY ?? 1));
      p.max = p.life = (o.life ?? 0.7) * (0.6 + Math.random() * 0.8);
      p.size = (o.size ?? 3) * (0.6 + Math.random() * 0.8);
      p.r = C.r; p.g = C.g; p.b = C.b;
      p.grav = o.grav ?? 9;
      p.drag = o.drag ?? 0.5;
    }
  }

  // ---- presets ----
  splash(at: THREE.Vector3 | { x: number; y: number; z: number }, power = 1) {
    this.burst(at, { n: Math.min(40, Math.round(14 * power)), colors: [0x9fe8ff, 0x4fc3ff, 0xffffff], speed: 2.6 * power, up: 3.4 * power, life: 0.8, size: 3.4, grav: 11 });
  }
  spark(at: THREE.Vector3, n = 10) {
    this.burst(at, { n, colors: [0xfff3a8, 0xffd23f, 0xffffff], speed: 6, up: 2, life: 0.35, size: 2.2, grav: 5 });
  }
  flame(at: THREE.Vector3, dir: THREE.Vector3) {
    for (let i = 0; i < 3; i++) {
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % MAX_P;
      C.setHex([0x66e0ff, 0xffa02f, 0xfff3a8][(Math.random() * 3) | 0]);
      p.x = at.x + (Math.random() - 0.5) * 0.25;
      p.y = at.y + (Math.random() - 0.5) * 0.25;
      p.z = at.z + (Math.random() - 0.5) * 0.25;
      p.vx = -dir.x * 7 + (Math.random() - 0.5) * 1.5;
      p.vy = -dir.y * 7 + (Math.random() - 0.5) * 1.5;
      p.vz = -dir.z * 7 + (Math.random() - 0.5) * 1.5;
      p.max = p.life = 0.3 + Math.random() * 0.15;
      p.size = 3.2; p.r = C.r; p.g = C.g; p.b = C.b;
      p.grav = -1; p.drag = 2.2;
    }
  }
  explosion(at: THREE.Vector3 | { x: number; y: number; z: number }, scale = 1) {
    this.burst(at, { n: Math.round(34 * scale), colors: [0xffa02f, 0xff5c2f, 0xfff3a8], speed: 7 * scale, up: 5, life: 0.65, size: 5, grav: 4, spreadY: 1.6 });
    this.burst(at, { n: 16, colors: [0x8a93a6], speed: 3, up: 3.5, life: 1.1, size: 6, grav: -0.5 });
  }
  goldBurst(at: THREE.Vector3, big = false) {
    this.burst(at, { n: big ? 70 : 20, colors: [0xffc94d, 0xffe89b, 0xfff7d9], speed: big ? 5.5 : 3, up: big ? 7 : 4, life: 1.2, size: 3.6, grav: 8 });
  }
  confetti(at: THREE.Vector3) {
    this.burst(at, { n: 60, colors: [0x66e0ff, 0xff5ce1, 0x35e06f, 0xffd23f, 0xffffff], speed: 4.5, up: 7, life: 1.8, size: 3.2, grav: 6, drag: 0.8 });
  }
  geyserJet(at: THREE.Vector3) {
    this.burst(at, { n: 5, colors: [0xbfefff, 0x66e0ff], speed: 0.9, up: 11, life: 0.75, size: 4.2, grav: 10, spreadY: 1.4 });
  }
  wake(at: THREE.Vector3) {
    this.burst(at, { n: 2, colors: [0x9fe8ff, 0xffffff], speed: 1.2, up: 1.4, life: 0.55, size: 2.6, grav: 6 });
  }

  debrisBurst(at: THREE.Vector3 | { x: number; y: number; z: number }, colorHex: number, n = 5, power = 1, sink = true) {
    for (let i = 0; i < n; i++) {
      const d = this.dItems[this.dCursor];
      this.dCursor = (this.dCursor + 1) % MAX_D;
      d.p.set(at.x, at.y, at.z);
      d.v.set((Math.random() - 0.5) * 5 * power, 2 + Math.random() * 4 * power, (Math.random() - 0.5) * 5 * power);
      d.av.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      d.e.set(0, 0, 0);
      d.life = 5 + Math.random() * 2;
      d.s = 0.6 + Math.random() * 0.9;
      d.sink = sink;
      this.debris.setColorAt(this.dCursor, C.setHex(colorHex));
    }
    if (this.debris.instanceColor) this.debris.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    // points
    for (let i = 0; i < MAX_P; i++) {
      const p = this.pool[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      const dr = 1 - Math.min(0.9, p.drag * dt);
      p.vx *= dr; p.vz *= dr; p.vy = p.vy * dr - p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const k = i * 3;
      if (p.life <= 0) {
        this.pos[k + 1] = -9999;
        this.alphas[i] = 0;
      } else {
        this.pos[k] = p.x; this.pos[k + 1] = p.y; this.pos[k + 2] = p.z;
        this.col[k] = p.r; this.col[k + 1] = p.g; this.col[k + 2] = p.b;
        this.sizes[i] = p.size;
        this.alphas[i] = Math.min(1, (p.life / p.max) * 1.6);
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;

    // debris
    for (let i = 0; i < MAX_D; i++) {
      const d = this.dItems[i];
      if (d.life <= 0) {
        this.dummy.position.set(0, -9999, 0);
        this.dummy.scale.setScalar(0.001);
      } else {
        d.life -= dt;
        const lvl = waterLevelAt(d.p.x, d.p.z);
        if (d.p.y < lvl) {
          d.v.multiplyScalar(1 - Math.min(0.9, 3 * dt));
          d.v.y += (d.sink ? -1.2 : 5.5) * dt;
        } else {
          d.v.y -= 11 * dt;
        }
        d.p.addScaledVector(d.v, dt);
        d.e.x += d.av.x * dt; d.e.y += d.av.y * dt; d.e.z += d.av.z * dt;
        this.dummy.position.copy(d.p);
        this.dummy.rotation.copy(d.e);
        this.dummy.scale.setScalar(d.s * Math.min(1, d.life));
      }
      this.dummy.updateMatrix();
      this.debris.setMatrixAt(i, this.dummy.matrix);
    }
    this.debris.instanceMatrix.needsUpdate = true;
  }
}
