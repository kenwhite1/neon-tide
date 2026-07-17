import * as THREE from 'three';
import { PHYS, RIVER, POOL, END, WATER, Z_WF, tierOfStage } from '../config';

/** Global hydro state: flood animation progress + master clock. */
export const hydro = { time: 0, floodT: 0, sailing: false };

export function waterLevelAt(_x: number, z: number): number {
  if (z < RIVER.gateZ) return WATER.dockFrom + (WATER.level - WATER.dockFrom) * hydro.floodT;
  return z < Z_WF ? WATER.level : POOL.level;
}

/** Water velocity field - the river's forward push, lip suck, pool drift. */
export function currentAt(_x: number, _y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  out.set(0, 0, 0);
  if (z < RIVER.gateZ) {
    if (hydro.floodT > 0.15) out.z = PHYS.dockCurrent * hydro.floodT;
    return out;
  }
  if (!hydro.sailing) return out;
  if (z < Z_WF) {
    const stage = Math.min(RIVER.stages - 1, Math.max(0, Math.floor(z / RIVER.stageLen)));
    out.z = PHYS.currentByTier[tierOfStage(stage)];
    out.x = Math.sin(z * 0.3 + hydro.time * 0.85) * 0.3;
    if (z > Z_WF - 7) out.y = -2.8 * (1 - (Z_WF - z) / 7); // suck over the lip
    return out;
  }
  out.z = z < END.triggerZ ? PHYS.poolCurrent : 0.5;
  return out;
}

const WATER_VERT = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying float vWave;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float w = sin(wp.x * 0.85 + uTime * 1.7) * 0.05
          + sin(wp.z * 0.42 - uTime * 1.25) * 0.075
          + sin((wp.x + wp.z) * 0.6 + uTime * 2.1) * 0.03;
  wp.y += w;
  vWave = w;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFlow;
uniform float uWallX;
varying vec3 vWorld;
varying float vWave;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y);
}
void main() {
  vec3 deep = vec3(0.016, 0.10, 0.19);
  vec3 shallow = vec3(0.05, 0.42, 0.52);
  vec3 foamC = vec3(0.75, 0.95, 1.0);

  vec3 vdir = normalize(cameraPosition - vWorld);
  float ndv = clamp(vdir.y, 0.0, 1.0);
  float fresnel = pow(1.0 - ndv, 2.4);
  vec3 col = mix(deep, shallow, fresnel * 0.9 + vWave * 1.6 + 0.12);

  // scrolling flow streaks
  float streak = noise(vec2(vWorld.x * 0.7, vWorld.z * 0.22 - uTime * uFlow));
  col += shallow * smoothstep(0.62, 0.95, streak) * 0.35;

  // foam along walls
  float wallFoam = smoothstep(uWallX - 1.2, uWallX - 0.1, abs(vWorld.x));
  float fn = noise(vec2(vWorld.z * 0.9 - uTime * uFlow * 2.0, vWorld.x * 2.0));
  col = mix(col, foamC, wallFoam * (0.35 + fn * 0.5));

  // sparkle on crests
  float sp = pow(noise(vWorld.xz * 1.5 + uTime * 0.6), 16.0);
  col += vec3(0.9, 1.0, 1.0) * sp * 0.7;

  gl_FragColor = vec4(col, 0.93);
}`;

const FALL_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying float vWave;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y);
}
void main() {
  float fall = noise(vec2(vWorld.x * 1.4, vWorld.y * 0.35 + uTime * 2.6));
  float fall2 = noise(vec2(vWorld.x * 3.2 + 7.0, vWorld.y * 0.8 + uTime * 3.4));
  vec3 col = mix(vec3(0.04, 0.22, 0.33), vec3(0.8, 0.97, 1.0), fall * 0.55 + fall2 * 0.35);
  gl_FragColor = vec4(col, 0.88);
}`;

function waterMat(frag: string, flow: number) {
  return new THREE.ShaderMaterial({
    vertexShader: WATER_VERT,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uFlow: { value: flow },
      uWallX: { value: RIVER.wallX },
    },
  });
}

export class WaterVisual {
  group = new THREE.Group();
  private mats: THREE.ShaderMaterial[] = [];
  private dock: THREE.Mesh;

  constructor() {
    const mk = (w: number, l: number, segW: number, segL: number, flow: number, frag = WATER_FRAG) => {
      const m = waterMat(frag, flow);
      this.mats.push(m);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, l, segW, segL), m);
      mesh.rotation.x = -Math.PI / 2;
      this.group.add(mesh);
      return mesh;
    };

    // dock (level animated by flood)
    this.dock = mk(RIVER.wallX * 2, 15.2, 8, 10, 0.3);
    this.dock.position.set(0, WATER.dockFrom, (RIVER.dockZ0 + RIVER.gateZ) / 2);

    // main river
    const riverLen = Z_WF - RIVER.gateZ;
    const river = mk(RIVER.wallX * 2, riverLen, 10, 190, 1.0);
    river.position.set(0, WATER.level, RIVER.gateZ + riverLen / 2);

    // pool + end chamber
    const poolLen = END.z1 - Z_WF;
    const pool = mk(RIVER.wallX * 2, poolLen, 8, 30, 0.35);
    pool.position.set(0, POOL.level, Z_WF + poolLen / 2);

    // waterfall sheet
    const fallH = WATER.level - POOL.level + 1;
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(RIVER.wallX * 2, fallH, 8, 24), waterMat(FALL_FRAG, 1));
    this.mats.push(fall.material as THREE.ShaderMaterial);
    fall.position.set(0, (WATER.level + POOL.level) / 2 - 0.4, Z_WF + 0.35);
    (fall.material as THREE.ShaderMaterial).side = THREE.DoubleSide;
    this.group.add(fall);
  }

  update(dt: number) {
    hydro.time += dt;
    for (const m of this.mats) m.uniforms.uTime.value = hydro.time;
    this.dock.position.y = waterLevelAt(0, RIVER.gateZ - 5) + 0.01;
  }
}
