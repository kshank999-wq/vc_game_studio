import type { Mesh } from './geometry';

/**
 * The prototype character (spec §9.2): a capsule that walks, runs, jumps and
 * falls, slides along walls, climbs steps and stairs, and stands on whatever
 * is under it. Pure and deterministic, so it can be tested without a screen.
 * Plan coordinates as everywhere: x east, y south; z is height.
 */

/** A solid, as an upright box turned about its centre on the plan. */
export interface Collider {
  itemId: string;
  x: number;
  y: number;
  /** Half its width and depth, in its own frame. */
  hw: number;
  hd: number;
  /** Turned this far clockwise, seen from above (radians). */
  rot: number;
  bottom: number;
  top: number;
  /** A freeform slab's corners on the plan, instead of the box's footprint. */
  poly?: { x: number; y: number }[];
  /** What it is part of: a floor, a wall, a ceiling, a solid, a door. */
  part?: string;
}

export interface Body {
  x: number;
  y: number;
  /** Feet. */
  z: number;
  vz: number;
  /** Facing, clockwise from north (radians). */
  yaw: number;
  /** Looking up (positive) or down. */
  pitch: number;
  grounded: boolean;
  /** Crouching (spec §6): lower, slower, and through gaps a standing body can't pass. */
  crouched?: boolean;
  /** On a ladder, or swimming, this step. */
  climbing?: boolean;
  swimming?: boolean;
}

export interface MoveInput {
  /** −1 back … 1 forward. */
  forward: number;
  /** −1 left … 1 right. */
  strafe: number;
  jump: boolean;
  run: boolean;
  /** Move along the map's axes (top-down) instead of the way the body faces. */
  worldAxes?: boolean;
  /** Hold to crouch; let go to stand, once there is room to. */
  crouch?: boolean;
  /** At a ladder (spec §6, cave traversal): forward climbs, back goes down, and nothing falls. */
  ladder?: boolean;
  /** In water: its surface's height. Deep enough, the body swims: slower, slowly sinking, jump to rise. */
  water?: number;
}

/** Climbing and swimming (spec §6): metres a second up a ladder; in water, how much slower, how fast it sinks and rises. */
export const CLIMB = 2.2;
export const SWIM = { pace: 0.55, sink: 1.2, rise: 2.4, depth: 1.1 } as const;

/** Whether a body in water of this surface is deep enough to swim. */
export const swimming = (body: { z: number }, water: number | undefined): boolean => water !== undefined && water - body.z >= SWIM.depth;

export const BODY = { radius: 0.32, height: 1.75, eye: 1.62, walk: 3.6, run: 6.4, jump: 5.2, gravity: 18, stepUp: 0.42 } as const;
/** A crouching body: how tall, where its eyes are, and how much slower it moves. */
export const CROUCH = { height: 1.1, eye: 0.95, speed: 0.45 } as const;

/** A body's height now: standing or crouched. */
export const heightOf = (body: Pick<Body, 'crouched'>): number => (body.crouched ? CROUCH.height : BODY.height);
/** Its eyes' height above its feet. */
export const eyeOf = (body: Pick<Body, 'crouched'>): number => (body.crouched ? CROUCH.eye : BODY.eye);

/** Everything the player bumps into, from the graybox's pieces. */
export const collidersFrom = (meshes: readonly Mesh[]): Collider[] =>
  meshes
    .filter((m) => m.collide)
    .map((m) => {
      const c: Collider = { itemId: m.itemId, part: m.part, x: m.x, y: m.z, hw: m.sx / 2, hd: m.sz / 2, rot: -m.rotY, bottom: m.y - m.sy / 2, top: m.y + m.sy / 2 };
      if (m.shape === 'slab' && m.outline) c.poly = m.outline.map((p) => world(c, p.x, p.z));
      return c;
    });

const inPoly = (poly: readonly { x: number; y: number }[], x: number, y: number) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

/** The point on a slab's edge nearest a plan point, and how far it is. */
const nearestEdge = (poly: readonly { x: number; y: number }[], x: number, y: number) => {
  let best = { x, y, d: Infinity };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const d = Math.hypot(x - px, y - py);
    if (d < best.d) best = { x: px, y: py, d };
  }
  return best;
};

