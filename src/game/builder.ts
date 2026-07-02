import * as THREE from 'three';
import { BLOCKS, MAX_BLOCKS, PLOT, TEAM_COLORS } from '../config';
import { keyOf, type BlockKind, type Design, type PlacedBlock } from '../types';
import { makeBlockGroup, makeGhost } from './blocks';
import type { GameState } from './state';
import type { Sfx } from '../engine/audio';
import { tg } from '../telegram';

const KIND_IDX: BlockKind[] = ['wood', 'plastic', 'metal', 'gold', 'seat', 'rudder', 'thruster', 'balloon', 'tnt'];

export function gridToWorld(gx: number, gy: number, gz: number, out: THREE.Vector3) {
  return out.set(gx, PLOT.floorTop + 0.5 + gy, PLOT.cz + gz);
}

interface Cell {
  pb: PlacedBlock;
  group: THREE.Group;
}

type UndoOp = { op: 'place' | 'remove'; pb: PlacedBlock };

export class Builder {
  root = new THREE.Group(); // everything build-phase (plot dressing + blocks)
  blocksRoot = new THREE.Group();
  private grid = new Map<string, Cell>();
  private ghost: THREE.Group | null = null;
  private ghostCell: { gx: number; gy: number; gz: number } | null = null;
  private plotMesh!: THREE.Mesh;
  private trimMats: THREE.MeshStandardMaterial[] = [];
  private ray = new THREE.Raycaster();
  private ptr = new THREE.Vector2();
  private tmp = new THREE.Vector3();
  private undoStack: UndoOp[] = [];

  selected: BlockKind = 'wood';
  rot = 0;
  deleteMode = false;
  enabled = false;
  onChange: (() => void) | null = null;
  onDeny: ((msg: string) => void) | null = null;
  /** In multiplayer, placements are also sent to the room. */
  onPlace: ((pb: PlacedBlock) => void) | null = null;
  onRemove: ((key: string) => void) | null = null;

