import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { R, world } from '../engine/physics';
import { currentAt, waterLevelAt } from '../engine/water';
import { BLOCKS, DMG, PHYS, PLOT, TEAM_COLORS } from '../config';
import { Emitter, keyOf, type BlockKind, type Design, type PlacedBlock } from '../types';
import { makeBlockGroup } from './blocks';
import type { Particles } from '../engine/particles';
import type { Sfx } from '../engine/audio';

const V = new THREE.Vector3();
const V2 = new THREE.Vector3();
const Q = new THREE.Quaternion();

export interface LiveBlock {
  pb: PlacedBlock;
  hp: number;
  maxHp: number;
  alive: boolean;
  iframe: number;
  flash: number;
  group: THREE.Group;
  colHandle: number;
  wasUnder: boolean;
}

export class Cluster {
  body: RAPIER.RigidBody;
  group = new THREE.Group();
  blocks: LiveBlock[] = [];
  isWreck = false;
  age = 0;

  constructor(scene: THREE.Scene, translation: THREE.Vector3, rotation?: THREE.Quaternion) {
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(translation.x, translation.y, translation.z)
      .setLinearDamping(0.06)
      .setAngularDamping(0.4)
      .setCcdEnabled(true);
    if (rotation) desc.setRotation(rotation);
    this.body = world.createRigidBody(desc);
    scene.add(this.group);
    this.group.position.copy(translation);
    if (rotation) this.group.quaternion.copy(rotation);
  }

  aliveCount() {
    let n = 0;
    for (const b of this.blocks) if (b.alive) n++;
    return n;
  }

  hasAliveSeat() {
    return this.blocks.some((b) => b.alive && b.pb.kind === 'seat');
  }

  syncMesh() {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.group.position.set(t.x, t.y, t.z);
    this.group.quaternion.set(r.x, r.y, r.z, r.w);
  }

  worldPosOf(b: LiveBlock, out: THREE.Vector3) {
    const t = this.body.translation();
    const r = this.body.rotation();
    Q.set(r.x, r.y, r.z, r.w);
    out.set(b.pb.gx, b.pb.gy, b.pb.gz).applyQuaternion(Q);
    out.x += t.x;
    out.y += t.y;
    out.z += t.z;
    return out;
  }
}

export interface FleetFx {
  particles: Particles;
  sfx: Sfx;
  shake: (m: number) => void;
  haptic: (k: 'light' | 'medium' | 'heavy') => void;
}

/**
 * All floating block-bodies in a run: the boat plus any chunks that broke off.
 * Applies buoyancy/current forces, routes damage, splits clusters on breakage.
 */
export class Fleet extends Emitter {
  clusters: Cluster[] = [];
  primary: Cluster | null = null;
  colliderMap = new Map<number, { c: Cluster; b: LiveBlock }>();
  placedCount = 0;
  lostCount = 0;
  materialsUsed = new Set<BlockKind>();
  /** block keys broken since the last multiplayer sync packet */
  removedSinceSync: string[] = [];
  private explodeQueue: { pos: THREE.Vector3; delay: number; r: number; dmg: number; imp: number }[] = [];
  private lastSplashSfx = 0;
  teamColor = 0x66e0ff;

  constructor(private scene: THREE.Scene, private fx: FleetFx) {
    super();
  }

  get spawned() {
    return this.clusters.length > 0;
  }

  spawn(design: Design, teamColorIdx = 0) {
    this.despawn();
    this.teamColor = TEAM_COLORS[teamColorIdx] ?? 0x66e0ff;
    this.placedCount = design.length;
    this.lostCount = 0;
    this.materialsUsed = new Set(design.map((b) => b.kind));

    // split the design into connected components — free-floating build pieces
    // launch as independent bodies
    const byKey = new Map<string, PlacedBlock>();
    for (const pb of design) byKey.set(keyOf(pb.gx, pb.gy, pb.gz), pb);
    const seen = new Set<string>();
    const components: PlacedBlock[][] = [];
    for (const pb of design) {
      const k0 = keyOf(pb.gx, pb.gy, pb.gz);
      if (seen.has(k0)) continue;
      const comp: PlacedBlock[] = [];
      const stack = [k0];
      seen.add(k0);
      while (stack.length) {
        const k = stack.pop()!;
        const b = byKey.get(k)!;
        comp.push(b);
        for (const [dx, dy, dz] of NEIGHBORS) {
          const nk = keyOf(b.gx + dx, b.gy + dy, b.gz + dz);
          if (byKey.has(nk) && !seen.has(nk)) {
            seen.add(nk);
            stack.push(nk);
          }
        }
      }
      components.push(comp);
    }
    components.sort((a, b) => Number(b.some((x) => x.kind === 'seat')) - Number(a.some((x) => x.kind === 'seat')) || b.length - a.length);

    const origin = new THREE.Vector3(0, PLOT.floorTop + 0.5, PLOT.cz);
    for (const comp of components) {
      const c = new Cluster(this.scene, origin);
      for (const pb of comp) this.addBlockTo(c, pb);
      this.clusters.push(c);
    }
    this.primary = this.clusters[0] ?? null;
  }

