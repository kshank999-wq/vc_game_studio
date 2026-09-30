import { assetOf, bool, frameOf, num, paramOf } from './geometry';
import type { AssetDefinition, LevelItem, LevelSet } from './types';

/**
 * Actors that move (spec §11): an NPC, enemy or neutral actor with a Patrol
 * walks the patrol nodes of that name in their order, waiting at each for its
 * Wait, round and round; a companion keeps within its follow distance of the
 * player. They walk straight from stop to stop (no pathfinding), so a patrol
 * is laid out with a clear line between its stops. A companion left far
 * behind (round a corner, through a door that shut) catches up at once.
 * Pure functions over the level: the same rules as the engines' runtimes.
 */

/** Roles that can walk a patrol. */
export const PATROLLERS: ReadonlySet<string> = new Set(['npc', 'enemy', 'neutral']);
/** How far behind a companion may fall before it catches up at once. */
export const CATCH_UP = 12;

export interface PatrolStop {
  itemId: string;
  x: number;
  y: number;
  /** Height of the stop's feet above the level's origin. */
  z: number;
  /** Seconds to wait there. */
  wait: number;
}

export type Motion =
  | { kind: 'patrol'; name: string; stops: PatrolStop[]; speed: number }
  | { kind: 'follow'; distance: number; speed: number };

/** Where an actor is now, and what it is doing. */
export interface ActorPose {
  x: number;
  y: number;
  z: number;
  /** Facing, in radians: 0 is north (−y), clockwise, as the player's yaw. */
  yaw: number;
  /** The stop it is walking to (patrols). */
  stop: number;
  /** Play time it waits until (patrols). */
  until: number;
  moving: boolean;
}

const elevationOf = (set: LevelSet, item: LevelItem): number =>
  set.levels.find((l) => l.id === item.levelId)?.floors.find((f) => f.id === item.floorId)?.elevation ?? 0;

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A patrol's stops, in their order (then as placed): the patrol nodes in the level with that name. */
export const patrolStops = (set: LevelSet, levelId: string, name: string, global?: readonly AssetDefinition[]): PatrolStop[] =>
  !name.trim()
    ? []
    : set.items
        .filter((i) => i.levelId === levelId && !i.hidden && assetOf(set, i, global).role === 'patrolNode' && sameName(String(paramOf(set, i, 'path', global) ?? ''), name))
        .sort((a, b) => num(paramOf(set, a, 'order', global), 1) - num(paramOf(set, b, 'order', global), 1) || a.serial - b.serial)
        .map((i) => {
          const f = frameOf(set, i, global);
          return { itemId: i.id, x: f.x, y: f.y, z: elevationOf(set, i) + i.z, wait: Math.max(0, num(paramOf(set, i, 'wait', global), 2)) };
        });

/** How an item moves in play, or null when it stands where it is. */
export const motionOf = (set: LevelSet, item: LevelItem, global?: readonly AssetDefinition[]): Motion | null => {
  const role = assetOf(set, item, global).role;
  if (role === 'companion') {
    if (!bool(paramOf(set, item, 'follow', global), true)) return null;
    return { kind: 'follow', distance: Math.max(0.5, num(paramOf(set, item, 'distance', global), 2)), speed: Math.max(0.1, num(paramOf(set, item, 'speed', global), 3.5)) };
  }
  if (!PATROLLERS.has(role)) return null;
  const name = String(paramOf(set, item, 'patrol', global) ?? '').trim();
  const stops = patrolStops(set, item.levelId, name, global);
  return stops.length ? { kind: 'patrol', name, stops, speed: Math.max(0.1, num(paramOf(set, item, 'speed', global), 1.4)) } : null;
};

