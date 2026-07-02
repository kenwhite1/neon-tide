import RAPIER from '@dimforge/rapier3d-compat';
import { PHYS } from '../config';

export let R: typeof RAPIER;
export let world: RAPIER.World;
export let eventQueue: RAPIER.EventQueue;

export const FIXED_DT = 1 / 60;

export async function initPhysics() {
  await RAPIER.init();
  R = RAPIER;
  world = new RAPIER.World({ x: 0, y: -PHYS.g, z: 0 });
  world.timestep = FIXED_DT;
  eventQueue = new RAPIER.EventQueue(true);
}

export interface ContactHit {
  h1: number;
  h2: number;
  force: number;
}

const hits: ContactHit[] = [];

/** Steps the world once and returns contact-force hits above collider thresholds. */
export function stepWorld(): ContactHit[] {
  hits.length = 0;
  world.step(eventQueue);
  eventQueue.drainContactForceEvents((e) => {
    hits.push({ h1: e.collider1(), h2: e.collider2(), force: e.maxForceMagnitude() });
  });
  eventQueue.drainCollisionEvents(() => {});
  return hits;
}

export function addStaticBox(
  x: number, y: number, z: number,
  hx: number, hy: number, hz: number,
  opts: { friction?: number; restitution?: number } = {},
) {
  const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y, z));
  const col = world.createCollider(
    R.ColliderDesc.cuboid(hx, hy, hz)
      .setFriction(opts.friction ?? 0.55)
      .setRestitution(opts.restitution ?? 0.12),
    body,
  );
  return { body, col };
}