  private addBlockTo(c: Cluster, pb: PlacedBlock) {
    const def = BLOCKS[pb.kind];
    const col = world.createCollider(
      R.ColliderDesc.cuboid(0.48, 0.48, 0.48)
        .setTranslation(pb.gx, pb.gy, pb.gz)
        .setDensity(def.density)
        .setFriction(0.5)
        .setRestitution(0.14)
        .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(2000),
      c.body,
    );
    const group = makeBlockGroup(pb.kind, this.teamColor);
    group.position.set(pb.gx, pb.gy, pb.gz);
    group.rotation.y = (pb.rot * Math.PI) / 2;
    c.group.add(group);
    const b: LiveBlock = {
      pb, hp: def.hp, maxHp: def.hp, alive: true, iframe: 0, flash: 0, group, colHandle: col.handle, wasUnder: false,
    };
    c.blocks.push(b);
    this.colliderMap.set(col.handle, { c, b });
    return b;
  }

  despawn() {
    for (const c of this.clusters) {
      this.scene.remove(c.group);
      world.removeRigidBody(c.body);
    }
    this.clusters = [];
    this.primary = null;
    this.colliderMap.clear();
    this.explodeQueue.length = 0;
  }

  /** Per-physics-substep: buoyancy, water drag, current, balloons, angular damping. */
  applyHydro(dt: number) {
    for (const c of this.clusters) {
      c.age += dt;
      const rb = c.body;
      rb.resetForces(true);
      rb.resetTorques(true);
      const lv = rb.linvel();
      const av = rb.angvel();
      const t = rb.translation();
      const rot = rb.rotation();
      Q.set(rot.x, rot.y, rot.z, rot.w);
      let submerged = 0;

      for (const b of this.blocks_of(c)) {
        if (!b.alive) continue;
        V.set(b.pb.gx, b.pb.gy, b.pb.gz).applyQuaternion(Q);
        const px = V.x + t.x, py = V.y + t.y, pz = V.z + t.z;
        const rx = V.x, ry = V.y, rz = V.z; // lever arm from body origin
        const lvl = waterLevelAt(px, pz);
        const frac = Math.max(0, Math.min(1, lvl - (py - 0.5)));

        // splash on entry
        const under = frac > 0.25;
        if (under && !b.wasUnder && lv.y < -3) {
          this.fx.particles.splash(V2.set(px, lvl + 0.1, pz), Math.min(2.2, -lv.y * 0.22));
          const now = performance.now();
          if (now - this.lastSplashSfx > 160) {
            this.fx.sfx.play('splash');
            this.lastSplashSfx = now;
          }
        }
        b.wasUnder = under;

        if (frac > 0) {
          submerged += frac;
          // point velocity = linvel + angvel x r
          const vx = lv.x + (av.y * rz - av.z * ry);
          const vy = lv.y + (av.z * rx - av.x * rz);
          const vz = lv.z + (av.x * ry - av.y * rx);
          currentAt(px, py, pz, V2);
          const fx = (V2.x - vx) * PHYS.dragH * frac;
          const fy = (V2.y - vy) * PHYS.dragV * frac + PHYS.buoyN * frac;
          const fz = (V2.z - vz) * PHYS.dragH * frac;
          rb.addForceAtPoint({ x: fx, y: fy, z: fz }, { x: px, y: py, z: pz }, true);
        }
        if (b.pb.kind === 'balloon') {
          rb.addForceAtPoint({ x: 0, y: PHYS.balloonLift, z: 0 }, { x: px, y: py, z: pz }, true);
        }
      }

      if (submerged > 0) {
        rb.addTorque(
          { x: -av.x * PHYS.angDamp * submerged, y: -av.y * PHYS.angDamp * submerged * 0.55, z: -av.z * PHYS.angDamp * submerged },
          true,
        );
      }
      // arcade clamp: don't let the boat helicopter
      const am = Math.hypot(av.x, av.y, av.z);
      if (am > PHYS.maxAngVel * 2.2) {
        const s = (PHYS.maxAngVel * 2.2) / am;
        rb.setAngvel({ x: av.x * s, y: av.y * s, z: av.z * s }, true);
      }
      (c as any)._submerged = submerged;
    }

    // delayed TNT chain
    for (let i = this.explodeQueue.length - 1; i >= 0; i--) {
      const e = this.explodeQueue[i];
      e.delay -= dt;
      if (e.delay <= 0) {
        this.explodeQueue.splice(i, 1);
        this.explodeAt(e.pos, e.r, e.dmg, e.imp);
      }
    }
  }

