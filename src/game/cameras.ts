import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLOT, RIVER, Z_WF } from '../config';
import { waterLevelAt } from '../engine/water';

export class CameraRig {
  mode: 'orbit' | 'chase' | 'treasure' = 'orbit';
  orbit: OrbitControls;
  private shakeMag = 0;
  private look = new THREE.Vector3(0, 1, PLOT.cz);
  private desired = new THREE.Vector3();
  private treasureAngle = 0;
  private treasureAt = new THREE.Vector3();

  constructor(public camera: THREE.PerspectiveCamera, canvas: HTMLElement) {
    this.orbit = new OrbitControls(camera, canvas);
    this.orbit.target.set(0, 1, PLOT.cz);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.minDistance = 6.5;
    this.orbit.maxDistance = 26;
    this.orbit.maxPolarAngle = 1.35;
    this.orbit.minPolarAngle = 0.12;
    this.orbit.enablePan = false;
    camera.position.set(9.5, 8, PLOT.cz - 11.5);
  }

  toBuild() {
    this.mode = 'orbit';
    this.orbit.enabled = true;
    this.camera.position.set(9.5, 8, PLOT.cz - 11.5);
    this.orbit.target.set(0, 1, PLOT.cz);
  }

  toChase() {
    this.mode = 'chase';
    this.orbit.enabled = false;
  }

  toTreasure(chest: THREE.Vector3) {
    this.mode = 'treasure';
    this.orbit.enabled = false;
    this.treasureAt.copy(chest);
    this.treasureAngle = Math.PI;
  }

  shake(m: number) {
    this.shakeMag = Math.min(1.3, this.shakeMag + m);
  }

  update(dt: number, boat: { pos: THREE.Vector3; vel: THREE.Vector3 } | null) {
    if (this.mode === 'orbit') {
      this.orbit.update();
    } else if (this.mode === 'chase' && boat) {
      const speed = Math.hypot(boat.vel.x, boat.vel.z);
      const falling = boat.vel.y < -7;
      const nearFall = boat.pos.z > Z_WF - 12 && boat.pos.z < Z_WF + 20;
      const dist = 9 + Math.min(6, speed * 0.35) + (nearFall ? 3.5 : 0);
      const height = 5.4 + (nearFall || falling ? 4.5 : 0);

      this.desired.set(
        THREE.MathUtils.clamp(boat.pos.x * 0.65, -(RIVER.wallX - 1.3), RIVER.wallX - 1.3),
        boat.pos.y + height,
        boat.pos.z - dist,
      );
      const minY = waterLevelAt(this.desired.x, this.desired.z) + 1.2;
      if (this.desired.y < minY) this.desired.y = minY;

      const k = 1 - Math.exp(-dt * 4.5);
      this.camera.position.lerp(this.desired, k);

      this.look.lerp(
        this.desired.set(boat.pos.x * 0.8, boat.pos.y + 1 + Math.min(4, Math.max(0, -boat.vel.y) * 0.3), boat.pos.z + 9),
        1 - Math.exp(-dt * 6),
      );
      this.camera.lookAt(this.look);
    } else if (this.mode === 'treasure') {
      this.treasureAngle += dt * 0.32;
      this.desired.set(
        this.treasureAt.x + Math.sin(this.treasureAngle) * 7,
        this.treasureAt.y + 3.4,
        this.treasureAt.z + Math.cos(this.treasureAngle) * 7,
      );
      this.camera.position.lerp(this.desired, 1 - Math.exp(-dt * 3));
      this.look.lerp(this.desired.copy(this.treasureAt).add(new THREE.Vector3(0, 1, 0)), 1 - Math.exp(-dt * 4));
      this.camera.lookAt(this.look);
    }

    if (this.shakeMag > 0.005) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeMag * 0.5;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeMag * 0.4;
      this.shakeMag *= Math.exp(-dt * 5.5);
    }
  }
}
