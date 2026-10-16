import { assetOf, bool, frameOf, num, paramOf } from './geometry';
import { findPath, REPLAN, type NavGraph } from './nav';
import type { AssetDefinition, LevelItem, LevelSet } from './types';

/**
 * Actors that move (spec §11): an NPC, enemy or neutral actor with a Patrol
 * walks the patrol nodes of that name in their order, waiting at each for its
 * Wait, round and round; a companion keeps within its follow distance of the
 * player. Where the level has ground to stand on they find their way there
 * on the navigation graph (§19 navmesh, `findPath`), round walls and through
 * doorways, and stand where there is no way at all; with no graph they walk
 * straight. A companion left far behind (on another floor, through a door
 * that shut) catches up at once.
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
  /** The way it is walking (the points still ahead), and where that way was planned to; an empty route is no way there. */
  route?: { x: number; y: number; z: number }[];
  aim?: { x: number; y: number; z: number };
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
    // Actors that move, and those that watch (a pose says where they look).
    if (item.levelId !== levelId || item.hidden || (!motionOf(set, item, global) && sightOf(set, item, global).range <= 0)) continue;
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

type Spot = { x: number; y: number; z: number };
const settled = (p: ActorPose): ActorPose => {
  if (!p.route && !p.aim) return p;
  const { route: _r, aim: _a, ...rest } = p;
  return rest;
};

/**
 * Walk toward a target at most `by` metres, stopping `keep` short of it. With
 * no graph, straight there; else along the way round walls, kept in the pose
 * and planned again when the target moves. With no way there it stands.
 */
const travel = (p: ActorPose, to: Spot, by: number, keep: number, nav?: NavGraph | null): { pose: ActorPose; arrived: boolean } => {
  if (!nav) {
    const dx = to.x - p.x;
    const dy = to.y - p.y;
    const d = Math.hypot(dx, dy);
    if (keep <= 0) return walk(p, to.x, to.y, to.z, by);
    if (d <= keep) return { pose: p, arrived: true };
    const k = d > 1e-6 ? (d - keep) / d : 0;
    return walk(p, p.x + dx * k, p.y + dy * k, to.z, by);
  }
  let pose = p;
  if (!p.route || !p.aim || Math.hypot(p.aim.x - to.x, p.aim.y - to.y) > REPLAN || Math.abs(p.aim.z - to.z) > 1) {
    pose = { ...p, route: findPath(nav, p, to) ?? [], aim: { x: to.x, y: to.y, z: to.z } };
  }
  let route = pose.route!;
  // No way there: stand.
  if (!route.length) return { pose: pose.moving ? { ...pose, moving: false } : pose, arrived: false };
  let remaining = Math.hypot(route[0]!.x - pose.x, route[0]!.y - pose.y);
  for (let i = 1; i < route.length; i++) remaining += Math.hypot(route[i]!.x - route[i - 1]!.x, route[i]!.y - route[i - 1]!.y);
  if (remaining <= keep + 1e-6) {
    const dx = to.x - pose.x;
    const dy = to.y - pose.y;
    return { pose: settled({ ...pose, moving: false, yaw: Math.hypot(dx, dy) > 1e-6 ? yawOf(dx, dy) : pose.yaw }), arrived: true };
  }
  const arrived = remaining - keep <= by;
  let left = Math.min(by, remaining - keep);
  while (left > 1e-9 && route.length) {
    const next = route[0]!;
    const d = Math.hypot(next.x - pose.x, next.y - pose.y);
    const step = walk(pose, next.x, next.y, next.z, left);
    pose = step.pose;
    if (!step.arrived) break;
    left -= d;
    route = route.slice(1);
  }
  // Arriving at the end itself, exactly there.
  const end = pose.route![pose.route!.length - 1]!;
  if (arrived && keep <= 0) pose = { ...pose, x: end.x, y: end.y, z: end.z };
  pose = { ...pose, route };
  return { pose: arrived ? settled(pose) : pose, arrived };
};

/** One patrol step: wait at a stop, else walk on to it; arriving starts the wait and aims at the next. */
export const stepPatrol = (p: ActorPose, m: Extract<Motion, { kind: 'patrol' }>, dt: number, time: number, nav?: NavGraph | null): ActorPose => {
  if (time < p.until) return p.moving ? { ...p, moving: false } : p;
  const at = m.stops[p.stop % m.stops.length]!;
  const { pose, arrived } = travel(p, at, m.speed * dt, 0, nav);
  return arrived ? { ...pose, moving: false, until: time + at.wait, stop: (p.stop + 1) % m.stops.length } : pose;
};

/** One follow step: keep within the distance of the player (faster when far), catching up at once past CATCH_UP. */
export const stepFollow = (p: ActorPose, m: Extract<Motion, { kind: 'follow' }>, dt: number, player: { x: number; y: number; z: number }, nav?: NavGraph | null): ActorPose => {
  const dx = player.x - p.x;
  const dy = player.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d > CATCH_UP || Math.abs(player.z - p.z) > 3) {
    // Behind the player, on their ground.
    const k = d > 1e-6 ? m.distance / d : 0;
    return settled({ ...p, x: player.x - dx * k, y: player.y - dy * k - (d > 1e-6 ? 0 : m.distance), z: player.z, yaw: d > 1e-6 ? yawOf(dx, dy) : p.yaw, moving: false });
  }
  if (d <= m.distance) return p.moving || p.route ? settled({ ...p, moving: false, yaw: d > 1e-6 ? yawOf(dx, dy) : p.yaw }) : p;
  const speed = d > m.distance * 2.5 ? m.speed * 1.6 : m.speed;
  return travel(p, player, speed * dt, m.distance, nav).pose;
};