  private blocks_of(c: Cluster) {
    return c.blocks;
  }

  submergedOf(c: Cluster): number {
    return (c as any)._submerged ?? 0;
  }

  tickVisual(dt: number) {
    for (const c of this.clusters) {
      c.syncMesh();
      for (const b of c.blocks) {
        if (!b.alive) continue;
        if (b.iframe > 0) b.iframe -= dt;
        if (b.flash > 0) {
          b.flash = Math.max(0, b.flash - dt * 5);
          (b.group.userData.tint as (f: number, fl: number) => void)(b.hp / b.maxHp, b.flash);
        }
      }
    }
  }

  /** Damage routed from contact events / obstacle volumes. */
  damageCollider(handle: number, amount: number) {
    const hit = this.colliderMap.get(handle);
    if (!hit) return;
    this.damageBlock(hit.c, hit.b, amount);
  }

  damageBlock(c: Cluster, b: LiveBlock, amount: number) {
    if (!b.alive || b.iframe > 0 || amount <= 0) return;
    b.iframe = DMG.iframes;
    b.hp -= Math.min(DMG.maxHit, amount);
    b.flash = 1;
    (b.group.userData.tint as (f: number, fl: number) => void)(Math.max(0, b.hp / b.maxHp), b.flash);
    if (b.hp <= 0) this.killBlock(c, b);
    else if (amount > 6) {
      this.fx.sfx.play('crack');
      this.fx.haptic('light');
    }
  }

  killBlock(c: Cluster, b: LiveBlock) {
    if (!b.alive) return;
    b.alive = false;
    this.lostCount++;
    this.removedSinceSync.push(keyOf(b.pb.gx, b.pb.gy, b.pb.gz));
    this.worldPosOf_(c, b, V);

    // TNT goes out with a bang
    if (b.pb.kind === 'tnt') {
      this.explodeQueue.push({ pos: V.clone(), delay: 0.08, r: DMG.tnt.r, dmg: DMG.tnt.dmg, imp: DMG.tnt.imp });
    }

    const col = world.getCollider(b.colHandle);
    if (col) world.removeCollider(col, true);
    this.colliderMap.delete(b.colHandle);
    c.group.remove(b.group);
    const def = BLOCKS[b.pb.kind];
    this.fx.particles.debrisBurst(V, def.color, 5, 1, def.density > 1000);
    this.fx.particles.spark(V, 6);
    if (V.y < waterLevelAt(V.x, V.z) + 0.6) this.fx.particles.splash(V, 1);
    this.fx.sfx.play('break');
    this.fx.haptic('medium');
    this.fx.shake(0.3);
    this.emit('blockLost', b, c);

    this.splitCheck(c);
  }

  private worldPosOf_(c: Cluster, b: LiveBlock, out: THREE.Vector3) {
    return c.worldPosOf(b, out);
  }

  explodeAt(pos: THREE.Vector3, r: number, dmg: number, imp: number) {
    this.fx.particles.explosion(pos, r / 2.3);
    this.fx.sfx.play('explosion');
    this.fx.haptic('heavy');
    this.fx.shake(0.9);
    const tmp = new THREE.Vector3();
    for (const c of [...this.clusters]) {
      for (const b of [...c.blocks]) {
        if (!b.alive) continue;
        c.worldPosOf(b, tmp);
        const d = tmp.distanceTo(pos);
        if (d < r) {
          const f = 1 - d / r;
          tmp.sub(pos);
          if (tmp.lengthSq() < 0.001) tmp.set(0, 1, 0);
          tmp.normalize().multiplyScalar(imp * f);
          c.body.applyImpulseAtPoint({ x: tmp.x, y: tmp.y * 0.7 + imp * f * 0.35, z: tmp.z }, c.worldPosOf(b, V2), true);
          b.iframe = 0;
          this.damageBlock(c, b, dmg * f);
        }
      }
    }
    this.emit('explosion', pos);
  }

