import { canSee, patrolStops, type Blocker } from '../level/actors';
import { assetOf, frameOf, num, paramOf } from '../level/geometry';
import { nextOnWay, type NavGraph, type Way } from '../level/nav';
import type { AssetDefinition, LevelItem, LevelSet } from '../level/types';
import type { Project, StoryObject } from '../types';
import { abilityTemplate } from './abilities';
import { aiStep, startMemory, type AIMemory, type AIProfile } from './ai';
import { groupById, insideArea, populate, rng, type Activity, type CrowdMember, type PlacementArea } from './groups';
import { paramsOf, profileOf, type CharacterProfile, type Placeholder } from './profile';
import { resolveVariant } from './variants';

/**
 * Characters in a level, as the 3D graybox and Play Mode show them (spec §7,
 * §8): every Character group area's people, and every placed actor whose
 * character is an enemy with an AI profile. Each is a placeholder figure in
 * its character's tint and silhouette with its prop in hand; ambient people
 * wander, idle, chat, work, patrol or guard and flee as their character
 * says; AI enemies run their state machine (`aiStep`) against the player,
 * with the level's walls blocking sight, and their attacks hurt. Pure
 * functions over the level and the play clock, so they are tested and the
 * view only draws.
 */

export interface CastMember {
  key: string;
  /** The level item it comes from: a group area or a placed actor. */
  itemId: string;
  character: string;
  name: string;
  variant?: string;
  activity: Activity;
  home: { x: number; y: number };
  z: number;
  yaw: number;
  speed: number;
  height: number;
  placeholder: Placeholder;
  wanderRadius: number;
  fleeFrom: 'combat' | 'player' | 'never';
  /** Patrol stops for a patrolling member: the group's route, offset to its place in the formation. */
  route: { x: number; y: number }[];
  /** An enemy (or ally) with AI: its effective profile (variant applied). */
  ai?: AIProfile;
  health: number;
  /** Damage an attack does. */
  damage: number;
  /** How many of its kind may attack at once. */
  maxAttackers: number;
  /** A placed actor (not a group member): its item's own pose drives it in play. */
  placed: boolean;
  /** A group member's area: it wanders within it. */
  area?: PlacementArea;
}

const elevationOf = (set: LevelSet, item: LevelItem): number =>
  set.levels.find((l) => l.id === item.levelId)?.floors.find((f) => f.id === item.floorId)?.elevation ?? 0;

/** What one hit of its first enabled combat or magic ability does. */
const hitOf = (p: CharacterProfile): number => {
  const card = p.abilities.find((a) => a.enabled && (a.category === 'combat' || a.category === 'magic') && a.kind === 'active');
  if (!card) return 5;
  const m = paramsOf(card).magnitude || (card.source.kind === 'library' ? (abilityTemplate(card.source.key)?.defaults.magnitude ?? 5) : 5);
  return m * (1 + (card.rank - 1) * 0.25);
};

const effective = (c: StoryObject, variant?: string): CharacterProfile => {
  const p = profileOf(c);
  const v = variant ? p.variants.find((x) => x.id === variant) : undefined;
  return v ? resolveVariant(p, v) : p;
};

const hasAI = (p: CharacterProfile) => p.roles.includes('enemy');

const memberOf = (project: Project, m: CrowdMember | { key: string; character: string; variant?: string; activity: Activity; x: number; y: number; yaw: number }, itemId: string, z: number, route: { x: number; y: number }[], wanderRadius: number, placed: boolean): CastMember | undefined => {
  const c = project.objects[m.character];
  if (c?.type !== 'character') return undefined;
  const p = effective(c, m.variant);
  if (!p.enabled) return undefined;
  const base = profileOf(c);
  return {
    key: m.key,
    itemId,
    character: c.id,
    name: c.name,
    ...(m.variant ? { variant: m.variant } : {}),
    activity: m.activity,
    home: { x: m.x, y: m.y },
    z,
    yaw: m.yaw,
    speed: p.stats.speed,
    height: p.stats.height * p.art.placeholder.scale,
    placeholder: p.art.placeholder,
    wanderRadius: Math.max(0, p.roles.includes('extra') && !placed ? Math.min(wanderRadius, p.extra.wanderRadius || wanderRadius) : wanderRadius),
    fleeFrom: p.roles.includes('extra') ? p.extra.fleeFrom : 'never',
    route,
    ...(hasAI(p) ? { ai: p.ai } : {}),
    health: p.stats.health,
    damage: hitOf(p),
    maxAttackers: base.variantRules.maxAttackers,
    placed,
  };
};