/** What an actor does while it sees the player (spec §11, AI behaviours): chase them, or stop and watch; null carries on. */
export type Reaction = { kind: 'chase'; speed: number; reach: number } | { kind: 'watch' };

export const REACTIONS = ['carry on', 'chase', 'watch'] as const;

export const reactionOf = (set: LevelSet, item: LevelItem, global?: readonly AssetDefinition[]): Reaction | null => {
  const r = String(paramOf(set, item, 'onSight', global) ?? 'carry on');
  if (r === 'chase') return { kind: 'chase', speed: Math.max(0.1, num(paramOf(set, item, 'chaseSpeed', global), 3.5)), reach: 1 };
  if (r === 'watch') return { kind: 'watch' };
  return null;
};

/** One step of a reaction: face the player, and for a chase close in on them (to arm's reach, on their ground). */
export const stepReaction = (p: ActorPose, r: Reaction, dt: number, player: { x: number; y: number; z: number }, nav?: NavGraph | null): ActorPose => {
  const dx = player.x - p.x;
  const dy = player.y - p.y;
  const d = Math.hypot(dx, dy);
  const yaw = d > 1e-6 ? yawOf(dx, dy) : p.yaw;
  // A route planned to a patrol stop is no use now.
  if (r.kind === 'watch' || d <= r.reach) return p.moving || p.yaw !== yaw || p.route ? settled({ ...p, moving: false, yaw }) : p;
  return travel(p, player, r.speed * dt, r.reach, nav).pose;
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
  /** Actors that see the player now: they do what their "When it sees the player" says instead. */
  seen?: Readonly<Record<string, boolean>>,
  /** The level's navigation graph: actors find their way round walls on it (none: they walk straight). */
  nav?: NavGraph | null,
): Record<string, ActorPose> => {
  let next: Record<string, ActorPose> | null = null;
  for (const [id, pose] of Object.entries(poses)) {
    const item = set.items.find((i) => i.id === id);
    if (!item || !here(item)) continue;
    const reaction = seen?.[id] ? reactionOf(set, item, global) : null;
    const m = reaction ? null : motionOf(set, item, global);
    if (!reaction && !m) continue;
    const moved = reaction ? stepReaction(pose, reaction, dt, player, nav) : m!.kind === 'patrol' ? stepPatrol(pose, m!, dt, time, nav) : stepFollow(pose, m!, dt, player, nav);
    if (moved !== pose) (next ??= { ...poses })[id] = moved;
  }
  return next ?? (poses as Record<string, ActorPose>);
};

// ---------------------------------------------------------------- line of sight (spec §11: sight triggers)

/** How far an actor sees and how wide (degrees); 0 range is blind. */
export const sightOf = (set: LevelSet, item: LevelItem, global?: readonly AssetDefinition[]): { range: number; fov: number } => ({
  range: Math.max(0, num(paramOf(set, item, 'sight', global), 0)),
  fov: Math.min(360, Math.max(1, num(paramOf(set, item, 'fov', global), 90))),
});

/** What blocks sight: a box on the plan between two heights (the controller's colliders fit). */
export interface Blocker {
  itemId: string;
  x: number;
  y: number;
  hw: number;
  hd: number;
  rot: number;
  bottom: number;
  top: number;
  part?: string;
}

/** Whether the segment from a to b on the plan passes through the box (in its own frame, Liang–Barsky). */
const crosses = (a: { x: number; y: number }, b: { x: number; y: number }, box: Blocker): boolean => {
  const c = Math.cos(-box.rot);
  const s = Math.sin(-box.rot);
  const local = (p: { x: number; y: number }) => ({ x: (p.x - box.x) * c - (p.y - box.y) * s, y: (p.x - box.x) * s + (p.y - box.y) * c });
  const p = local(a);
  const q = local(b);
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  for (const [num, den] of [
    [p.x + box.hw, -dx],
    [box.hw - p.x, dx],
    [p.y + box.hd, -dy],
    [box.hd - p.y, dy],
  ] as const) {
    if (den === 0) {
      if (num < 0) return false;
      continue;
    }
    const t = num / den;
    if (den < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  // Touching only at the very ends (the actor or player standing against it) doesn't block.
  return t1 - t0 > 1e-6 && t0 < 1 - 1e-6 && t1 > 1e-6;
};

const EYE = 1.6;

/**
 * Whether an actor standing at its pose sees a point: near enough, inside its
 * field of view (facing its yaw), and nothing solid in the way at eye height.
 */
export const canSee = (pose: ActorPose, at: { x: number; y: number; z: number }, sight: { range: number; fov: number }, blockers: readonly Blocker[]): boolean => {
  if (sight.range <= 0) return false;
  const dx = at.x - pose.x;
  const dy = at.y - pose.y;
  const d = Math.hypot(dx, dy);
  if (d > sight.range || Math.abs(at.z - pose.z) > 3) return false;
  if (d > 1e-6 && sight.fov < 360) {
    // Yaw 0 faces north (−y), turning clockwise.
    const facing = { x: Math.sin(pose.yaw), y: -Math.cos(pose.yaw) };
    if ((facing.x * dx + facing.y * dy) / d < Math.cos(((sight.fov / 2) * Math.PI) / 180) - 1e-9) return false;
  }
  const eye = (pose.z + at.z) / 2 + EYE;
  return !blockers.some((b) => b.bottom < eye && b.top > eye && crosses(pose, at, b));
};