const local = (c: Collider, x: number, y: number) => {
  const cos = Math.cos(c.rot);
  const sin = Math.sin(c.rot);
  const dx = x - c.x;
  const dy = y - c.y;
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
};

const world = (c: Collider, lx: number, ly: number) => {
  const cos = Math.cos(c.rot);
  const sin = Math.sin(c.rot);
  return { x: c.x + lx * cos - ly * sin, y: c.y + lx * sin + ly * cos };
};

/** Is this plan point over the collider's top (inside its footprint)? */
const over = (c: Collider, x: number, y: number, margin = 0) => {
  if (c.poly) return inPoly(c.poly, x, y) || nearestEdge(c.poly, x, y).d <= margin;
  const l = local(c, x, y);
  return Math.abs(l.x) <= c.hw + margin && Math.abs(l.y) <= c.hd + margin;
};

/** The highest surface under the feet that they can stand on (at most a step above them). */
export const groundAt = (colliders: readonly Collider[], x: number, y: number, feet: number, reach: number = BODY.stepUp): number => {
  let best = -Infinity;
  for (const c of colliders) {
    if (c.top <= feet + reach && c.top > best && over(c, x, y, BODY.radius * 0.35)) best = c.top;
  }
  return best;
};

/** Push a circle out of every collider it overlaps at this height. */
const resolve = (colliders: readonly Collider[], x: number, y: number, feet: number, head: number): { x: number; y: number } => {
  let px = x;
  let py = y;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const c of colliders) {
      // A step low enough to climb, or something above the head, is not in the way.
      if (c.top <= feet + BODY.stepUp || c.bottom >= head) continue;
      if (c.poly) {
        // A slab in the way: out by its nearest edge.
        const inside = inPoly(c.poly, px, py);
        const e = nearestEdge(c.poly, px, py);
        if (!inside && e.d >= BODY.radius) continue;
        const ux = e.d > 1e-6 ? (px - e.x) / e.d : 1;
        const uy = e.d > 1e-6 ? (py - e.y) / e.d : 0;
        const dir = inside ? -1 : 1;
        px = e.x + ux * dir * BODY.radius;
        py = e.y + uy * dir * BODY.radius;
        moved = true;
        continue;
      }
      const l = local(c, px, py);
      const cx = Math.max(-c.hw, Math.min(c.hw, l.x));
      const cy = Math.max(-c.hd, Math.min(c.hd, l.y));
      let dx = l.x - cx;
      let dy = l.y - cy;
      let d = Math.hypot(dx, dy);
      if (d >= BODY.radius) continue;
      if (d < 1e-6) {
        // The centre is inside the box: leave by the nearest side.
        const out = [c.hw - l.x, c.hw + l.x, c.hd - l.y, c.hd + l.y];
        const i = out.indexOf(Math.min(...out));
        dx = i === 0 ? 1 : i === 1 ? -1 : 0;
        dy = i === 2 ? 1 : i === 3 ? -1 : 0;
        d = 0;
        const push = Math.min(...out) + BODY.radius;
        const p = world(c, l.x + dx * push, l.y + dy * push);
        px = p.x;
        py = p.y;
      } else {
        const push = BODY.radius - d;
        const p = world(c, l.x + (dx / d) * push, l.y + (dy / d) * push);
        px = p.x;
        py = p.y;
      }
      moved = true;
    }
    if (!moved) break;
  }
  return { x: px, y: py };
};

/** One step of time: move, collide, climb, fall, land. */
/** Whether a standing body fits here: nothing solid between its crouched head and its standing one. */
export const roomToStand = (colliders: readonly Collider[], x: number, y: number, feet: number): boolean =>
  !colliders.some((c) => c.bottom < feet + BODY.height && c.top > feet + CROUCH.height && over(c, x, y, BODY.radius * 0.9));