/** Whether a point on the plan is inside something solid (people aren't put there). */
export const solidAt = (blockers: readonly Blocker[], p: { x: number; y: number }, z: number): boolean =>
  blockers.some((b) => {
    if (b.bottom > z + 1.2 || b.top < z + 0.3) return false;
    const c = Math.cos(-b.rot);
    const s = Math.sin(-b.rot);
    const lx = (p.x - b.x) * c - (p.y - b.y) * s;
    const ly = (p.x - b.x) * s + (p.y - b.y) * c;
    return Math.abs(lx) <= b.hw + 0.25 && Math.abs(ly) <= b.hd + 0.25;
  });

/** Every character in a level: group areas' people, then placed AI enemies. */
export const castOf = (project: Project, set: LevelSet, levelId: string, global?: readonly AssetDefinition[], blockers: readonly Blocker[] = []): CastMember[] => {
  const out: CastMember[] = [];
  for (const item of set.items) {
    if (item.levelId !== levelId || item.hidden) continue;
    const def = assetOf(set, item, global);
    const z = elevationOf(set, item) + item.z;
    if (def.role === 'crowd') {
      const g = groupById(project, String(paramOf(set, item, 'group', global) ?? ''));
      if (!g) continue;
      const f = frameOf(set, item, global);
      const reseed = num(paramOf(set, item, 'reseed', global), 0);
      const area: PlacementArea = { x: f.x, y: f.y, w: f.w, d: f.d, rotation: f.rotation, ...(f.outline ? { outline: f.outline } : {}) };
      const pop = populate(project, { ...g, seed: g.seed + reseed * 7919 }, area, item.id, (p) => solidAt(blockers, p, z));
      const stops = g.route.trim() ? patrolStops(set, levelId, g.route, global) : [];
      for (const m of pop.members) {
        const route = m.activity === 'patrol' && stops.length ? stops.map((s) => ({ x: s.x + (m.offset?.x ?? 0) * 0.3, y: s.y + (m.offset?.y ?? 0) * 0.3 })) : [];
        const c = memberOf(project, m, item.id, z, route, g.wanderRadius, false);
        if (c) out.push({ ...c, area });
      }
    } else if (def.role === 'enemy') {
      const character = String(paramOf(set, item, 'character', global) ?? '');
      const o = project.objects[character];
      if (o?.type !== 'character' || !hasAI(profileOf(o))) continue;
      const f = frameOf(set, item, global);
      const name = String(paramOf(set, item, 'patrol', global) ?? '').trim();
      const stops = name ? patrolStops(set, levelId, name, global).map((s) => ({ x: s.x, y: s.y })) : [];
      const variant = String(paramOf(set, item, 'variant', global) ?? '') || undefined;
      const c = memberOf(project, { key: item.id, character, ...(variant ? { variant } : {}), activity: stops.length ? 'patrol' : 'guard', x: f.x, y: f.y, yaw: (item.rotation * Math.PI) / 180 }, item.id, z, stops, 0, true);
      if (c) out.push(c);
    }
  }
  return out;
};

// ---------------------------------------------------------------- moving them

export interface CastPose {
  x: number;
  y: number;
  z: number;
  /** As the player's yaw: 0 north, clockwise. */
  yaw: number;
  moving: boolean;
  until: number;
  target?: { x: number; y: number };
  stop: number;
  /** Draws of its own random numbers so far (deterministic per member). */
  draws: number;
  fleeing?: boolean;
  /** An AI member's machine. */
  mem?: AIMemory;
  /** The way round walls it is walking, on the level's navigation graph. */
  way?: Way;
}

export const startCast = (cast: readonly CastMember[]): Record<string, CastPose> =>
  Object.fromEntries(
    cast.map((c) => [
      c.key,
      {
        x: c.home.x,
        y: c.home.y,
        z: c.z,
        yaw: c.yaw,
        moving: false,
        until: 0,
        stop: 0,
        draws: 0,
        ...(c.ai ? { mem: { ...startMemory({ patrol: [c.home, ...c.route], walls: [], target: { x: 0, y: 0, noisy: false, alive: false } }, c.ai.states.includes('patrol') && c.route.length ? c.ai : { ...c.ai, start: 'idle' }, c.health), facing: c.yaw - Math.PI / 2 } } : {}),
      },
    ]),
  );