  private downX = 0;
  private downY = 0;
  private downT = 0;
  private activePointers = 0;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private canvas: HTMLCanvasElement,
    private state: GameState,
    private sfx: Sfx,
  ) {
    this.buildPlot();
    this.root.add(this.blocksRoot);
    scene.add(this.root);

    canvas.addEventListener('pointerdown', (e) => {
      this.activePointers++;
      this.downX = e.clientX; this.downY = e.clientY; this.downT = performance.now();
    });
    canvas.addEventListener('pointerup', (e) => {
      this.activePointers = Math.max(0, this.activePointers - 1);
      if (!this.enabled) return;
      const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
      const dt = performance.now() - this.downT;
      if (moved < 12 && dt < 400 && this.activePointers === 0) this.tap(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointercancel', () => (this.activePointers = Math.max(0, this.activePointers - 1)));
    canvas.addEventListener('pointermove', (e) => {
      if (!this.enabled || this.activePointers > 1) return;
      this.updateGhost(e.clientX, e.clientY);
    });
  }

  private buildPlot() {
    const plat = new THREE.Mesh(
      new THREE.BoxGeometry(12.6, 1.2, 12.6),
      new THREE.MeshStandardMaterial({ color: 0x10151f, roughness: 0.45, metalness: 0.75 }),
    );
    plat.position.set(0, PLOT.floorTop - 0.6, PLOT.cz);
    plat.receiveShadow = true;
    this.plotMesh = plat;
    this.root.add(plat);

    // glowing grid
    const grid = new THREE.GridHelper(11, 11, 0x2fbde0, 0x1a5a74);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    grid.position.set(0, PLOT.floorTop + 0.015, PLOT.cz);
    this.root.add(grid);

    // neon trim + corner pylons in team color
    const trimGeo = new THREE.BoxGeometry(12.6, 0.1, 0.14);
    const trimGeoS = new THREE.BoxGeometry(0.14, 0.1, 12.6);
    for (const [g, x, z] of [
      [trimGeo, 0, -6.3], [trimGeo, 0, 6.3], [trimGeoS, -6.3, 0], [trimGeoS, 6.3, 0],
    ] as [THREE.BoxGeometry, number, number][]) {
      const m = new THREE.MeshStandardMaterial({ color: 0x66e0ff, emissive: 0x66e0ff, emissiveIntensity: 1.8, roughness: 0.4 });
      this.trimMats.push(m);
      const t = new THREE.Mesh(g, m);
      t.position.set(x, PLOT.floorTop + 0.02, PLOT.cz + z);
      this.root.add(t);
    }
    for (const [x, z] of [[-6.3, -6.3], [6.3, -6.3], [-6.3, 6.3], [6.3, 6.3]]) {
      const m = new THREE.MeshStandardMaterial({ color: 0x66e0ff, emissive: 0x66e0ff, emissiveIntensity: 1.4 });
      this.trimMats.push(m);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 8), m);
      p.position.set(x, PLOT.floorTop + 1.1, PLOT.cz + z);
      this.root.add(p);
    }
    this.setAccent(TEAM_COLORS[this.state.teamColor]);

    // launch direction chevrons toward the gate
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(
        new THREE.ConeGeometry(0.28, 0.7, 4),
        new THREE.MeshStandardMaterial({ color: 0x35e06f, emissive: 0x35e06f, emissiveIntensity: 1.2, transparent: true, opacity: 0.8 }),
      );
      c.rotation.x = Math.PI / 2;
      c.rotation.y = Math.PI / 4;
      c.position.set(0, PLOT.floorTop + 0.06, PLOT.cz + 6.9 + i * 0.9);
      this.root.add(c);
    }
  }

  setAccent(hex: number) {
    for (const m of this.trimMats) {
      m.color.setHex(hex);
      m.emissive.setHex(hex);
    }
  }

  setSelected(kind: BlockKind) {
    this.selected = kind;
    this.deleteMode = false;
    this.refreshGhostModel();
  }

  rotate() {
    this.rot = (this.rot + 1) % 4;
    if (this.ghost) this.ghost.rotation.y = (this.rot * Math.PI) / 2;
    this.sfx.play('tap');
  }

  setDeleteMode(on: boolean) {
    this.deleteMode = on;
    if (this.ghost) this.ghost.visible = false;
  }

  enable() {
    this.enabled = true;
    this.root.visible = true;
  }

  disable() {
    this.enabled = false;
    this.root.visible = false;
    if (this.ghost) this.ghost.visible = false;
  }

  hideForSail() {
    // plot dressing stays visible during the run; only the editable blocks hide
    this.blocksRoot.visible = false;
    this.enabled = false;
    if (this.ghost) this.ghost.visible = false;
  }

  showAfterSail() {
    this.blocksRoot.visible = true;
    this.enabled = true;
  }

  blockCount() {
    return this.grid.size;
  }

  design(): Design {
    return [...this.grid.values()].map((c) => ({ ...c.pb }));
  }

  private refreshGhostModel() {
    if (this.ghost) {
      this.root.remove(this.ghost);
      this.ghost = null;
    }
    this.ghost = makeGhost(this.selected);
    this.ghost.visible = false;
    this.root.add(this.ghost);
  }

  private pick(cx: number, cy: number): { cell: { gx: number; gy: number; gz: number } | null; hitKey: string | null } {
    const r = this.canvas.getBoundingClientRect();
    this.ptr.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ptr, this.camera);
    const targets: THREE.Object3D[] = [this.plotMesh, this.blocksRoot];
    const hits = this.ray.intersectObjects(targets, true);
    if (!hits.length) return { cell: null, hitKey: null };
    const hit = hits[0];

    // find owning block group (if any)
    let o: THREE.Object3D | null = hit.object;
    let ownKey: string | null = null;
    while (o) {
      if (o.userData.cellKey) { ownKey = o.userData.cellKey as string; break; }
      o = o.parent;
    }

    if (ownKey) {
      const cell = this.grid.get(ownKey);
      if (!cell) return { cell: null, hitKey: null };
      const { gx, gy, gz } = cell.pb;
      gridToWorld(gx, gy, gz, this.tmp);
      const dx = hit.point.x - this.tmp.x;
      const dy = hit.point.y - this.tmp.y;
      const dz = hit.point.z - this.tmp.z;
      const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
      let nx = 0, ny = 0, nz = 0;
      if (ax >= ay && ax >= az) nx = Math.sign(dx);
      else if (ay >= ax && ay >= az) ny = Math.sign(dy);
      else nz = Math.sign(dz);
      return { cell: { gx: gx + nx, gy: gy + ny, gz: gz + nz }, hitKey: ownKey };
    }
    // plot surface
    const gx = Math.round(hit.point.x);
    const gz = Math.round(hit.point.z - PLOT.cz);
    return { cell: { gx, gy: 0, gz }, hitKey: null };
  }

  canPlaceAt(gx: number, gy: number, gz: number): boolean {
    if (Math.abs(gx) > PLOT.half || Math.abs(gz) > PLOT.half || gy < 0 || gy >= PLOT.h) return false;
    if (this.grid.has(keyOf(gx, gy, gz))) return false;
    if (this.grid.size >= MAX_BLOCKS) return false;
    if (gy === 0) return true;
    return (
      this.grid.has(keyOf(gx + 1, gy, gz)) || this.grid.has(keyOf(gx - 1, gy, gz)) ||
      this.grid.has(keyOf(gx, gy + 1, gz)) || this.grid.has(keyOf(gx, gy - 1, gz)) ||
      this.grid.has(keyOf(gx, gy, gz + 1)) || this.grid.has(keyOf(gx, gy, gz - 1))
    );
  }

  private updateGhost(cx: number, cy: number) {
    if (!this.ghost) this.refreshGhostModel();
    if (this.deleteMode) return;
    const { cell } = this.pick(cx, cy);
    if (!cell) {
      this.ghost!.visible = false;
      this.ghostCell = null;
      return;
    }
    this.ghostCell = cell;
    gridToWorld(cell.gx, cell.gy, cell.gz, this.tmp);
    this.ghost!.position.copy(this.tmp);
    this.ghost!.rotation.y = (this.rot * Math.PI) / 2;
    this.ghost!.visible = true;
    (this.ghost!.userData.setValid as (ok: boolean) => void)(this.canPlaceAt(cell.gx, cell.gy, cell.gz));
  }

  private tap(cx: number, cy: number) {
    const { cell, hitKey } = this.pick(cx, cy);
    if (this.deleteMode) {
      if (hitKey) this.removeAt(hitKey, true);
      return;
    }
    if (!cell) return;
    this.placeAt(cell.gx, cell.gy, cell.gz, this.selected, this.rot, true);
    this.updateGhost(cx, cy);
  }

  placeAt(gx: number, gy: number, gz: number, kind: BlockKind, rot: number, economy: boolean, owner?: string, silent = false): boolean {
    if (!this.canPlaceAt(gx, gy, gz)) {
      if (economy && !silent) this.sfx.play('deny');
      return false;
    }
    if (economy && !this.state.takeBlock(kind)) {
      if (!silent) {
        this.sfx.play('deny');
        this.onDeny?.(`Need ${BLOCKS[kind].cost} gold for ${BLOCKS[kind].label}`);
      }
      return false;
    }
    const pb: PlacedBlock = { gx, gy, gz, rot, kind, owner: owner ?? tg.user.id };
    const group = makeBlockGroup(kind, TEAM_COLORS[this.state.teamColor]);
    gridToWorld(gx, gy, gz, this.tmp);
    group.position.copy(this.tmp);
    group.rotation.y = (rot * Math.PI) / 2;
    group.userData.cellKey = keyOf(gx, gy, gz);
    this.blocksRoot.add(group);
    this.grid.set(keyOf(gx, gy, gz), { pb, group });
    if (!silent) {
      this.sfx.play('place');
      tg.haptic('light');
    }
    if (economy) {
      this.undoStack.push({ op: 'place', pb });
      if (this.undoStack.length > 30) this.undoStack.shift();
      this.onPlace?.(pb);
    }
    this.commit();
    return true;
  }

  removeAt(key: string, economy: boolean, silent = false): boolean {
    const cell = this.grid.get(key);
    if (!cell) return false;
    this.blocksRoot.remove(cell.group);
    this.grid.delete(key);
    if (economy) {
      // only your own blocks refund into your inventory
      if (!cell.pb.owner || cell.pb.owner === tg.user.id) {
        this.state.refundBlock(cell.pb.kind);
        this.undoStack.push({ op: 'remove', pb: cell.pb });
        if (this.undoStack.length > 30) this.undoStack.shift();
      }
      this.onRemove?.(key);
    }
    if (!silent) {
      this.sfx.play('remove');
      tg.haptic('light');
    }
    this.commit();
    return true;
  }

  undo() {
    const op = this.undoStack.pop();
    if (!op) return;
    const { pb } = op;
    if (op.op === 'place') {
      const key = keyOf(pb.gx, pb.gy, pb.gz);
      const cell = this.grid.get(key);
      if (cell) {
        this.blocksRoot.remove(cell.group);
        this.grid.delete(key);
        this.state.refundBlock(pb.kind);
        this.onRemove?.(key);
      }
    } else {
      if (this.canPlaceAt(pb.gx, pb.gy, pb.gz) && this.state.takeBlock(pb.kind)) {
        this.placeAt(pb.gx, pb.gy, pb.gz, pb.kind, pb.rot, false, pb.owner, true);
        this.onPlace?.(pb);
      }
    }
    this.sfx.play('remove');
    this.commit();
  }

  clearAll(refund = true) {
    for (const [key, cell] of [...this.grid]) {
      this.blocksRoot.remove(cell.group);
      this.grid.delete(key);
      if (refund && (!cell.pb.owner || cell.pb.owner === tg.user.id)) this.state.refundBlock(cell.pb.kind);
    }
    this.undoStack.length = 0;
    this.commit();
  }

  loadDesign(d: Design) {
    for (const cell of this.grid.values()) this.blocksRoot.remove(cell.group);
    this.grid.clear();
    for (const pb of d) this.placeAt(pb.gx, pb.gy, pb.gz, pb.kind, pb.rot, false, pb.owner, true);
    this.commit();
  }

  /** Import a shared design: consumes inventory/gold for what you can afford, skips the rest. */
  importShared(d: Design): { placed: number; skipped: number } {
    this.clearAll(true);
    let placed = 0, skipped = 0;
    for (const pb of d) {
      if (this.canPlaceAt(pb.gx, pb.gy, pb.gz) && this.state.takeBlock(pb.kind)) {
        this.placeAt(pb.gx, pb.gy, pb.gz, pb.kind, pb.rot, false, undefined, true);
        placed++;
      } else skipped++;
    }
    this.commit();
    return { placed, skipped };
  }

  private commit() {
    this.state.setDesign(this.design());
    this.onChange?.();
  }

  seatCount() {
    let n = 0;
    for (const c of this.grid.values()) if (c.pb.kind === 'seat') n++;
    return n;
  }

  canLaunch(minSeats = 1): { ok: boolean; reason: string } {
    if (this.grid.size === 0) return { ok: false, reason: 'Place some blocks first!' };
    const seats = this.seatCount();
    if (seats < minSeats) return { ok: false, reason: minSeats > 1 ? `Need ${minSeats} seats — one per player` : 'Your captain needs a Seat!' };
    return { ok: true, reason: '' };
  }

  shareCode(): string {
    const arr = this.design().map((b) => [b.gx, b.gy, b.gz, b.rot, KIND_IDX.indexOf(b.kind)]);
    const raw = btoa(JSON.stringify(arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `B1${raw}`;
  }

  static decodeShare(code: string): Design | null {
    if (!code.startsWith('B1')) return null;
    try {
      const raw = code.slice(2).replace(/-/g, '+').replace(/_/g, '/');
      const arr = JSON.parse(atob(raw)) as number[][];
      if (!Array.isArray(arr) || arr.length > MAX_BLOCKS) return null;
      return arr.map((a) => ({ gx: a[0] | 0, gy: a[1] | 0, gz: a[2] | 0, rot: (a[3] | 0) % 4, kind: KIND_IDX[a[4]] ?? 'wood' }));
    } catch {
      return null;
    }
  }

  update(t: number) {
    if (this.ghost?.visible) {
      this.ghost.position.y = PLOT.floorTop + 0.5 + this.ghostCell!.gy + Math.sin(t * 3.2) * 0.035;
    }
  }
}