  /** After a block dies: detach any parts no longer connected to the anchor. */
  private splitCheck(c: Cluster) {
    const alive = c.blocks.filter((b) => b.alive);
    if (alive.length === 0) return;
    const byKey = new Map<string, LiveBlock>();
    for (const b of alive) byKey.set(keyOf(b.pb.gx, b.pb.gy, b.pb.gz), b);

    const comps: LiveBlock[][] = [];
    const seen = new Set<string>();
    for (const b of alive) {
      const k0 = keyOf(b.pb.gx, b.pb.gy, b.pb.gz);
      if (seen.has(k0)) continue;
      const comp: LiveBlock[] = [];
      const stack = [k0];
      seen.add(k0);
      while (stack.length) {
        const k = stack.pop()!;
        const bb = byKey.get(k)!;
        comp.push(bb);
        for (const [dx, dy, dz] of NEIGHBORS) {
          const nk = keyOf(bb.pb.gx + dx, bb.pb.gy + dy, bb.pb.gz + dz);
          if (byKey.has(nk) && !seen.has(nk)) {
            seen.add(nk);
            stack.push(nk);
          }
        }
      }
      comps.push(comp);
    }
    if (comps.length <= 1) return;

    // keep the component with a seat (or the largest) on the existing body
    comps.sort((a, b) => Number(b.some((x) => x.pb.kind === 'seat')) - Number(a.some((x) => x.pb.kind === 'seat')) || b.length - a.length);
    const t = c.body.translation();
    const r = c.body.rotation();
    const lv = c.body.linvel();
    const avel = c.body.angvel();

    for (let i = 1; i < comps.length; i++) {
      const comp = comps[i];
      const nc = new Cluster(this.scene, V.set(t.x, t.y, t.z), Q.set(r.x, r.y, r.z, r.w));
      nc.isWreck = !comp.some((x) => x.pb.kind === 'seat');
      nc.body.setLinvel(lv, true);
      nc.body.setAngvel(avel, true);
      for (const b of comp) {
        // strip from old body
        const oldCol = world.getCollider(b.colHandle);
        if (oldCol) world.removeCollider(oldCol, true);
        this.colliderMap.delete(b.colHandle);
        c.group.remove(b.group);
        c.blocks.splice(c.blocks.indexOf(b), 1);
        // graft onto the new one (same local frame — new body copied the old pose)
        const def = BLOCKS[b.pb.kind];
        const col = world.createCollider(
          R.ColliderDesc.cuboid(0.48, 0.48, 0.48)
            .setTranslation(b.pb.gx, b.pb.gy, b.pb.gz)
            .setDensity(def.density)
            .setFriction(0.5)
            .setRestitution(0.14)
            .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
            .setContactForceEventThreshold(2000),
          nc.body,
        );
        b.colHandle = col.handle;
        nc.group.add(b.group);
        nc.blocks.push(b);
        this.colliderMap.set(col.handle, { c: nc, b });
      }
      nc.syncMesh();
      this.clusters.push(nc);
    }
    this.emit('split', c);

    // primary follows the seat
    if (this.primary && !this.primary.hasAliveSeat()) {
      const withSeat = this.clusters.find((cl) => cl.hasAliveSeat());
      if (withSeat) {
        this.primary = withSeat;
        this.emit('primarySwitch', withSeat);
      }
    }
  }

  /** Cull far-behind wrecks so physics stays cheap. */
  cullWrecks(boatZ: number) {
    for (let i = this.clusters.length - 1; i >= 0; i--) {
      const c = this.clusters[i];
      if (c === this.primary) continue;
      const t = c.body.translation();
      const far = t.z < boatZ - 55 || t.y < -60 || c.age > 40;
      const wreckLimit = this.clusters.length > 6 && c.isWreck && c.age > 8;
      if ((c.isWreck && far) || wreckLimit) {
        this.scene.remove(c.group);
        world.removeRigidBody(c.body);
        for (const b of c.blocks) this.colliderMap.delete(b.colHandle);
        this.clusters.splice(i, 1);
      }
    }
  }

  /** Replicated breakage on multiplayer guests. */
  killByKey(key: string) {
    for (const c of this.clusters) {
      for (const b of c.blocks) {
        if (b.alive && keyOf(b.pb.gx, b.pb.gy, b.pb.gz) === key) {
          this.killBlock(c, b);
          return;
        }
      }
    }
  }

  firstAliveSeat(): { c: Cluster; b: LiveBlock } | null {
    if (this.primary) {
      const b = this.primary.blocks.find((b) => b.alive && b.pb.kind === 'seat');
      if (b) return { c: this.primary, b };
    }
    for (const c of this.clusters) {
      const b = c.blocks.find((b) => b.alive && b.pb.kind === 'seat');
      if (b) return { c, b };
    }
    return null;
  }

  aliveOf(kind: BlockKind): { c: Cluster; b: LiveBlock }[] {
    const out: { c: Cluster; b: LiveBlock }[] = [];
    for (const c of this.clusters)
      for (const b of c.blocks) if (b.alive && b.pb.kind === kind) out.push({ c, b });
    return out;
  }

  forEachAliveBlock(cb: (pos: THREE.Vector3, b: LiveBlock, c: Cluster) => void) {
    const tmp = new THREE.Vector3();
    for (const c of this.clusters)
      for (const b of c.blocks) {
        if (!b.alive) continue;
        c.worldPosOf(b, tmp);
        cb(tmp, b, c);
      }
  }
}

const NEIGHBORS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
