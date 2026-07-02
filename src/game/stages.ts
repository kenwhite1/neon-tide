import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { R, world, addStaticBox } from '../engine/physics';
import { waterLevelAt } from '../engine/water';
import { DMG, END, PLOT, POOL, RIVER, STAGES, TIERS, Z_WF, tierOfStage, type ObSpec } from '../config';
import type { Fleet } from './boat';
import type { Particles } from '../engine/particles';
import type { Sfx } from '../engine/audio';

export interface DamageProfile {
  mult: number;
  minF: number;
}

const WALL_MAT = new THREE.MeshStandardMaterial({ color: 0x151b29, roughness: 0.5, metalness: 0.72 });
const DARK_MAT = new THREE.MeshStandardMaterial({ color: 0x0c111c, roughness: 0.8, metalness: 0.3 });
const ROCK_MAT = new THREE.MeshStandardMaterial({ color: 0x323a4d, roughness: 0.85, metalness: 0.15, flatShading: true });
const STEEL_MAT = new THREE.MeshStandardMaterial({ color: 0x9aa7b8, roughness: 0.35, metalness: 0.9 });
const HAZARD_MAT = new THREE.MeshStandardMaterial({ color: 0xff4d5e, emissive: 0xff2033, emissiveIntensity: 1.1, roughness: 0.4, metalness: 0.6 });

function emissiveMat(hex: number, intensity = 1.6) {
  return new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: intensity, roughness: 0.4, metalness: 0.2 });
}

