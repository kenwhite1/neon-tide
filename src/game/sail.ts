import * as THREE from 'three';
import { DMG, ECON, END, PHYS, TEAM_COLORS, Z_WF } from '../config';
import type { BlockKind, Design, RunStats, XfPacket } from '../types';
import { net } from '../net/net';
import { hydro, waterLevelAt } from '../engine/water';
import type { ContactHit } from '../engine/physics';
import { Fleet, type Cluster, type LiveBlock } from './boat';
import type { Course } from './stages';
import type { GameState } from './state';
import type { Hud } from '../ui/hud';
import type { Controls } from './controls';
import type { CameraRig } from './cameras';
import type { Particles } from '../engine/particles';
import type { Sfx } from '../engine/audio';
import type { Builder } from './builder';
import { makeAvatar } from './blocks';
import { tg } from '../telegram';
import { newRunId, reportRun } from '../gg';

const V = new THREE.Vector3();

// Из чего сложен корпус (сиденья/рули/двигатели — оснастка, не материал).
const MATERIALS = new Set<BlockKind>(['wood', 'plastic', 'metal', 'gold']);

export interface SailDeps {
  fleet: Fleet;
  course: Course;
  state: GameState;
  hud: Hud;
  controls: Controls;
  cameraRig: CameraRig;
  particles: Particles;
  sfx: Sfx;
  builder: Builder;
}

/** Orchestrates a run: flood → countdown → sail → wreck/treasure → summary. */
export class Sail {
  active = false;
  sailing = false;
  private launchT = 0;
  private cdShown = -1;
  private t = 0;
  runStage = 0;
  goldEarned = 0;
  private thrustTimer = 0;
  private thrustCd = 0;
  private jumpCd = 0;
  private drownT = 0;
  private lastProgressZ = 0;
  private lastProgressT = 0;
  private wakeClock = 0;
  private avatar: THREE.Group | null = null;
  private avatarSeat: LiveBlock | null = null;
  private seatIdx = 0;
  private treasureStarted = false;
  private boatPos = new THREE.Vector3(0, 0, -8);
  private boatVel = new THREE.Vector3();
  isGuest = false;
  private remoteSteer = new Map<string, number>();
  private xfClock = 0;
  private inputClock = 0;
  /** id текущего заплыва — ключ дедупа отчёта хабу GG. */
  private runId = '';

  constructor(private d: SailDeps) {
    d.fleet.on('blockLost', (b: LiveBlock) => {
      if (b === this.avatarSeat) this.reseat(true);
      this.d.hud.setHull(this.hullFrac());
    });
    d.fleet.on('primarySwitch', () => {
      this.d.hud.toast('Лодка раскололась! Летим за сиденьем');
      this.d.cameraRig.shake(0.4);
    });
    d.controls.onBoost = () => this.fireBoost();
    d.controls.onJump = () => this.jump();
  }

  hullFrac() {
    return this.d.fleet.placedCount ? 1 - this.d.fleet.lostCount / this.d.fleet.placedCount : 1;
  }

  begin(design: Design, isGuest = false) {
    this.isGuest = isGuest;
    this.remoteSteer.clear();
    const { state, fleet, course, hud, cameraRig, builder, controls, sfx } = this.d;
    state.setPhase('launching');
    builder.hideForSail();
    fleet.spawn(design, state.teamColor);
    hydro.floodT = 0;
    hydro.sailing = false;
    course.setGate(0);
    course.resetChest();

    this.active = true;
    this.sailing = false;
    this.launchT = 0;
    this.cdShown = -1;
    this.t = 0;
    this.runStage = 0;
    this.goldEarned = 0;
    this.thrustTimer = 0;
    this.thrustCd = 0;
    this.jumpCd = 0;
    this.drownT = 0;
    this.lastProgressZ = -20;
    this.lastProgressT = 0;
    this.treasureStarted = false;
    this.seatIdx = 0;
    this.runId = newRunId();

    this.reseat(false);
    // crew avatars ride the other seats
    if (net.inRoom && fleet.primary) {
      const seats = fleet.primary.blocks.filter((b) => b.alive && b.pb.kind === 'seat' && b !== this.avatarSeat);
      let i = 0;
      for (const p of net.players) {
        if (p.id === net.you || !seats.length) continue;
        const seat = seats[i++ % seats.length];
        const av = makeAvatar(TEAM_COLORS[p.color % TEAM_COLORS.length], p.name);
        seat.group.add(av);
        av.position.set(0, 0.2, 0.1);
      }
    }
    cameraRig.toChase();
    controls.show();
    hud.showSail();
    hud.setHull(1);
    hud.setStage(0);
    sfx.play('launch');
    tg.backButton(true, () => this.abort());
  }

