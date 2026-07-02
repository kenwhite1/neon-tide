import './ui/styles.css';
import * as THREE from 'three';
import { FIXED_DT, initPhysics, stepWorld } from './engine/physics';
import { View } from './engine/renderer';
import { WaterVisual } from './engine/water';
import { Particles } from './engine/particles';
import { Sfx } from './engine/audio';
import { GameState } from './game/state';
import { Builder } from './game/builder';
import { Fleet } from './game/boat';
import { Course } from './game/stages';
import { Sail } from './game/sail';
import { CameraRig } from './game/cameras';
import { Controls } from './game/controls';
import { Hud } from './ui/hud';
import { tg } from './telegram';
import { net } from './net/net';
import { TEAM_COLORS } from './config';
import type { BlockKind } from './types';

async function boot() {
  const appEl = document.getElementById('app')!;
  const uiEl = document.getElementById('ui')!;

  const sfx = new Sfx();
  const state = new GameState();
  const hud = new Hud(uiEl, state, sfx);
  hud.showBoot(() => sfx.unlock());

  tg.init();
  await initPhysics();

  const view = new View(appEl);
  const water = new WaterVisual();
  view.scene.add(water.group);
  const particles = new Particles(view.scene);
  const course = new Course(view.scene, particles, sfx);
  const cameraRig = new CameraRig(view.camera, view.renderer.domElement);
  const builder = new Builder(view.scene, view.camera, view.renderer.domElement, state, sfx);
  const controls = new Controls(uiEl);
  const fleet = new Fleet(view.scene, {
    particles,
    sfx,
    shake: (m) => cameraRig.shake(m),
    haptic: (k) => tg.haptic(k),
  });
  const sail = new Sail({ fleet, course, state, hud, controls, cameraRig, particles, sfx, builder });

  hud.mount({
    onLaunch: () => {
      if (state.phase !== 'build') return;
      if (net.inRoom && !net.isHost) {
        hud.toast('Only the host can launch — nag them!');
        sfx.play('deny');
        return;
      }
      const chk = builder.canLaunch(net.inRoom ? Math.max(1, net.players.length) : 1);
      if (!chk.ok) {
        hud.toast(chk.reason);
        sfx.play('deny');
        return;
      }
      net.sendLaunch();
      sail.begin(builder.design());
    },
    onSelect: (k) => builder.setSelected(k),
    onRotate: () => builder.rotate(),
    onDelete: (on) => builder.setDeleteMode(on),
    onUndo: () => builder.undo(),
    onClear: () => {
      builder.clearAll(true);
      hud.toast('Plot cleared — blocks refunded');
    },
    onColor: (i) => builder.setAccent(TEAM_COLORS[i]),
    onShareBoat: () => {
      tg.share(`boat_${builder.shareCode()}`, '⚓ My NEON TIDE boat — load it and beat my run!');
      hud.toast(tg.isReal ? 'Share sheet opened' : 'Share link copied to clipboard');
    },
  });
  (hud as any).selectedKind = 'wood';
  hud.refreshPalette();

  // audio unlock safety net — any first gesture counts
  view.renderer.domElement.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

  builder.onDeny = (msg) => hud.toast(msg);
  builder.loadDesign(state.design);
  builder.enable();
  state.setPhase('build');

  if (tg.startParam.startsWith('boat_')) {
    const d = Builder.decodeShare(tg.startParam.slice(5));
    if (d) {
      const res = builder.importShared(d);
      hud.toast(`Boat imported — ${res.placed} blocks${res.skipped ? `, ${res.skipped} skipped (can't afford)` : ''}`);
    }
  }

  // ---------- multiplayer wiring ----------
  builder.onPlace = (pb) => net.sendPlace(pb);
  builder.onRemove = (key) => net.sendRemove(key);
  net.onPlace = (b) => builder.placeAt(b.gx, b.gy, b.gz, b.kind, b.rot, false, b.owner, false);
  net.onRemove = (key) => builder.removeAt(key, false);
  net.onClear = () => builder.clearAll(false);
  net.onDesign = (d) => builder.loadDesign(d);
  net.onJoined = (design) => {
    if (design.length) builder.loadDesign(design);
    else if (net.isHost) net.sendDesign(builder.design());
    hud.toast(`⚓ Room ${net.room} — you're ${net.isHost ? 'the HOST' : 'crew'}`);
  };
  net.onPlayers = () => {
    if (net.inRoom) hud.toast(`Crew: ${net.players.map((p) => p.name).join(', ')}`);
  };
  net.onLaunch = () => {
    if (state.phase === 'build') sail.begin(builder.design(), true);
  };
  net.onInput = (from, s, th, j) => sail.remoteInput(from, s, th, j);
  net.onXf = (d) => sail.applyXf(d);
  net.onEv = (ev) => {
    if (ev.k === 'stage') sail.guestStage(ev.n);
    else if (ev.k === 'end') sail.guestEnd(ev.reason, ev.finished);
    else if (ev.k === 'treasure') sail.guestTreasure(ev.gold);
  };
  net.onError = (m) => hud.toast(`⚠️ ${m}`);
  net.onLeft = () => hud.toast('Left the room — back to solo');

  const renderMp = (slot: HTMLElement) => {
    if (!net.inRoom) {
      slot.innerHTML = `
        <div class="set-row"><span>Multiplayer</span><span style="display:flex;gap:6px">
          <button class="mini-btn" id="mp-create">CREATE ROOM</button>
          <button class="mini-btn" id="mp-join">JOIN</button></span></div>
        <div id="mp-join-row" class="hidden set-row"><input id="mp-code" maxlength="5" placeholder="CODE" style="flex:1;background:rgba(255,255,255,.08);border:1px solid var(--line);border-radius:10px;color:#fff;padding:8px 10px;font-weight:800;letter-spacing:3px;text-transform:uppercase;font-size:14px;min-width:0"/><button class="mini-btn" id="mp-go">GO</button></div>`;
      slot.querySelector('#mp-create')!.addEventListener('click', () => {
        net.join(null)
          .then(() => renderMp(slot))
          .catch((e) => hud.toast(`⚠️ ${e.message}`));
      });
      slot.querySelector('#mp-join')!.addEventListener('click', () => {
        slot.querySelector('#mp-join-row')!.classList.toggle('hidden');
        (slot.querySelector('#mp-code') as HTMLInputElement).focus();
      });
      slot.querySelector('#mp-go')!.addEventListener('click', () => {
        const code = (slot.querySelector('#mp-code') as HTMLInputElement).value.trim().toUpperCase();
        if (code.length >= 4)
          net.join(code)
            .then(() => renderMp(slot))
            .catch((e) => hud.toast(`⚠️ ${e.message}`));
      });
    } else {
      slot.innerHTML = `
        <div class="set-row"><span>Room <b style="color:var(--accent);letter-spacing:2px">${net.room}</b>${net.isHost ? ' 👑' : ''}</span>
        <span style="display:flex;gap:6px"><button class="mini-btn" id="mp-invite">INVITE</button><button class="mini-btn danger" id="mp-leave">LEAVE</button></span></div>
        <div style="font-size:12px;opacity:.7;font-weight:600;padding:4px 2px">${net.players.map((p) => p.name).join(' · ')}</div>`;
      slot.querySelector('#mp-invite')!.addEventListener('click', () => {
        tg.share(net.room, `⚓ Join my NEON TIDE crew! Room code: ${net.room}`);
        hud.toast(tg.isReal ? 'Invite sheet opened' : 'Invite link copied');
      });
      slot.querySelector('#mp-leave')!.addEventListener('click', () => {
        net.leave();
        renderMp(slot);
      });
    }
  };
  hud.onMpSlot = renderMp;

  // deep-linked room code (t.me/...?startapp=XXXXX)
  if (/^[A-Z2-9]{5}$/.test(tg.startParam)) {
    net.join(tg.startParam).catch((e) => hud.toast(`⚠️ ${e.message}`));
  }

  hud.bootReady();
  tg.onViewportChange(() => view.resize());

  const plotFocus = new THREE.Vector3(0, 0, -8);
  let last = performance.now();
  let acc = 0;
  let elapsed = 0;

  function update(dt: number, maxSteps = 4) {
    elapsed += dt;

    if (sail.active) {
      acc += dt;
      let steps = 0;
      while (acc >= FIXED_DT && steps < maxSteps) {
        sail.prePhysics(FIXED_DT);
        const hits = stepWorld();
        sail.postPhysics(hits);
        acc -= FIXED_DT;
        steps++;
      }
      if (steps === maxSteps) acc = 0; // don't spiral on slow frames
    } else {
      acc = 0;
    }

    sail.update(dt);
    builder.update(elapsed);
    water.update(dt);
    particles.update(dt);
  }

  function frame(now: number) {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);

    const focus = sail.getBoatFocus();
    cameraRig.update(dt, focus);
    view.followLight(focus ? focus.pos : plotFocus);
    view.render();
  }
  requestAnimationFrame(frame);

  // hidden tabs get no rAF (and timers clamp to 1Hz) — keep simulating at
  // real speed via physics catch-up so a multiplayer host that backgrounds
  // the app briefly doesn't freeze or slow the whole crew
  window.setInterval(() => {
    if (!document.hidden) return;
    const now = performance.now();
    const dt = Math.min(1.2, (now - last) / 1000);
    last = now;
    if (dt > 0.001) {
      update(dt, 80);
      const focus = sail.getBoatFocus();
      cameraRig.update(dt, focus);
      view.followLight(focus ? focus.pos : plotFocus);
      view.render();
    }
  }, 50);
  document.addEventListener('visibilitychange', () => {
    last = performance.now();
  });

  // console/debug hooks (also used by automated verification)
  (window as any).__game = {
    state,
    builder,
    sail,
    fleet,
    course,
    net,
    launch: () => {
      const chk = builder.canLaunch();
      if (chk.ok && state.phase === 'build') {
        net.sendLaunch();
        sail.begin(builder.design());
      }
      return chk;
    },
    gold: (n: number) => state.award(n),
    place: (gx: number, gy: number, gz: number, kind: BlockKind, rot = 0) => builder.placeAt(gx, gy, gz, kind, rot, false, undefined, true),
    tp: (z: number) => fleet.primary?.body.setTranslation({ x: 0, y: 1, z }, true),
    dmgSeat: () => {
      const s = fleet.firstAliveSeat();
      if (s) {
        s.b.iframe = 0;
        fleet.damageBlock(s.c, s.b, 999);
      }
    },
    boom: () => {
      const b = fleet.primary;
      if (b) {
        const t = b.body.translation();
        fleet.explodeAt(new THREE.Vector3(t.x + 1, t.y, t.z), 3, 60, 9000);
      }
    },
    phase: () => state.phase,
    pos: () => fleet.primary?.body.translation(),
  };
}

boot();