function makeTextSprite(text: string, colorCss: string, w = 512, fontPx = 90): THREE.Sprite {
  const cnv = document.createElement('canvas');
  cnv.width = w;
  cnv.height = 160;
  const c = cnv.getContext('2d')!;
  c.font = `900 ${fontPx}px -apple-system, system-ui, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.shadowColor = colorCss;
  c.shadowBlur = 26;
  c.fillStyle = colorCss;
  c.fillText(text, w / 2, 84);
  const tex = new THREE.CanvasTexture(cnv);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  spr.scale.set(7, 2.2, 1);
  return spr;
}

interface Obstacle {
  z: number;
  update(dt: number, time: number, fleet: Fleet): void;
}

// ---------------------------------------------------------------- obstacles

class Axe implements Obstacle {
  z: number;
  private body: RAPIER.RigidBody;
  private pivot = new THREE.Group();
  private period: number;
  private phase: number;
  private L = 6.1;
  private amp = 1.12;
  private q = new THREE.Quaternion();
  private zAxis = new THREE.Vector3(0, 0, 1);

  constructor(parent: THREE.Group, reg: Map<number, DamageProfile>, z: number, period = 2.6, phase = 0) {
    this.z = z;
    this.period = period;
    this.phase = phase;
    this.pivot.position.set(0, 8.1, z);
    parent.add(this.pivot);

    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, this.L, 0.3), STEEL_MAT);
    arm.position.y = -this.L / 2;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(2.7, 2.1, 0.45), STEEL_MAT.clone());
    blade.position.y = -this.L;
    blade.castShadow = true;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.2, 0.5), HAZARD_MAT);
    edge.position.y = -this.L - 1.05;
    // crossbar mount
    const bar = new THREE.Mesh(new THREE.BoxGeometry(RIVER.wallX * 2 + 1.4, 0.45, 0.45), WALL_MAT);
    this.pivot.add(arm, blade, edge, bar);

    this.body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 8.1 - this.L, z));
    const col = world.createCollider(R.ColliderDesc.cuboid(1.35, 1.15, 0.25).setFriction(0.2), this.body);
    reg.set(col.handle, { mult: 2.4, minF: 2600 });
  }

  update(_dt: number, time: number) {
    const a = this.amp * Math.sin((time * Math.PI * 2) / this.period + this.phase);
    this.pivot.rotation.z = a;
    const x = this.L * Math.sin(a);
    const y = 8.1 - this.L * Math.cos(a);
    this.body.setNextKinematicTranslation({ x, y, z: this.z });
    this.q.setFromAxisAngle(this.zAxis, a);
    this.body.setNextKinematicRotation(this.q);
  }
}

class Saw implements Obstacle {
  z: number;
  private x: number;
  private r: number;
  private body: RAPIER.RigidBody;
  private disc: THREE.Group;
  private spin = 0;
  private q = new THREE.Quaternion();
  private qBase = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  private xAxis = new THREE.Vector3(1, 0, 0);
  private dpsClock = 0;

  constructor(
    parent: THREE.Group, reg: Map<number, DamageProfile>,
    x: number, z: number, r = 1.7,
    private particles: Particles, private sfx: Sfx,
  ) {
    this.z = z;
    this.x = x;
    this.r = r;
    this.disc = new THREE.Group();
    this.disc.position.set(x, 0.15, z);
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.28, 22), STEEL_MAT.clone());
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.09, 8, 26), HAZARD_MAT);
    rim.rotation.x = Math.PI / 2;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.4, 12), DARK_MAT);
    // teeth
    for (let i = 0; i < 8; i++) {
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 4), STEEL_MAT);
      const a = (i / 8) * Math.PI * 2;
      t.position.set(Math.cos(a) * (r + 0.2), 0, Math.sin(a) * (r + 0.2));
      t.rotation.z = -a - Math.PI / 2;
      t.rotateX(Math.PI / 2);
      this.disc.add(t);
    }
    this.disc.add(blade, rim, hub);
    // stand under the disc so the blade reads as slicing the river
    this.disc.rotation.z = Math.PI / 2; // disc plane YZ — thin from the side
    parent.add(this.disc);

    this.body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, 0.15, z));
    const col = world.createCollider(R.ColliderDesc.cylinder(0.14, r).setRotation(this.qBase).setFriction(0.1), this.body);
    reg.set(col.handle, { mult: 1.3, minF: 3200 });
  }

  update(dt: number, _time: number, fleet: Fleet) {
    this.spin += dt * 5.5;
    this.q.setFromAxisAngle(this.xAxis, this.spin).multiply(this.qBase);
    this.body.setNextKinematicRotation(this.q);
    this.disc.rotation.set(0, 0, Math.PI / 2);
    this.disc.rotateOnWorldAxis(this.xAxis, this.spin);

    this.dpsClock -= dt;
    let hitAny = false;
    fleet.forEachAliveBlock((p, b, c) => {
      const dx = Math.abs(p.x - this.x);
      const dr = Math.hypot(p.y - 0.15, p.z - this.z);
      if (dx < 0.72 && dr < this.r + 0.45) {
        hitAny = true;
        if (this.dpsClock <= 0) {
          b.iframe = 0;
          fleet.damageBlock(c, b, DMG.sawDps * 0.2);
          c.body.applyImpulseAtPoint({ x: Math.sign(p.x - this.x + 0.01) * 900, y: 500, z: -500 }, p, true);
        }
      }
    });
    if (hitAny && this.dpsClock <= 0) {
      this.dpsClock = 0.2;
      this.particles.spark(new THREE.Vector3(this.x, 0.6, this.z), 8);
      this.sfx.play('crack');
    }
  }
}

class Cannon implements Obstacle {
  z: number;
  private side: number;
  private barrel: THREE.Group;
  private tip: THREE.Mesh;
  private cooldown = 2;
  private telegraph = 0;
  private shots: { mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; age: number }[] = [];
  private tmp = new THREE.Vector3();

  constructor(
    private parent: THREE.Group, z: number, side: 1 | -1,
    private particles: Particles, private sfx: Sfx,
  ) {
    this.z = z;
    this.side = side;
    const x = side * (RIVER.wallX - 0.4);
    this.barrel = new THREE.Group();
    this.barrel.position.set(x, 2.4, z);
    const mount = new THREE.Mesh(new THREE.SphereGeometry(0.7, 14, 10), WALL_MAT);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 1.9, 12), STEEL_MAT.clone());
    tube.rotation.x = Math.PI / 2;
    tube.position.z = 0; // oriented by lookAt
    tube.position.set(0, 0, 0.8);
    this.tip = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.2, 12), emissiveMat(0xff8a2f, 0.4));
    this.tip.rotation.x = Math.PI / 2;
    this.tip.position.set(0, 0, 1.7);
    this.barrel.add(mount, tube, this.tip);
    parent.add(this.barrel);
  }

  update(dt: number, _time: number, fleet: Fleet) {
    // projectiles fly even when the cannon idles
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.age += dt;
      s.vel.y -= 13 * dt;
      s.pos.addScaledVector(s.vel, dt);
      s.mesh.position.copy(s.pos);
      let boom = s.age > 6 || s.pos.y < waterLevelAt(s.pos.x, s.pos.z) + 0.1;
      if (!boom) {
        fleet.forEachAliveBlock((p) => {
          if (!boom && p.distanceToSquared(s.pos) < 1.35) boom = true;
        });
      }
      if (boom) {
        fleet.explodeAt(s.pos, DMG.bomb.r, DMG.bomb.dmg, DMG.bomb.imp);
        if (s.pos.y < waterLevelAt(s.pos.x, s.pos.z) + 0.4) this.particles.splash(s.pos, 1.6);
        this.parent.remove(s.mesh);
        this.shots.splice(i, 1);
      }
    }

    const boat = fleet.primary;
    if (!boat) return;
    const t = boat.body.translation();
    const inRange = t.z > this.z - 34 && t.z < this.z + 30;
    if (!inRange) return;

    // aim with lead
    const lv = boat.body.linvel();
    const lead = Math.min(2, Math.max(0.7, Math.hypot(t.x - this.barrel.position.x, t.z - this.z) / 14));
    this.tmp.set(t.x + lv.x * lead * 0.7, t.y, t.z + lv.z * lead * 0.7);
    this.barrel.lookAt(this.tmp);

    this.cooldown -= dt;
    if (this.cooldown <= 0.55 && this.telegraph === 0) {
      this.telegraph = 1;
      (this.tip.material as THREE.MeshStandardMaterial).emissiveIntensity = 3.2;
    }
    if (this.cooldown <= 0) {
      this.cooldown = 3.4;
      this.telegraph = 0;
      (this.tip.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4;
      // fire!
      const from = this.barrel.localToWorld(new THREE.Vector3(0, 0, 1.9));
      const flight = lead;
      const vel = this.tmp.clone().sub(from).divideScalar(flight);
      vel.y += 0.5 * 13 * flight;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), emissiveMat(0xff8a2f, 0.9));
      mesh.position.copy(from);
      this.parent.add(mesh);
      this.shots.push({ mesh, pos: from.clone(), vel, age: 0 });
      this.particles.burst(from, { n: 10, colors: [0xffb36b, 0x8a93a6], speed: 2, up: 1.5, life: 0.5, size: 4 });
      this.sfx.play('cannon');
    }
  }
}

class Geyser implements Obstacle {
  z: number;
  private x: number;
  private phase: number;
  private ring: THREE.Mesh;
  private wasOn = false;

  constructor(parent: THREE.Group, x: number, z: number, phase = 0, private particles: Particles, private sfx: Sfx) {
    this.z = z;
    this.x = x;
    this.phase = phase;
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.14, 10, 24), emissiveMat(0x66e0ff, 0.7));
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.set(x, 0.12, z);
    parent.add(this.ring);
  }

  update(dt: number, time: number, fleet: Fleet) {
    const cycle = (time + this.phase) % 3.2;
    const on = cycle < 1.0;
    const mat = this.ring.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = on ? 2.6 : 0.5 + Math.max(0, (cycle - 2.4) / 0.8) * 2; // pulse telegraph

    if (on) {
      if (!this.wasOn) this.sfx.play('geyser');
      this.particles.geyserJet(this.ring.position);
      // impulses (not forces): the fleet resets user forces every substep
      fleet.forEachAliveBlock((p, _b, c) => {
        const d = Math.hypot(p.x - this.x, p.z - this.z);
        const h = p.y - 0;
        if (d < 1.6 && h > -1.2 && h < 6.5) {
          const f = (1 - Math.max(0, h) / 6.5) * 21000 * dt;
          c.body.applyImpulseAtPoint({ x: 0, y: f, z: 0 }, p, true);
        }
      });
    }
    this.wasOn = on;
  }
}

class SpikeStrip implements Obstacle {
  z: number;
  private zone: { x0: number; x1: number; z0: number; z1: number };
  private dpsClock = 0;

  constructor(parent: THREE.Group, reg: Map<number, DamageProfile>, spec: { x0: number; x1: number; z0: number; z1: number }, private particles: Particles) {
    this.zone = spec;
    this.z = (spec.z0 + spec.z1) / 2;
    const w = spec.x1 - spec.x0;
    const l = spec.z1 - spec.z0;
    const cx = (spec.x0 + spec.x1) / 2;

    const bed = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, l), new THREE.MeshStandardMaterial({ color: 0x351019, emissive: 0xff2033, emissiveIntensity: 0.35, roughness: 0.6 }));
    bed.position.set(cx, -0.42, this.z);
    parent.add(bed);
    const spikeGeo = new THREE.ConeGeometry(0.16, 0.85, 6);
    const n = Math.floor(w * l * 0.55);
    const inst = new THREE.InstancedMesh(spikeGeo, HAZARD_MAT, n);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      dummy.position.set(spec.x0 + Math.random() * w, -0.1 + Math.random() * 0.25, spec.z0 + Math.random() * l);
      dummy.rotation.y = Math.random() * Math.PI;
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    parent.add(inst);

    const { col } = addStaticBox(cx, -0.55, this.z, w / 2, 0.22, l / 2);
    reg.set(col.handle, { mult: 1.5, minF: 2400 });
  }

  update(dt: number, _time: number, fleet: Fleet) {
    this.dpsClock -= dt;
    if (this.dpsClock > 0) return;
    let hit: THREE.Vector3 | null = null;
    fleet.forEachAliveBlock((p, b, c) => {
      if (p.x > this.zone.x0 - 0.4 && p.x < this.zone.x1 + 0.4 && p.z > this.zone.z0 - 0.4 && p.z < this.zone.z1 + 0.4 && p.y - 0.5 < 0.35) {
        b.iframe = 0;
        fleet.damageBlock(c, b, DMG.spikeDps * 0.25);
        c.body.applyImpulse({ x: 0, y: 300, z: -240 }, true); // spikes rake and slow
        hit = p.clone();
      }
    });
    if (hit) {
      this.dpsClock = 0.25;
      this.particles.spark(hit, 5);
    }
  }
}

// ---------------------------------------------------------------- course

export class Course {
  group = new THREE.Group();
  damageReg = new Map<number, DamageProfile>();
  private obstacles: Obstacle[] = [];
  private gateBody!: RAPIER.RigidBody;
  private gateMesh!: THREE.Mesh;
  private gateT = 0;
  chest = new THREE.Group();
  private chestLid!: THREE.Group;
  private chestLight!: THREE.PointLight;
  private chestOpenT = 0;
  chestOpening = false;
  private mistClock = 0;

  constructor(private scene: THREE.Scene, private particles: Particles, private sfx: Sfx) {
    scene.add(this.group);
    this.build();
  }

  private reg(col: { handle: number }, p: DamageProfile) {
    this.damageReg.set(col.handle, p);
  }

  private build() {
    const g = this.group;
    const W = RIVER.wallX;

    // ---- plot + dock statics
    {
      const { col } = addStaticBox(0, PLOT.floorTop - 0.6, PLOT.cz, 6.3, 0.6, 6.3, { friction: 0.7 });
      this.reg(col, { mult: 0, minF: 1e9 });
      // dock floor + back wall
      addStaticBox(0, RIVER.floorY - 0.5, (RIVER.dockZ0 + RIVER.gateZ) / 2, W, 0.5, (RIVER.gateZ - RIVER.dockZ0) / 2 + 0.5);
      const back = addStaticBox(0, 2, RIVER.dockZ0 - 0.5, W, 5, 0.5);
      this.reg(back.col, { mult: 0.2, minF: 9000 });
    }

    // ---- the gate (kinematic so it can slide open)
    {
      this.gateBody = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.9, RIVER.gateZ));
      const col = world.createCollider(R.ColliderDesc.cuboid(W, 3.5, 0.35), this.gateBody);
      this.reg(col, { mult: 0.2, minF: 9000 });
      this.gateMesh = new THREE.Mesh(
        new THREE.BoxGeometry(W * 2, 7, 0.7),
        new THREE.MeshStandardMaterial({ color: 0x1a2334, roughness: 0.4, metalness: 0.8, emissive: 0x66e0ff, emissiveIntensity: 0.12 }),
      );
      this.gateMesh.position.set(0, 0.9, RIVER.gateZ);
      g.add(this.gateMesh);
      // gate frame pillars
      for (const sx of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 9, 0.9), WALL_MAT);
        p.position.set(sx * (W + 0.4), 1.5, RIVER.gateZ);
        g.add(p);
        const glow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 9, 0.2), emissiveMat(0x66e0ff));
        glow.position.set(sx * (W + 0.1), 1.5, RIVER.gateZ);
        g.add(glow);
      }
    }

    // ---- river floor
    addStaticBox(0, RIVER.floorY - 0.5, Z_WF / 2, W, 0.5, Z_WF / 2 + 0.2);
    // pool + end chamber floor
    addStaticBox(0, POOL.floorY - 0.5, (Z_WF + END.z1) / 2, W, 0.5, (END.z1 - Z_WF) / 2 + 0.5);
    // waterfall cliff face (under the lip, so wrecks don't tunnel)
    addStaticBox(0, (RIVER.floorY + POOL.floorY) / 2, Z_WF + 0.1, W, (RIVER.floorY - POOL.floorY) / 2 + 0.5, 0.6);

    // ---- channel walls (visual per zone, colliders long)
    const wallDefs = [
      { z0: RIVER.dockZ0, z1: 0, tier: -1 },
      ...Array.from({ length: RIVER.stages }, (_, i) => ({ z0: i * RIVER.stageLen, z1: (i + 1) * RIVER.stageLen, tier: tierOfStage(i) })),
      { z0: Z_WF, z1: END.z1, tier: -2 },
    ];
    for (const wd of wallDefs) {
      const len = wd.z1 - wd.z0;
      const cz = (wd.z0 + wd.z1) / 2;
      const isPool = wd.tier === -2;
      const yBot = isPool ? POOL.floorY : RIVER.floorY;
      const h = (isPool ? 10 : 9) - yBot;
      for (const sx of [-1, 1]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(1.1, h, len), WALL_MAT);
        wall.position.set(sx * (W + 0.55), yBot + h / 2, cz);
        wall.receiveShadow = true;
        g.add(wall);
        const { col } = addStaticBox(sx * (W + 0.55), yBot + h / 2, cz, 0.55, h / 2, len / 2);
        this.reg(col, { mult: 0.4, minF: 7500 });
        // neon trim: waterline + top
        const tierColor = wd.tier >= 0 ? TIERS[wd.tier].color : wd.tier === -2 ? 0xffc94d : 0x66e0ff;
        const lvl = isPool ? POOL.level : 0;
        for (const ty of [lvl + 0.55, yBot + h - 0.3]) {
          const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, len - 0.5), emissiveMat(tierColor, 1.4));
          strip.position.set(sx * (W + 0.05), ty, cz);
          g.add(strip);
        }
      }
    }

    // ---- stage gates + arcs + markers
    for (let i = 0; i < RIVER.stages; i++) {
      const z = i * RIVER.stageLen;
      const tier = TIERS[tierOfStage(i)];
      for (const sx of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8.5, 0.7), WALL_MAT);
        pillar.position.set(sx * (W - 0.2), RIVER.floorY + 4.2, z);
        g.add(pillar);
        const glow = new THREE.Mesh(new THREE.BoxGeometry(0.18, 8.5, 0.18), emissiveMat(tier.color, 1.8));
        glow.position.set(sx * (W - 0.55), RIVER.floorY + 4.2, z);
        g.add(glow);
      }
      const arc = new THREE.Mesh(new THREE.TorusGeometry(W - 0.3, 0.13, 8, 40, Math.PI), emissiveMat(tier.color, 1.5));
      arc.position.set(0, 0.2, z);
      g.add(arc);
      const label = makeTextSprite(`STAGE ${i + 1}`, tier.css);
      label.position.set(0, 7.6, z);
      g.add(label);
    }

    // ---- obstacles from data
    for (let i = 0; i < STAGES.length; i++) {
      const z0 = i * RIVER.stageLen;
      for (const spec of STAGES[i]) this.buildObstacle(spec, z0);
    }

    // ---- waterfall lip trim + THE END
    {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(W * 2, 0.18, 0.18), emissiveMat(0xffffff, 1.6));
      lip.position.set(0, 0.1, Z_WF - 0.2);
      this.group.add(lip);

      // spikes in the plunge pool
      const rows: [number, number[]][] = [
        [Z_WF + 14, [-5, 0, 5]],
        [Z_WF + 24, [-2.5, 2.5]],
        [Z_WF + 32, [0]],
      ];
      for (const [z, xs] of rows) {
        for (const x of xs) {
          const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 6, 10), ROCK_MAT);
          pil.position.set(x, POOL.floorY + 3, z);
          g.add(pil);
          const tip = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 10), HAZARD_MAT);
          tip.position.set(x, POOL.floorY + 6.7, z);
          g.add(tip);
          const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, POOL.floorY + 3.6, z));
          const col = world.createCollider(R.ColliderDesc.cylinder(3.7, 0.62), body);
          this.reg(col, { mult: 2.1, minF: 2400 });
        }
      }

      // end gate
      for (const sx of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 10, 0.9), WALL_MAT);
        p.position.set(sx * (W - 0.2), POOL.level + 4.4, END.gateZ);
        g.add(p);
        const glow = new THREE.Mesh(new THREE.BoxGeometry(0.22, 10, 0.22), emissiveMat(0xffc94d, 2));
        glow.position.set(sx * (W - 0.6), POOL.level + 4.4, END.gateZ);
        g.add(glow);
      }
      const endLabel = makeTextSprite('THE END', '#ffc94d');
      endLabel.position.set(0, POOL.level + 10.4, END.gateZ);
      g.add(endLabel);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(W * 2, 0.7, 0.7), WALL_MAT);
      bar.position.set(0, POOL.level + 9.2, END.gateZ);
      g.add(bar);

      // end chamber back wall
      const bw = addStaticBox(0, POOL.level + 3, END.z1 + 0.5, W, 8, 0.6);
      this.reg(bw.col, { mult: 0.1, minF: 1e7 });
      const bwm = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 2, 16, 1.2), WALL_MAT);
      bwm.position.set(0, POOL.level + 3, END.z1 + 0.9);
      g.add(bwm);

      // treasure platform
      const platTop = POOL.level + 0.7;
      const plat = addStaticBox(0, platTop - 1.1, END.chestZ + 6, W - 0.8, 1.1, 8);
      this.reg(plat.col, { mult: 0, minF: 1e9 });
      const platMesh = new THREE.Mesh(new THREE.BoxGeometry((W - 0.8) * 2, 2.2, 16), new THREE.MeshStandardMaterial({ color: 0x2a2010, roughness: 0.4, metalness: 0.8 }));
      platMesh.position.set(0, platTop - 1.1, END.chestZ + 6);
      g.add(platMesh);
      const platTrim = new THREE.Mesh(new THREE.BoxGeometry((W - 0.8) * 2, 0.15, 0.15), emissiveMat(0xffc94d, 2));
      platTrim.position.set(0, platTop, END.chestZ - 2);
      g.add(platTrim);

      this.buildChest(new THREE.Vector3(0, platTop, END.chestZ + 2));

      // golden chamber lights
      for (const [x, z] of [[-4, END.chestZ], [4, END.chestZ]]) {
        const l = new THREE.PointLight(0xffc94d, 60, 30, 1.8);
        l.position.set(x, POOL.level + 6, z);
        g.add(l);
      }
    }
  }

  private buildObstacle(spec: ObSpec, z0: number) {
    const g = this.group;
    switch (spec.t) {
      case 'rock': {
        const s = spec.s ?? 1;
        const z = z0 + spec.z;
        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35 * s, 1), ROCK_MAT);
        rock.position.set(spec.x, -0.35 * s, z);
        rock.rotation.set(Math.random() * 3, Math.random() * 3, 0);
        rock.castShadow = true;
        g.add(rock);
        const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(spec.x, -0.35 * s, z));
        const col = world.createCollider(R.ColliderDesc.ball(1.18 * s).setFriction(0.4), body);
        this.reg(col, { mult: 0.85, minF: 5200 });
        break;
      }
      case 'wall': {
        const z = z0 + spec.z;
        const W = RIVER.wallX;
        const g0 = spec.gapX - spec.gapW / 2;
        const g1 = spec.gapX + spec.gapW / 2;
        for (const [a, b] of [[-W, g0], [g1, W]] as [number, number][]) {
          if (b - a < 0.3) continue;
          const cx = (a + b) / 2;
          const w = b - a;
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 3.6, 1), WALL_MAT);
          mesh.position.set(cx, -0.4, z);
          mesh.castShadow = true;
          g.add(mesh);
          const trim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, 1.06), emissiveMat(0xff8a2f, 1.2));
          trim.position.set(cx, 1.35, z);
          g.add(trim);
          const { col } = addStaticBox(cx, -0.4, z, w / 2, 1.8, 0.5);
          this.reg(col, { mult: 1.0, minF: 4000 });
        }
        break;
      }
      case 'axe':
        this.obstacles.push(new Axe(g, this.damageReg, z0 + spec.z, spec.period ?? 2.6, spec.phase ?? 0));
        break;
      case 'saw':
        this.obstacles.push(new Saw(g, this.damageReg, spec.x, z0 + spec.z, spec.r ?? 1.7, this.particles, this.sfx));
        break;
      case 'cannon':
        this.obstacles.push(new Cannon(g, z0 + spec.z, spec.side, this.particles, this.sfx));
        break;
      case 'geyser':
        this.obstacles.push(new Geyser(g, spec.x, z0 + spec.z, spec.phase ?? 0, this.particles, this.sfx));
        break;
      case 'spikes':
        this.obstacles.push(new SpikeStrip(g, this.damageReg, { x0: spec.x0, x1: spec.x1, z0: z0 + spec.z0, z1: z0 + spec.z1 }, this.particles));
        break;
      case 'ceiling': {
        const z = z0 + spec.z;
        const h = spec.h ?? 2.7;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(RIVER.wallX * 2, 0.8, 1.6), WALL_MAT);
        mesh.position.set(0, h + 0.4, z);
        mesh.castShadow = true;
        g.add(mesh);
        const warn = new THREE.Mesh(new THREE.BoxGeometry(RIVER.wallX * 2, 0.14, 1.7), HAZARD_MAT);
        warn.position.set(0, h, z);
        g.add(warn);
        const { col } = addStaticBox(0, h + 0.4, z, RIVER.wallX, 0.4, 0.8);
        this.reg(col, { mult: 2.6, minF: 2200 });
        break;
      }
    }
  }

  private buildChest(at: THREE.Vector3) {
    this.chest.position.copy(at);
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.6, metalness: 0.2 });
    const goldTrim = new THREE.MeshStandardMaterial({ color: 0xffc94d, roughness: 0.25, metalness: 1, emissive: 0x664400, emissiveIntensity: 0.2 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, 1.6), wood);
    base.position.y = 0.65;
    base.castShadow = true;
    for (const dy of [0.25, 1.05]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.18, 1.7), goldTrim);
      band.position.y = dy;
      this.chest.add(band);
    }
    this.chestLid = new THREE.Group();
    this.chestLid.position.set(0, 1.3, -0.8);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.55, 1.6), wood);
    lid.position.set(0, 0.27, 0.8);
    lid.castShadow = true;
    const lidBand = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.2, 0.4), goldTrim);
    lidBand.position.set(0, 0.3, 0.8);
    this.chestLid.add(lid, lidBand);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 1.4), emissiveMat(0xffe08a, 3));
    glow.position.y = 1.32;
    const coins = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffd76b, roughness: 0.3, metalness: 1, emissive: 0x664400, emissiveIntensity: 0.4 }));
    coins.scale.set(1.1, 0.45, 0.7);
    coins.position.y = 1.35;
    this.chestLight = new THREE.PointLight(0xffd76b, 0, 18, 1.6);
    this.chestLight.position.set(0, 2.4, 0);
    this.chest.add(base, this.chestLid, glow, coins, this.chestLight);
    this.group.add(this.chest);
  }

  setGate(t: number) {
    this.gateT = t;
    const y = 0.9 - t * 8.2;
    this.gateBody.setNextKinematicTranslation({ x: 0, y, z: RIVER.gateZ });
    this.gateMesh.position.y = y;
  }

  startChestOpen() {
    this.chestOpening = true;
    this.sfx.play('chest');
  }

  resetChest() {
    this.chestOpening = false;
    this.chestOpenT = 0;
    this.chestLid.rotation.x = 0;
    this.chestLight.intensity = 0;
  }

  stageOfZ(z: number) {
    if (z < 0) return 0;
    return Math.min(RIVER.stages, Math.floor(z / RIVER.stageLen) + 1);
  }

  update(dt: number, time: number, fleet: Fleet | null, boatZ: number) {
    if (fleet?.spawned) {
      for (const ob of this.obstacles) {
        if (Math.abs(ob.z - boatZ) < 95) ob.update(dt, time, fleet);
      }
      // waterfall mist
      this.mistClock -= dt;
      if (boatZ > Z_WF - 40 && boatZ < Z_WF + 50 && this.mistClock <= 0) {
        this.mistClock = 0.12;
        this.particles.splash(new THREE.Vector3((Math.random() - 0.5) * RIVER.wallX * 2, POOL.level + 0.3, Z_WF + 1.5 + Math.random() * 2), 1.2);
      }
    }
    if (this.chestOpening && this.chestOpenT < 1) {
      this.chestOpenT = Math.min(1, this.chestOpenT + dt * 1.1);
      const e = 1 - Math.pow(1 - this.chestOpenT, 3);
      this.chestLid.rotation.x = -e * 1.85;
      this.chestLight.intensity = e * 140;
      if (Math.random() < 0.5) this.particles.goldBurst(this.chest.position.clone().add(new THREE.Vector3(0, 1.6, 0)), false);
    }
  }
}