/** The actors in a level that move, by item id, standing where they were placed. */
export const startPoses = (set: LevelSet, levelId: string, global?: readonly AssetDefinition[]): Record<string, ActorPose> => {
  const poses: Record<string, ActorPose> = {};
  for (const item of set.items) {
    if (item.levelId !== levelId || item.hidden || !motionOf(set, item, global)) continue;
    const f = frameOf(set, item, global);
    poses[item.id] = { x: f.x, y: f.y, z: elevationOf(set, item) + item.z, yaw: (item.rotation * Math.PI) / 180, stop: 0, until: 0, moving: false };
  }
  return poses;
};

/** Facing from a step (dx east, dy south), as the player's yaw. */
const yawOf = (dx: number, dy: number) => Math.atan2(dx, -dy);

/** Walk toward (tx, ty, tz) at most `by` metres; the z follows the ground covered. */
const walk = (p: ActorPose, tx: number, ty: number, tz: number, by: number): { pose: ActorPose; arrived: boolean } => {
  const dx = tx - p.x;
  const dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  if (d <= by || d < 1e-6) return { pose: { ...p, x: tx, y: ty, z: tz, yaw: d > 1e-6 ? yawOf(dx, dy) : p.yaw, moving: d > 1e-6 }, arrived: true };
  const k = by / d;
  return { pose: { ...p, x: p.x + dx * k, y: p.y + dy * k, z: p.z + (tz - p.z) * k, yaw: yawOf(dx, dy), moving: true }, arrived: false };
};

/** One patrol step: wait at a stop, else walk on to it; arriving starts the wait and aims at the next. */
export const stepPatrol = (p: ActorPose, m: Extract<Motion, { kind: 'patrol' }>, dt: number, time: number): ActorPose => {
  if (time < p.until) return p.moving ? { ...p, moving: false } : p;
  const at = m.stops[p.stop % m.stops.length]!;
  const { pose, arrived } = walk(p, at.x, at.y, at.z, m.speed * dt);
  return arrived ? { ...pose, moving: false, until: time + at.wait, stop: (p.stop + 1) % m.stops.length } : pose;
};

/** One follow step: keep within the distance of the player (faster when far), catching up at once past CATCH_UP. */
export const stepFollow = (p: ActorPose, m: Extract<Motion, { kind: 'follow' }>, dt: number, player: { x: number; y: number; z: number }): ActorPose => {
  const dx = player.x - p.x;
  const dy = player.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d > CATCH_UP || Math.abs(player.z - p.z) > 3) {
    // Behind the player, on their ground.
    const k = d > 1e-6 ? m.distance / d : 0;
    return { ...p, x: player.x - dx * k, y: player.y - dy * k - (d > 1e-6 ? 0 : m.distance), z: player.z, yaw: d > 1e-6 ? yawOf(dx, dy) : p.yaw, moving: false };
  }
  if (d <= m.distance) return p.moving ? { ...p, moving: false, yaw: d > 1e-6 ? yawOf(dx, dy) : p.yaw } : p;
  const speed = d > m.distance * 2.5 ? m.speed * 1.6 : m.speed;
  const k = (d - m.distance) / d;
  return walk(p, p.x + dx * k, p.y + dy * k, player.z, speed * dt).pose;
};

/**
 * Move every actor that moves by dt seconds (the play time is `time`, after
 * the step): patrols on along their stops, companions after the player.
 * Actors not in the level now (taken, switched off) stand still.
 */
export const stepActors = (
  set: LevelSet,
  poses: Readonly<Record<string, ActorPose>>,
  dt: number,
  time: number,
  player: { x: number; y: number; z: number },
  here: (item: LevelItem) => boolean,
  global?: readonly AssetDefinition[],
): Record<string, ActorPose> => {
  let next: Record<string, ActorPose> | null = null;
  for (const [id, pose] of Object.entries(poses)) {
    const item = set.items.find((i) => i.id === id);
    const m = item && here(item) ? motionOf(set, item, global) : null;
    if (!m) continue;
    const moved = m.kind === 'patrol' ? stepPatrol(pose, m, dt, time) : stepFollow(pose, m, dt, player);
    if (moved !== pose) (next ??= { ...poses })[id] = moved;
  }
  return next ?? (poses as Record<string, ActorPose>);
};