  private reseat(hopped: boolean) {
    if (this.avatar?.parent) this.avatar.parent.remove(this.avatar);
    const seat = this.d.fleet.firstAliveSeat();
    if (!seat) {
      this.avatarSeat = null;
      return;
    }
    if (!this.avatar) this.avatar = makeAvatar(TEAM_COLORS[this.d.state.teamColor], tg.user.name);
    seat.b.group.add(this.avatar);
    this.avatar.position.set(0, 0.2, 0.1);
    this.avatarSeat = seat.b;
    if (hopped) {
      this.d.hud.toast('Перепрыгнул на другое сиденье!');
      this.d.sfx.play('jump');
    }
  }

  /** Runs each physics substep, before world.step. */
  prePhysics(h: number) {
    if (!this.active) return;
    const { fleet, course, controls } = this.d;

    // flood + gate + countdown timeline (~3s)
    if (!this.sailing) {
      this.launchT += h;
      hydro.floodT = Math.min(1, this.launchT / 1.9);
      course.setGate(Math.min(1, Math.max(0, (this.launchT - 0.8) / 1.6)));
      const step = Math.floor(this.launchT);
      if (step !== this.cdShown && step <= 2) {
        this.cdShown = step;
        this.d.hud.countdown(String(3 - step));
      }
      if (this.launchT >= 3) {
        this.sailing = true;
        hydro.sailing = true;
        this.d.hud.countdown('ВПЕРЁД!');
        this.d.state.setPhase('sailing');
      }
    }

    fleet.applyHydro(h);

    const boat = fleet.primary;
    if (!boat || !this.sailing || this.treasureStarted) return;
    this.t += h;
    const rb = boat.body;
    const mass = rb.mass();

    // steering (host merges the whole crew's input)
    let steer = controls.steer;
    if (!this.isGuest && this.remoteSteer.size) {
      for (const s of this.remoteSteer.values()) steer += s;
      steer = Math.max(-1, Math.min(1, steer));
    }
    if (Math.abs(steer) > 0.05) {
      const av = rb.angvel();
      const rudders = fleet.aliveOf('rudder').filter((r) => r.c === boat).length;
      const authority = PHYS.turnPower * (1 + rudders * PHYS.rudderBonus);
      if (Math.abs(av.y) < PHYS.maxAngVel || Math.sign(av.y) !== Math.sign(steer)) {
        rb.addTorque({ x: 0, y: steer * authority * mass * 0.55, z: 0 }, true);
      }
      // carve: a bit of lateral force so steering feels responsive even at low speed
      rb.addForce({ x: steer * mass * 2.2, y: 0, z: 0 }, true);
    }

    // thrusters
    if (this.thrustTimer > 0) {
      this.thrustTimer -= h;
      for (const { c, b } of fleet.aliveOf('thruster')) {
        if (c !== boat) continue;
        c.worldPosOf(b, V);
        const rot = c.body.rotation();
        const dir = new THREE.Vector3(0, 0, 1)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), (b.pb.rot * Math.PI) / 2)
          .applyQuaternion(new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w));
        rb.addForceAtPoint({ x: dir.x * PHYS.thrusterForce, y: dir.y * PHYS.thrusterForce * 0.25, z: dir.z * PHYS.thrusterForce }, V, true);
      }
      if (this.thrustTimer <= 0) this.d.sfx.thrustStop();
    }
  }

  /** Contact-force events → block damage. */
  postPhysics(hits: ContactHit[]) {
    if (!this.active) return;
    const { fleet, course } = this.d;
    for (const hit of hits) {
      const b1 = fleet.colliderMap.get(hit.h1);
      const b2 = fleet.colliderMap.get(hit.h2);
      if (!b1 && !b2) continue;
      if (b1 && b2) {
        // cluster-on-cluster bonk: light damage to both
        const dmg = Math.max(0, hit.force - 7000) * DMG.scale * 0.3;
        if (dmg > 0.4) {
          fleet.damageBlock(b1.c, b1.b, dmg);
          fleet.damageBlock(b2.c, b2.b, dmg);
        }
        continue;
      }
      const blk = (b1 ?? b2)!;
      const other = b1 ? hit.h2 : hit.h1;
      const prof = course.damageReg.get(other) ?? { mult: DMG.defaultMult, minF: DMG.minImpact };
      if (prof.mult <= 0) continue;
      const dmg = Math.max(0, hit.force - prof.minF) * DMG.scale * prof.mult;
      if (dmg > 0.4) {
        fleet.damageBlock(blk.c, blk.b, dmg);
        if (dmg > 8) this.d.cameraRig.shake(Math.min(0.6, dmg / 40));
      }
    }
  }

  fireBoost() {
    if (!this.sailing || this.treasureStarted || this.thrustCd > 0) return;
    const boat = this.d.fleet.primary;
    if (!boat) return;
    const thrusters = this.d.fleet.aliveOf('thruster').filter((t) => t.c === boat);
    if (!thrusters.length) {
      this.d.hud.toast('Нет двигателей на борту');
      this.d.sfx.play('deny');
      return;
    }
    this.thrustTimer = PHYS.thrusterTime;
    this.thrustCd = PHYS.thrusterCd + PHYS.thrusterTime;
    this.d.sfx.thrustStart();
    tg.haptic('medium');
    if (net.inRoom && !net.isHost) net.sendInput(this.d.controls.steer, 1, 0);
  }

  jump() {
    if (!this.sailing || this.treasureStarted || this.jumpCd > 0) return;
    const { fleet } = this.d;
    const boat = fleet.primary;
    if (!boat) return;
    // hop between seats if there are several
    const seats = boat.blocks.filter((b) => b.alive && b.pb.kind === 'seat');
    if (seats.length > 1) {
      this.seatIdx = (this.seatIdx + 1) % seats.length;
      if (this.avatar?.parent) this.avatar.parent.remove(this.avatar);
      seats[this.seatIdx].group.add(this.avatar!);
      this.avatar!.position.set(0, 0.2, 0.1);
      this.avatarSeat = seats[this.seatIdx];
    }
    if (fleet.submergedOf(boat) > 0.4) {
      const m = boat.body.mass();
      boat.body.applyImpulse({ x: 0, y: m * PHYS.jumpVel, z: m * 0.6 }, true);
      this.jumpCd = PHYS.jumpCd;
      this.d.sfx.play('jump');
      tg.haptic('light');
      if (net.inRoom && !net.isHost) net.sendInput(this.d.controls.steer, 0, 1);
    }
  }

  private abort() {
    if (this.active && !this.treasureStarted) this.end('Возврат в порт', false);
  }

  /** Per render-frame logic (stages, hazard states, end conditions, FX). */
  update(dt: number) {
    const { fleet, course, hud, controls, state } = this.d;
    course.update(dt, hydro.time, this.active ? fleet : null, this.boatPos.z);
    if (!this.active) return;

    fleet.tickVisual(dt);
    const boat = fleet.primary;
    if (!boat) return;
    const t = boat.body.translation();
    const lv = boat.body.linvel();
    this.boatPos.set(t.x, t.y, t.z);
    this.boatVel.set(lv.x, lv.y, lv.z);
    fleet.cullWrecks(t.z);

    if (this.thrustCd > 0) {
      this.thrustCd -= dt;
      controls.setBoostState(Math.max(0, this.thrustCd / (PHYS.thrusterCd + PHYS.thrusterTime)), this.thrustTimer > 0, true);
    } else {
      controls.setBoostState(0, false, fleet.aliveOf('thruster').some((x) => x.c === boat));
    }
    if (this.jumpCd > 0) this.jumpCd -= dt;

    // thruster flames
    if (this.thrustTimer > 0) {
      for (const { c, b } of fleet.aliveOf('thruster')) {
        if (c !== boat) continue;
        c.worldPosOf(b, V);
        const rot = c.body.rotation();
        const dir = new THREE.Vector3(0, 0, 1)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), (b.pb.rot * Math.PI) / 2)
          .applyQuaternion(new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w));
        this.d.particles.flame(V.clone().addScaledVector(dir, -0.65), dir);
      }
    }

    if (!this.sailing || this.treasureStarted) return;

    // multiplayer streams: host broadcasts transforms, guests send inputs
    if (net.inRoom) {
      if (net.isHost) {
        this.xfClock -= dt;
        if (this.xfClock <= 0) {
          this.xfClock = 0.09;
          const r = boat.body.rotation();
          const av = boat.body.angvel();
          net.sendXf({
            main: [t.x, t.y, t.z, r.x, r.y, r.z, r.w, lv.x, lv.y, lv.z, av.x, av.y, av.z],
            wrecks: [],
            removed: fleet.removedSinceSync.splice(0),
            seats: {},
          });
        }
      } else {
        this.inputClock -= dt;
        if (this.inputClock <= 0) {
          this.inputClock = 0.15;
          net.sendInput(controls.steer, 0, 0);
        }
      }
    } else {
      fleet.removedSinceSync.length = 0;
    }

    // wake
    this.wakeClock -= dt;
    const speed = Math.hypot(lv.x, lv.z);
    if (speed > 3 && this.wakeClock <= 0 && t.y > waterLevelAt(t.x, t.z) - 1) {
      this.wakeClock = 0.09;
      this.d.particles.wake(V.set(t.x, waterLevelAt(t.x, t.z) + 0.05, t.z - 1.2));
    }

    // waterfall survival flag
    if (t.z > Z_WF + 8 && t.y < -6 && !state.waterfallFlag) {
      state.waterfallFlag = true;
      hud.toast('🌊 Пережил водопад!');
    }

    // guests replicate the host's verdicts — no local stage awards or endings
    if (this.isGuest) return;

    // stage progress
    const s = course.stageOfZ(t.z);
    if (s > this.runStage && s <= 8) {
      this.runStage = s;
      state.award(ECON.stageGold);
      this.goldEarned += ECON.stageGold;
      hud.setStage(s);
      hud.stagePopup(s, ECON.stageGold);
      this.d.sfx.play('stage');
      tg.haptic('light');
      this.lastProgressT = this.t;
      if (net.inRoom) net.sendEv({ k: 'stage', n: s });
    }

    // end conditions ------------------------------------------------
    if (!fleet.firstAliveSeat()) {
      this.end('Сиденье уничтожено', false);
      return;
    }
    if (this.avatarSeat) {
      const seatEntry = fleet.firstAliveSeat()!;
      seatEntry.c.worldPosOf(seatEntry.b, V);
      const lvl = waterLevelAt(V.x, V.z);
      if (V.y < lvl - 1.1) {
        this.drownT += dt;
        if (this.drownT > 1.25) {
          this.end('Капитан ушёл под воду', false);
          return;
        }
      } else this.drownT = Math.max(0, this.drownT - dt * 2);
    }
    if (t.z > this.lastProgressZ + 2) {
      this.lastProgressZ = t.z;
      this.lastProgressT = this.t;
    } else if (this.t - this.lastProgressT > 18 && speed < 0.6) {
      this.end('Застрял — нет хода', false);
      return;
    }
    if (t.y < -55) {
      this.end('Пропал в пучине', false);
      return;
    }

    // treasure!
    if (t.z > END.triggerZ) this.startTreasure();
  }

  getBoatFocus(): { pos: THREE.Vector3; vel: THREE.Vector3 } | null {
    if (!this.active) return null;
    return { pos: this.boatPos, vel: this.boatVel };
  }

  private startTreasure() {
    const { state, hud, course, cameraRig, controls, sfx } = this.d;
    this.treasureStarted = true;
    state.setPhase('treasure');
    controls.hide();
    sfx.thrustStop();
    cameraRig.toTreasure(course.chest.position.clone());
    course.startChestOpen();
    sfx.play('win');
    tg.haptic('heavy');

    const timeBonus = Math.max(0, Math.round(ECON.timeBonusMax - Math.max(0, this.t - ECON.timePar) * 0.5));
    const payout = ECON.treasureBase + ECON.perStage * this.runStage + timeBonus + state.claimFirstClear();
    if (net.inRoom && net.isHost) net.sendEv({ k: 'treasure', gold: payout });

    window.setTimeout(() => {
      hud.treasure(payout, () => {
        state.award(payout);
        this.goldEarned += payout;
        this.end('Сокровище забрано!', true);
      });
      this.d.particles.confetti(course.chest.position.clone().add(new THREE.Vector3(0, 2, 0)));
    }, 1500);
  }

  // ---- multiplayer plumbing ----
  remoteInput(from: string, s: number, th: number, j: number) {
    this.remoteSteer.set(from, Math.max(-1, Math.min(1, s || 0)));
    if (th) this.fireBoost();
    if (j) this.jump();
  }

  /** Guest-side: snap the local sim onto the host's authoritative state. */
  applyXf(data: XfPacket) {
    if (!this.active || !this.isGuest) return;
    const boat = this.d.fleet.primary;
    if (boat && data.main?.length >= 13) {
      const m = data.main;
      boat.body.setTranslation({ x: m[0], y: m[1], z: m[2] }, true);
      boat.body.setRotation({ x: m[3], y: m[4], z: m[5], w: m[6] }, true);
      boat.body.setLinvel({ x: m[7], y: m[8], z: m[9] }, true);
      boat.body.setAngvel({ x: m[10], y: m[11], z: m[12] }, true);
    }
    for (const key of data.removed ?? []) this.d.fleet.killByKey(key);
  }

  guestStage(n: number) {
    if (!this.active || n <= this.runStage) return;
    this.runStage = n;
    this.d.state.award(ECON.stageGold);
    this.goldEarned += ECON.stageGold;
    this.d.hud.setStage(n);
    this.d.hud.stagePopup(n, ECON.stageGold);
    this.d.sfx.play('stage');
  }

  guestEnd(reason: string, finished: boolean) {
    if (this.active && !finished && !this.treasureStarted) this.end(reason, false);
  }

  guestTreasure(gold: number) {
    if (!this.active || this.treasureStarted) return;
    this.treasureStarted = true;
    this.d.state.setPhase('treasure');
    this.d.controls.hide();
    this.d.cameraRig.toTreasure(this.d.course.chest.position.clone());
    this.d.course.startChestOpen();
    this.d.sfx.play('win');
    window.setTimeout(() => {
      this.d.hud.treasure(gold, () => {
        this.d.state.award(gold);
        this.goldEarned += gold;
        this.end('Сокровище забрано!', true);
      });
      this.d.particles.confetti(this.d.course.chest.position.clone().add(new THREE.Vector3(0, 2, 0)));
    }, 1500);
  }

  end(reason: string, finished: boolean) {
    if (!this.active) return;
    if (net.inRoom && net.isHost) net.sendEv({ k: 'end', reason, finished, stage: this.runStage });
    this.active = false;
    this.sailing = false;
    hydro.sailing = false;
    const { state, hud, controls, sfx, fleet } = this.d;
    controls.hide();
    sfx.thrustStop();
    tg.backButton(false);
    if (!finished) {
      sfx.play('lose');
      tg.haptic('error' as any);
    }

    const stats: RunStats = {
      stage: this.runStage,
      goldEarned: this.goldEarned,
      time: this.t,
      blocksLost: fleet.lostCount,
      finished,
      reason,
    };
    // Единственная точка конца заплыва — отсюда и рапорт хабу GG. Считаем до
    // endRun: он гасит waterfallFlag.
    this.reportToHub(stats, state.waterfallFlag);
    state.endRun(stats, fleet.materialsUsed);
    state.setPhase('summary');
    hud.summary(stats, state.bestStage, () => this.returnToBuild());
  }

  /** Факты заплыва → хаб. Каждый клиент рапортует только за своего игрока. */
  private reportToHub(rs: RunStats, waterfall: boolean) {
    const used = this.d.fleet.materialsUsed;
    const materials = [...used].filter((k) => MATERIALS.has(k));
    const crew = net.inRoom ? Math.max(1, net.players.length) : 1;

    // Только то, что заплыв реально может о себе сказать. Флаги ставим лишь в
    // том заплыве, где приём случился — по умолчанию их нет.
    const stats: Record<string, number | boolean> = {};
    if (rs.finished) {
      stats.chest = 1;
      if (rs.blocksLost === 0) stats.flawless = true;
      if (materials.length > 0 && materials.every((k) => k === 'gold')) stats.gold = true;
      if (rs.time <= ECON.timePar) stats.fast = true;
      if (crew > 1) stats.coop = true;
    }
    if (waterfall) stats.waterfall = true;

    reportRun({
      idempotencyKey: this.runId,
      finished: rs.finished,
      players: crew,
      humanPlayers: crew, // ботов-игроков в НЕОН-ТАЙДЕ нет: на борту только люди
      mode: net.inRoom ? 'friends' : 'solo', // комнаты только по коду/приглашению
      durationSec: Math.round(rs.time),
      score: rs.goldEarned,
      stats,
    });
  }

  returnToBuild() {
    const { fleet, course, builder, cameraRig, state, hud } = this.d;
    fleet.despawn();
    hydro.floodT = 0;
    hydro.sailing = false;
    course.setGate(0);
    course.resetChest();
    builder.showAfterSail();
    cameraRig.toBuild();
    state.setPhase('build');
    hud.showBuild();
    this.boatPos.set(0, 0, -8);
    this.boatVel.set(0, 0, 0);
  }
}