export const step = (body: Body, input: MoveInput, dt: number, colliders: readonly Collider[]): Body => {
  // Crouch while held; stand again once there is room overhead.
  const crouched = input.crouch ? true : body.crouched ? !roomToStand(colliders, body.x, body.y, body.z) : false;
  const height = crouched ? CROUCH.height : BODY.height;
  const swims = swimming(body, input.water);
  const climbs = !!input.ladder && !swims;
  const speed = (input.run && !crouched && !swims ? BODY.run : BODY.walk) * (crouched ? CROUCH.speed : 1) * (swims ? SWIM.pace : 1);
  const len = Math.hypot(input.forward, input.strafe);
  const f = len > 1 ? input.forward / len : input.forward;
  const s = len > 1 ? input.strafe / len : input.strafe;
  // Facing north is (0, −1) on the plan; east is (1, 0).
  const fx = input.worldAxes ? 0 : Math.sin(body.yaw);
  const fy = input.worldAxes ? -1 : -Math.cos(body.yaw);
  const rx = input.worldAxes ? 1 : Math.cos(body.yaw);
  const ry = input.worldAxes ? 0 : Math.sin(body.yaw);
  // On a ladder, forward and back climb; only sidesteps move across it.
  const across = climbs ? 0 : f;
  const vx = (fx * across + rx * s) * speed * (climbs ? 0.5 : 1);
  const vy = (fy * across + ry * s) * speed * (climbs ? 0.5 : 1);

  let { x, y, z, vz } = body;
  // Small sub-steps, so fast moves can't pass through thin walls.
  const steps = Math.max(1, Math.ceil((Math.hypot(vx, vy) * dt) / 0.1));
  for (let i = 0; i < steps; i++) {
    const nx = x + (vx * dt) / steps;
    const ny = y + (vy * dt) / steps;
    const p = resolve(colliders, nx, ny, z, z + height);
    x = p.x;
    y = p.y;
    // Walking up a step lifts the feet onto it.
    if (body.grounded) {
      const g = groundAt(colliders, x, y, z);
      if (g > z && g - z <= BODY.stepUp) z = g;
    }
  }

  let grounded = body.grounded;
  // Only bodies that climb or swim carry the flags (set to false once they stop).
  const flags = { ...(climbs || body.climbing ? { climbing: climbs } : {}), ...(swims || body.swimming ? { swimming: swims } : {}) };
  if (climbs || swims) {
    // Climbing holds the body where the ladder takes it; swimming sinks slowly and jump swims up, to tread water at the surface.
    vz = climbs ? f * CLIMB : input.jump ? SWIM.rise : Math.max(vz - BODY.gravity * 0.15 * dt, -SWIM.sink);
    let nz = z + vz * dt;
    if (swims && input.jump) nz = Math.min(nz, input.water! - SWIM.depth + 0.05);
    const ground = groundAt(colliders, x, y, Math.max(z, nz));
    const landed = nz <= ground;
    if (landed) nz = ground;
    return { ...body, x, y, z: nz, vz: landed ? 0 : vz, grounded: landed, ...flags, ...(crouched || body.crouched ? { crouched } : {}) };
  }
  if (grounded && input.jump && !crouched) {
    vz = BODY.jump;
    grounded = false;
  }
  vz -= BODY.gravity * dt;
  let nz = z + vz * dt;
  const ground = groundAt(colliders, x, y, Math.max(z, nz));
  if (nz <= ground) {
    nz = ground;
    vz = 0;
    grounded = true;
  } else if (grounded && z - ground <= BODY.stepUp && vz <= 0) {
    // Walking down a step keeps the feet on the ground.
    nz = ground;
    vz = 0;
  } else {
    grounded = false;
    // Hitting a ceiling stops the rise.
    if (vz > 0) {
      for (const c of colliders) {
        if (c.bottom >= z + height && c.bottom <= nz + height && over(c, x, y)) {
          nz = c.bottom - height;
          vz = 0;
        }
      }
    }
  }
  return { ...body, x, y, z: nz, vz, grounded, ...flags, ...(crouched || body.crouched ? { crouched } : {}) };
};

/** Turn and look (radians), keeping the look between straight down and straight up. */
export const look = (body: Body, dYaw: number, dPitch: number): Body => ({
  ...body,
  yaw: (((body.yaw + dYaw) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
  pitch: Math.max(-1.45, Math.min(1.45, body.pitch + dPitch)),
});

/** Where the body is looking on the plan. */
export const facing = (body: Body): { x: number; y: number } => ({ x: Math.sin(body.yaw), y: -Math.cos(body.yaw) });