const hashKey = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** The member's n-th random number: the same every run. */
const draw = (key: string, n: number) => rng(hashKey(key) + n * 104729)();

const walkTo = (p: CastPose, to: { x: number; y: number }, by: number): { pose: CastPose; arrived: boolean } => {
  const dx = to.x - p.x;
  const dy = to.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d <= by || d < 1e-6) return { pose: { ...p, x: to.x, y: to.y, moving: false, yaw: d > 1e-6 ? Math.atan2(dx, -dy) : p.yaw }, arrived: true };
  const k = by / d;
  return { pose: { ...p, x: p.x + dx * k, y: p.y + dy * k, moving: true, yaw: Math.atan2(dx, -dy) }, arrived: false };
};

export interface CastStep {
  poses: Record<string, CastPose>;
  /** Damage done to the player this step. */
  damage: number;
  /** What happened, for the play log: "Orc Guard: Patrol → Alert: Sees it…". */
  events: string[];
}

/**
 * Move everyone by dt. Ambient people follow their activity (and flee when
 * their character does); AI enemies run their machine on the plan around
 * the player, with `blocked` saying when a wall is in the way, attacking
 * (no more at once than their guardrail allows) when in range. Given the
 * level's navigation graph, everyone walks round walls on it.
 */
export const stepCast = (
  cast: readonly CastMember[],
  poses: Readonly<Record<string, CastPose>>,
  dt: number,
  time: number,
  player: { x: number; y: number; z: number; alive: boolean; noisy: boolean },
  blocked: (a: { x: number; y: number }, b: { x: number; y: number }) => boolean,
  nav?: NavGraph | null,
): CastStep => {
  const next: Record<string, CastPose> = { ...poses };
  let damage = 0;
  const events: string[] = [];
  // Danger: AI enemies chasing or attacking, for those who flee from fights.
  const danger = cast.filter((c) => c.ai && ['chase', 'attack'].includes(poses[c.key]?.mem?.state ?? '')).map((c) => poses[c.key]!);
  let attackers = cast.filter((c) => poses[c.key]?.mem?.state === 'attack').length;
  for (const c of cast) {
    const p0 = poses[c.key];
    if (!p0) continue;
    let p = p0;
    // Toward a place by the way round walls (standing when there is none); straight with no graph.
    const walkVia = (q: CastPose, to: { x: number; y: number }, by: number): { pose: CastPose; arrived: boolean } => {
      if (!nav) return walkTo(q, to, by);
      const goal = { x: to.x, y: to.y, z: c.z };
      const r = nextOnWay(nav, q.way, { x: q.x, y: q.y, z: c.z }, goal);
      if (!r.next) return { pose: { ...q, way: r.way, moving: false }, arrived: false };
      const step = walkTo({ ...q, way: r.way }, r.next, by);
      if (r.next !== goal) return { pose: { ...step.pose, moving: true }, arrived: false };
      if (!step.arrived) return step;
      const { way: _w, ...rest } = step.pose;
      return { pose: rest, arrived: true };
    };
    if (c.ai && p.mem) {
      const route = [c.home, ...c.route];
      let way = p.way;
      const steer = nav
        ? (from: { x: number; y: number }, to: { x: number; y: number }) => {
            const goal = { x: to.x, y: to.y, z: c.z };
            const r = nextOnWay(nav, way, { x: from.x, y: from.y, z: c.z }, goal);
            way = r.way;
            return r.next === goal ? to : r.next;
          }
        : undefined;
      const r = aiStep(c.ai, c.speed, { ...p.mem, pos: { x: p.x, y: p.y } }, { target: { x: player.x, y: player.y, noisy: player.noisy, alive: player.alive && Math.abs(player.z - c.z) < 3 }, patrol: route, walls: [], blocked, ...(steer ? { steer } : {}) }, dt);
      const m = r.memory;
      if (r.reason) events.push(`${c.name}: ${r.reason}`);
      if (r.attacked) {
        if (attackers <= c.maxAttackers) {
          // Accuracy decides how much of a blow lands.
          damage += c.damage * (0.5 + c.ai.skill.accuracy / 200);
          events.push(`${c.name} attacks`);
        }
      }
      if (m.state === 'attack' && p.mem.state !== 'attack') attackers++;
      p = { ...p, x: m.pos.x, y: m.pos.y, yaw: m.facing + Math.PI / 2, moving: Math.hypot(m.pos.x - p.x, m.pos.y - p.y) > 1e-4, mem: m, ...(way ? { way } : {}) };
      next[c.key] = p;
      continue;
    }
    // Fleeing: from the player, or from a fight nearby.
    const near = Math.hypot(player.x - p.x, player.y - p.y);
    const threat = c.fleeFrom === 'player' && near < 5 && player.alive ? player : c.fleeFrom === 'combat' ? danger.find((d) => Math.hypot(d.x - p.x, d.y - p.y) < 15) : undefined;
    if (threat) {
      const away = Math.atan2(p.y - threat.y, p.x - threat.x);
      const to = { x: c.home.x + Math.cos(away) * (c.wanderRadius + 4), y: c.home.y + Math.sin(away) * (c.wanderRadius + 4) };
      p = { ...walkVia(p, to, c.speed * 1.2 * dt).pose, fleeing: true, until: time + 3 };
      next[c.key] = p;
      continue;
    }
    if (p.fleeing && time < p.until) continue;
    if (p.fleeing) p = { ...p, fleeing: false, target: undefined };
    switch (c.activity) {
      case 'wander': {
        if (time < p.until) break;
        if (!p.target) {
          const a = draw(c.key, p.draws) * Math.PI * 2;
          const r = Math.sqrt(draw(c.key, p.draws + 1)) * c.wanderRadius;
          const to = { x: c.home.x + Math.cos(a) * r, y: c.home.y + Math.sin(a) * r };
          // Somewhere it can walk to in a line, inside its group's area.
          p = blocked(p, to) || (c.area && !insideArea(c.area, to)) ? { ...p, draws: p.draws + 2, until: time + 0.5 } : { ...p, target: to, draws: p.draws + 2 };
          break;
        }
        const { pose, arrived } = walkVia(p, p.target, c.speed * 0.35 * dt);
        p = arrived ? { ...pose, target: undefined, until: time + 1 + draw(c.key, p.draws) * 3, draws: p.draws + 1 } : pose;
        break;
      }
      case 'patrol': {
        if (!c.route.length || time < p.until) break;
        const to = c.route[p.stop % c.route.length]!;
        const { pose, arrived } = walkVia(p, to, c.speed * 0.45 * dt);
        p = arrived ? { ...pose, stop: (p.stop + 1) % c.route.length, until: time + 1 } : pose;
        break;
      }
      case 'idle':
        if (time >= p.until) p = { ...p, yaw: p.yaw + (draw(c.key, p.draws) - 0.5) * 1.6, until: time + 2 + draw(c.key, p.draws + 1) * 3, draws: p.draws + 2 };
        break;
      case 'work':
      case 'talk':
      case 'guard':
        // Back to its spot when something moved it (a flight).
        if (Math.hypot(p.x - c.home.x, p.y - c.home.y) > 0.3) p = walkVia(p, c.home, c.speed * 0.5 * dt).pose;
        else if (p.moving) p = { ...p, moving: false, yaw: c.yaw };
        break;
    }
    if (p !== p0) next[c.key] = p;
  }
  return { poses: next, damage, events };
};

/** For a test or the view: how a member stands right now, in words. */
export const describeMember = (c: CastMember, p: CastPose | undefined): string =>
  p?.mem ? `${c.name}: ${p.mem.state}` : p?.fleeing ? `${c.name}: fleeing` : `${c.name}: ${c.activity}${p?.moving ? ' (moving)' : ''}`;

/** A blocked test for sight from blockers, as the level's own line of sight works. */
export const sightBlocked = (blockers: readonly Blocker[], z: number) => (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
  !canSee({ x: a.x, y: a.y, z, yaw: 0, stop: 0, until: 0, moving: false }, { x: b.x, y: b.y, z }, { range: 1e9, fov: 360 }, blockers);
