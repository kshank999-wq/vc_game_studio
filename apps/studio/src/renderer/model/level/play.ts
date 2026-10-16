import { canSee, sightOf, startPoses, stepActors, type ActorPose, type Blocker } from './actors';
import { castOf, sightBlocked, startCast, stepCast, type CastMember, type CastPose } from '../character/crowd';
import { collidersFrom } from './controller';
import { craftCheck, recipeOf, recipesOf } from '../crafting';
import { equipCheck, equipmentList, isEquipped, useCheck } from '../equipment';
import { cuesOf } from '../puzzle/staged';
import { nodesOf, treeDrives } from '../puzzle/tree';
import { applyStoryEffects, craftIn, firstInteraction, gearIn, learnSkillIn, sceneSpeech, screenWrongIn, settleWorld, startWorld, useInteractionIn, useStoryObject, type Entry, type PlayWorld, type Voice } from '../play';
import { learnCheck, skillsOf } from '../skills';
import { describeEffect, describeRule, evaluate, isEmpty } from '../rules';
import { cinematicTiming } from '../shots';
import type { Project } from '../types';
import { assetOf, bool, contains, frameOf, meshesFor, num, paramOf, spaceAt, type Point } from './geometry';
import { doorRules, doorSide } from './doors';
import { navGraph } from './nav';
import { footprintOf, insidePolygon, OUTSIDE, structureGraph } from './structure';
import { guid, levelsOf } from './level';
import type { AssetDefinition, LevelAction, LevelEvent, LevelItem, LevelSet, PlayNote, PlayPreset, StructureObjective } from './types';

/**
 * Play Mode's rules (spec §8, §9): what the level does as the player moves
 * through it. The story's state is the same world the story play-through
 * keeps, changed by the same effects, with triggers and puzzles settling after
 * every change, so a level and its story always agree. Everything here is a
 * pure function of the project and the play state; the view only moves the
 * player and draws.
 */

export interface LevelLogEntry {
  /** Seconds since play began. */
  t: number;
  kind: 'event' | 'check' | 'effect' | 'action' | 'info' | 'warn' | 'note';
  text: string;
  itemId?: string;
  /** For a check: did its conditions hold? */
  pass?: boolean;
}

/** Someone a spawner put in the level. */
export interface Spawned {
  id: string;
  from: string;
  name: string;
  role: 'enemy' | 'npc' | 'item';
  ref?: string;
  x: number;
  y: number;
  floorId: string;
}

export interface Where extends Point {
  /** Height of the feet above the level's origin. */
  z: number;
}

export interface LevelPlayState {
  levelId: string;
  world: PlayWorld;
  /** Doors opened or closed during play (otherwise as they start). */
  open: Record<string, boolean>;
  /** Locked doors opened with their key: they stay unlocked. */
  unlocked: Record<string, boolean>;
  /** Secret doors the player has found (structure spec §7). */
  found?: Record<string, boolean>;
  /** Doors broken open: they stay open. */
  broken?: Record<string, boolean>;
  /** Timed doors standing open, and when each shuts again. */
  closesAt?: Record<string, number>;
  /** Chests and safes opened (structure spec §9): emptied, they stay. */
  opened?: Record<string, boolean>;
  /** Items switched off (false) or back on (true) by rules. */
  enabled: Record<string, boolean>;
  /** Items taken or despawned. */
  gone: Record<string, boolean>;
  spawned: Spawned[];
  /** The player's light (spec §6): whether it is on, and the seconds of fuel left (Infinity when it never runs out). */
  light: { on: boolean; fuel: number };
  /** Actors that move (patrols, companions), where they are now, by item id. */
  actors: Record<string, ActorPose>;
  /** The Character Creator's people (group members, AI enemies), where they are now, by member key (character spec §7). */
  cast?: Record<string, CastPose>;
  /** Spawners and once-only volumes that have gone off. */
  done: Record<string, boolean>;
  /** Volumes the player is inside. */
  inside: string[];
  /** The player's stamina (spec §6), 0–100, when the level tracks it. */
  stamina?: number;
  /** Doors the player is standing at, already tried this approach (they open as the player walks up). */
  atDoors?: Record<string, boolean>;
  /** Actors that can see the player now (line of sight). */
  seen?: Record<string, boolean>;
  /** Rule id → when it last ran (timers). */
  timers: Record<string, number>;
  objective?: string;
  checkpoint?: Where;
  health: number;
  time: number;
  cinematic?: { id: string; name: string; seconds: number; until: number; returnTo?: Where };
  /** Where a cinematic that has ended puts the player back (its "Back to gameplay"); the view moves the player there. */
  placePlayer?: Where;
  /** A scene playing over the level (talking to someone): its card, and what is said in it, beat by beat. */
  scene?: { id: string; title: string; text: string; speech?: Voice[][]; beat?: number };
  /** A screen puzzle up (puzzle spec §8): the object, the interaction it opens on, the item used. */
  screen?: { objectId: string; interactionId: string; itemId: string };
  message?: { text: string; until: number };
  /** A portal or rule sent the player to another level. */
  goTo?: string;
  /** Where the player arrives there, when it isn't the map's start (going into a structure, or back out beside it). */
  arrival?: Where & { yaw: number; floorId: string };
  /** In a structure (structure spec §10): its objectives done, and whether it is complete. */
  structure?: { objectives: Record<string, boolean>; complete: boolean };
  over?: { text: string };
  log: LevelLogEntry[];
}

/** What a structure remembers of the player's last visit (structure spec §10). */
export interface PlaceMemory {
  open: Record<string, boolean>;
  unlocked: Record<string, boolean>;
  found: Record<string, boolean>;
  broken: Record<string, boolean>;
  gone: Record<string, boolean>;
  done: Record<string, boolean>;
  /** Chests and safes opened. */
  opened?: Record<string, boolean>;
  /** What levers, plates and rules switched on and off (kept with the doors). */
  enabled?: Record<string, boolean>;
  spawned: Spawned[];
  actors: Record<string, ActorPose>;
  cast?: Record<string, CastPose>;
  objectives: Record<string, boolean>;
  complete: boolean;
  /** Times the player has left it. */
  visits: number;
}

const LOG_LIMIT = 400;
const MAX_DEPTH = 4;

// ---------------------------------------------------------------- starting

/** A preset's state over the story's opening state. */
export const worldFrom = (project: Project, preset?: PlayPreset): PlayWorld => {
  const base = startWorld(project);
  if (!preset) return settleWorld(project, base).world;
  const world: PlayWorld = {
    ...base,
    flags: { ...base.flags, ...preset.flags },
    items: { ...base.items, ...preset.items },
    objects: { ...base.objects, ...preset.objects },
    solved: { ...base.solved, ...preset.solved },
    visited: { ...base.visited, ...preset.visited },
    chosen: { ...base.chosen, ...preset.chosen },
    arcs: { ...base.arcs, ...preset.arcs },
  };
  return settleWorld(project, world).world;
};

export const startLevelPlay = (project: Project, levelId: string, options: { preset?: PlayPreset; world?: PlayWorld; global?: readonly AssetDefinition[] } = {}): LevelPlayState => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId);
  let state: LevelPlayState = {
    levelId,
    world: options.world ?? worldFrom(project, options.preset),
    open: {},
    unlocked: {},
    enabled: {},
    gone: {},
    spawned: [],
    actors: startPoses(set, levelId, options.global),
    cast: startCast(levelCast(project, levelId, options.global)),
    light: { on: false, fuel: fullFuel(project, levelId, options.global) },
    done: {},
    inside: [],
    timers: {},
    health: 100,
    time: 0,
    log: [{ t: 0, kind: 'info', text: `${level?.name ?? 'Level'} starts${options.preset ? ` from “${options.preset.name}”` : options.world ? ' carrying the story on' : ''}.` }],
  };
  if (level?.structure || state.world.places?.[levelId]) state = enterStructure(project, state, options.global);
  // Placed AI enemies stand where they are put until their machine moves them.
  for (const c of levelCast(project, levelId, options.global)) {
    if (c.placed && !state.actors[c.itemId]) state = { ...state, actors: { ...state.actors, [c.itemId]: { x: c.home.x, y: c.home.y, z: c.z, yaw: c.yaw, stop: 0, until: 0, moving: false } } };
  }
  // Spawners with no delay go off at once.
  for (const item of set.items) {
    if (item.levelId !== levelId || assetOf(set, item, options.global).role !== 'spawn' || !present(project, state, item)) continue;
    if (num(paramOf(set, item, 'delay', options.global), 0) <= 0 && assetOf(set, item, options.global).kind === 'marker') state = spawnFrom(project, state, item, options.global);
  }
  return state;
};

// ---------------------------------------------------------------- the dark, and the player's light (spec §6)

const playerStartOf = (project: Project, levelId: string, global?: readonly AssetDefinition[]): LevelItem | undefined => {
  const set = levelsOf(project);
  return set.items.find((i) => i.levelId === levelId && !i.hidden && assetOf(set, i, global).role === 'playerStart');
};

/** The player's light, as the level's player start sets it: what lights it (a story item or mechanic), its fuel in seconds (0 for ever), how far it reaches. */
export const lightOf = (project: Project, levelId: string, global?: readonly AssetDefinition[]): { source: string | null; fuel: number; range: number; startId: string | null } => {
  const set = levelsOf(project);
  const start = playerStartOf(project, levelId, global);
  const source = start ? String(paramOf(set, start, 'light', global) ?? '') : '';
  return {
    source: source && project.objects[source] ? source : null,
    fuel: start ? Math.max(0, num(paramOf(set, start, 'lightFuel', global), 0)) : 0,
    range: start ? num(paramOf(set, start, 'lightRange', global), 8) : 8,
    startId: start?.id ?? null,
  };
};

const fullFuel = (project: Project, levelId: string, global?: readonly AssetDefinition[]) => {
  const f = lightOf(project, levelId, global).fuel;
  return f > 0 ? f : Infinity;
};

/** Whether the player has what lights their light: its story item carried, or its mechanic available. */
export const hasLightSource = (project: Project, state: LevelPlayState, global?: readonly AssetDefinition[]): boolean => {
  const source = lightOf(project, state.levelId, global).source;
  return !!source && ((state.world.items[source] ?? 0) > 0 || !!state.world.mechanics[source]);
};

/** Whether the player's light is on now. */
export const isLit = (project: Project, state: LevelPlayState, global?: readonly AssetDefinition[]): boolean => !!state.light?.on && hasLightSource(project, state, global);

/** Turn the player's light on or off (L): only with its source, and with fuel left. */
export const toggleLight = (project: Project, state: LevelPlayState, global?: readonly AssetDefinition[]): LevelPlayState => {
  const light = state.light ?? { on: false, fuel: Infinity };
  if (light.on) return log(say({ ...state, light: { ...light, on: false } }, 'Light off.'), { kind: 'action', text: 'Turns the light off' });
  const { source } = lightOf(project, state.levelId, global);
  if (!source) return say(state, 'You have no light here.');
  if (!hasLightSource(project, state, global)) return say(state, `You need ${name(project, source)} for light.`);
  if (light.fuel <= 0) return say(state, 'Your light has no fuel left.');
  return log(say({ ...state, light: { ...light, on: true } }, 'Light on.'), { kind: 'action', text: 'Turns the light on' });
};

const darknessZones = (project: Project, state: LevelPlayState, global?: readonly AssetDefinition[]): LevelItem[] => {
  const set = levelsOf(project);
  return set.items.filter((i) => i.levelId === state.levelId && present(project, state, i) && assetOf(set, i, global).role === 'darkness');
};

/** How dark it is where the player is (0 to 1): the darkest darkness zone they are in, less when their light is on. */
export const darknessAt = (project: Project, state: LevelPlayState, global?: readonly AssetDefinition[]): { dark: number; lit: boolean } => {
  const set = levelsOf(project);
  const zones = darknessZones(project, state, global).filter((z) => state.inside.includes(z.id));
  const dark = zones.reduce((d, z) => Math.max(d, Math.min(100, Math.max(0, num(paramOf(set, z, 'dark', global), 92))) / 100), 0);
  return { dark, lit: isLit(project, state, global) };
};

/** Whether an item is lost in the dark: inside a darkness zone that needs a light, with the player's light off. */
export const tooDark = (project: Project, state: LevelPlayState, item: LevelItem, global?: readonly AssetDefinition[]): boolean => {
  if (isLit(project, state, global)) return false;
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === state.levelId);
  const elevation = (floorId: string) => level?.floors.find((f) => f.id === floorId)?.elevation ?? 0;
  const f = frameOf(set, item, global);
  const at = { x: f.x, y: f.y, z: elevation(item.floorId) + item.z };
  return darknessZones(project, state, global).some(
    (z) => z.id !== item.id && bool(paramOf(set, z, 'needsLight', global), true) && volumeHolds(set, z, at, elevation(z.floorId), global),
  );
};

// ---------------------------------------------------------------- what is there

/** In the level right now: not taken, not switched off, and its "present only when" holds. */
/** The ways the actors and characters are walking now, each from where it stands (the debug overlay draws them). */
export const waysOf = (state: LevelPlayState): { x: number; y: number; z: number }[][] => {
  const out: { x: number; y: number; z: number }[][] = [];
  for (const p of Object.values(state.actors ?? {})) if (p.route?.length) out.push([{ x: p.x, y: p.y, z: p.z }, ...p.route]);
  for (const p of Object.values(state.cast ?? {})) if (p.way && !p.way.none && p.way.route.length) out.push([{ x: p.x, y: p.y, z: p.z }, ...p.way.route]);
  return out;
};

export const present = (project: Project, state: LevelPlayState, item: LevelItem): boolean =>
  item.levelId === state.levelId && !item.hidden && !state.gone[item.id] && switchedOn(state, item) && evaluate(item.activeWhen, state.world);

/** Switched on: as rules, levers and plates left it, else as it starts (on, unless it starts switched off). */
const switchedOn = (state: LevelPlayState, item: LevelItem): boolean => (item.id in state.enabled ? state.enabled[item.id] !== false : item.params?.startsOff !== true);

export const isOpen = (project: Project, state: LevelPlayState, item: LevelItem, global?: readonly AssetDefinition[]): boolean => {
  if (state.broken?.[item.id]) return true;
  if (item.id in state.open) return state.open[item.id]!;
  const set = levelsOf(project);
  return bool(paramOf(set, item, 'startsOpen', global), false) || String(paramOf(set, item, 'swing', global)) === 'open archway';
};

const name = (project: Project, id: string) => project.objects[id]?.name ?? levelsOf(project).items.find((i) => i.id === id)?.name ?? '?';

const log = (state: LevelPlayState, entry: Omit<LevelLogEntry, 't'>): LevelPlayState => ({ ...state, log: [...state.log, { t: Math.round(state.time * 10) / 10, ...entry }].slice(-LOG_LIMIT) });

const say = (state: LevelPlayState, text: string, seconds = 3): LevelPlayState => ({ ...state, message: { text, until: state.time + seconds } });

const fromStory = (state: LevelPlayState, entries: Entry[], itemId?: string): LevelPlayState =>
  entries.reduce((s, e) => {
    // A staged hint is shown, as well as logged (puzzle spec §10).
    if (e.kind === 'hint') return say(log(s, { kind: 'info', text: `Hint (${e.detail}): ${e.text}`, itemId }), `Hint: ${e.text}`, 5);
    return 'text' in e ? log(s, { kind: e.kind === 'fired' ? 'event' : 'effect', text: e.text, itemId }) : s;
  }, state);

/** What a puzzle solved just now plays (puzzle spec §11): its cinematic, its message. */
const playSolveCues = (project: Project, before: PlayWorld, state: LevelPlayState): LevelPlayState => {
  let s = state;
  for (const id of Object.keys(s.world.solved)) {
    if (!s.world.solved[id] || before.solved[id]) continue;
    for (const c of cuesOf(project.objects[id])) {
      if (c.kind === 'cinematic' && c.ref && project.objects[c.ref]?.type === 'cinematic' && !s.cinematic) s = playCinematic(project, s, c.ref);
      else if (c.kind === 'message' && c.text) s = say(s, c.text, 4);
    }
  }
  return s;
};

const changeWorld = (project: Project, state: LevelPlayState, world: PlayWorld, entries: Entry[], itemId: string | undefined, depth: number): LevelPlayState => {
  const before = JSON.stringify(state.world);
  let next = playSolveCues(project, state.world, fromStory({ ...state, world }, entries, itemId));
  // Rules waiting on the story changing get their turn.
  if (depth < MAX_DEPTH && JSON.stringify(world) !== before) {
    const set = levelsOf(project);
    for (const item of set.items) {
      if (item.levelId !== state.levelId || !present(project, next, item)) continue;
      if ((item.rules ?? []).some((r) => r.on === 'stateChange')) next = runRules(project, next, item.id, 'stateChange', undefined, depth + 1);
    }
  }
  return next;
};

// ---------------------------------------------------------------- rules and actions

/** Run an item's rules for an event: each checks its conditions (logged either way), then changes the story and the level. */
export const runRules = (project: Project, state: LevelPlayState, itemId: string, on: LevelEvent, detail?: string, depth = 0, global?: readonly AssetDefinition[]): LevelPlayState => {
  const item = levelsOf(project).items.find((i) => i.id === itemId);
  if (!item) return state;
  let s = state;
  (item.rules ?? []).forEach((rule, n) => {
    if (rule.on !== on || (on === 'custom' && rule.detail && detail !== undefined && rule.detail !== detail)) return;
    const pass = evaluate(rule.when, s.world);
    if (!isEmpty(rule.when) || !pass) {
      s = log(s, { kind: 'check', itemId, pass, text: `${item.name} · rule ${n + 1}: ${describeRule(project, rule.when)} — ${pass ? 'holds' : 'does not hold'}` });
    }
    if (!pass) return;
    if (rule.effects?.length) {
      const changed = applyStoryEffects(project, s.world, rule.effects);
      s = changeWorld(project, s, changed.world, changed.log.length ? changed.log : rule.effects.map((e) => ({ kind: 'effect', text: describeEffect(project, e) }) as Entry), itemId, depth);
    }
    for (const action of rule.actions ?? []) s = act(project, s, action, itemId, depth, global);
  });
  return s;
};

const act = (project: Project, state: LevelPlayState, action: LevelAction, from: string, depth: number, global?: readonly AssetDefinition[]): LevelPlayState => {
  const set = levelsOf(project);
  const target = set.items.find((i) => i.id === action.target);
  const label = name(project, action.target);
  let s = log(state, { kind: 'action', itemId: from, text: `${ACTION_WORDS[action.kind]} ${label}` });
  switch (action.kind) {
    case 'open':
    case 'close':
      return { ...s, open: { ...s.open, [action.target]: action.kind === 'open' } };
    case 'enable':
    case 'disable':
      return { ...s, enabled: { ...s.enabled, [action.target]: action.kind === 'enable' } };
    case 'spawn':
      return target ? spawnFrom(project, s, target, global) : s;
    case 'despawn':
      return { ...s, gone: { ...s.gone, [action.target]: true }, spawned: s.spawned.filter((x) => x.from !== action.target && x.id !== action.target) };
    case 'startScene':
      return startScene(project, s, action.target, depth);
    case 'playCinematic':
      return playCinematic(project, s, action.target);
    case 'playAudio': {
      const sound = target ? String(paramOf(set, target, 'sound', global) ?? '') : '';
      return log(s, { kind: 'info', itemId: action.target, text: `♪ ${sound || label}` });
    }
    case 'objective': {
      const text = target ? String(paramOf(set, target, 'objective', global) || target.name) : label;
      s = { ...s, objective: text };
      return say(s, `New objective: ${text}`);
    }
    case 'goToLevel':
      return set.levels.some((l) => l.id === action.target) ? { ...s, goTo: action.target } : s;
    case 'refuel':
      return say({ ...s, light: { ...s.light, fuel: fullFuel(project, s.levelId, global) } }, 'Your light is full again.');
  }
};

const ACTION_WORDS: Record<LevelAction['kind'], string> = {
  open: 'Opens',
  close: 'Closes',
  enable: 'Enables',
  disable: 'Disables',
  spawn: 'Spawns at',
  despawn: 'Despawns',
  startScene: 'Starts scene',
  playCinematic: 'Plays',
  playAudio: 'Plays audio at',
  objective: 'Objective:',
  goToLevel: 'Goes to',
  refuel: 'Refills the light of',
};

const startScene = (project: Project, state: LevelPlayState, sceneId: string, depth: number): LevelPlayState => {
  const scene = project.objects[sceneId];
  if (!scene) return state;
  const world = { ...state.world, visited: { ...state.world.visited, [sceneId]: true } };
  const settled = settleWorld(project, world);
  const s = changeWorld(project, state, settled.world, settled.log, undefined, depth);
  const speech = sceneSpeech(project, s.world, sceneId);
  return { ...s, scene: { id: sceneId, title: `${scene.data.code ? `${String(scene.data.code)} ` : ''}${scene.name}`, text: String(scene.data.summary ?? ''), ...(speech.length ? { speech, beat: 0 } : {}) } };
};

/** How near a door's middle the player must come for it to open by itself. */
export const DOOR_REACH = 1.1;

const approachDoors = (project: Project, state: LevelPlayState, at: Where, global?: readonly AssetDefinition[]): LevelPlayState => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === state.levelId);
  const near: Record<string, boolean> = {};
  let s = state;
  for (const item of set.items) {
    if (item.levelId !== state.levelId || assetOf(set, item, global).role !== 'door' || !present(project, s, item)) continue;
    const f = frameOf(set, item, global);
    const bottom = (level?.floors.find((fl) => fl.id === item.floorId)?.elevation ?? 0) + f.z;
    if (Math.abs(at.z - bottom) > 1 || Math.hypot(at.x - f.x, at.y - f.y) > Math.max(DOOR_REACH, f.w / 2 + 0.4)) continue;
    near[item.id] = true;
    if (s.atDoors?.[item.id] || isOpen(project, s, item, global) || !bool(paramOf(set, item, 'autoOpen', global), true)) continue;
    // A secret door waits to be searched.
    if (doorRules(set, item, global).secret && !s.found?.[item.id]) continue;
    s = interactWith(project, s, item.id, global, at);
  }
  const before = Object.keys(s.atDoors ?? {});
  return before.length === Object.keys(near).length && before.every((id) => near[id]) ? s : { ...s, atDoors: near };
};

/** What blocks sight in a level: its solid parts, worked out once per level as edited. */
const blockersCache = new WeakMap<LevelSet, Map<string, Blocker[]>>();
export const blockersOf = (set: LevelSet, levelId: string, global?: readonly AssetDefinition[]): Blocker[] => {
  const byLevel = blockersCache.get(set) ?? blockersCache.set(set, new Map()).get(set)!;
  const known = byLevel.get(levelId);
  if (known) return known;
  const list = collidersFrom(meshesFor(set, levelId, { global })).filter((c) => c.part !== 'floor' && c.part !== 'ceiling');
  byLevel.set(levelId, list);
  return list;
};

/** The level's characters (group areas' people, placed AI enemies), worked out once per project as edited. */
const castCache = new WeakMap<Project, Map<string, CastMember[]>>();
export const levelCast = (project: Project, levelId: string, global?: readonly AssetDefinition[]): CastMember[] => {
  const byLevel = castCache.get(project) ?? castCache.set(project, new Map()).get(project)!;
  const known = byLevel.get(levelId);
  if (known) return known;
  const set = levelsOf(project);
  const list = castOf(project, set, levelId, global, blockersOf(set, levelId, global));
  byLevel.set(levelId, list);
  return list;
};

const watch = (project: Project, state: LevelPlayState, at: Where, global?: readonly AssetDefinition[]): LevelPlayState => {
  const set = levelsOf(project);
  const watchers = set.items.filter((i) => i.levelId === state.levelId && state.actors?.[i.id] && sightOf(set, i, global).range > 0 && present(project, state, i));
  if (!watchers.length && !Object.keys(state.seen ?? {}).length) return state;
  // An open door doesn't block the view.
  const blockers = blockersOf(set, state.levelId, global).filter((b) => !(b.part === 'door' && state.open[b.itemId]));
  let s = state;
  const seen: Record<string, boolean> = {};
  for (const item of watchers) if (canSee(s.actors[item.id]!, at, sightOf(set, item, global), blockers)) seen[item.id] = true;
  const before = s.seen ?? {};
  for (const id of Object.keys(seen).filter((id) => !before[id])) s = runRules(project, log(s, { kind: 'event', itemId: id, text: `${name(project, id)} sees the player` }), id, 'spotted', undefined, 0, global);
  for (const id of Object.keys(before).filter((id) => !seen[id])) s = runRules(project, log(s, { kind: 'event', itemId: id, text: `${name(project, id)} loses sight of the player` }), id, 'lost', undefined, 0, global);
  return { ...s, seen };
};

export const playCinematic = (project: Project, state: LevelPlayState, cinematicId: string, global?: readonly AssetDefinition[]): LevelPlayState => {
  const c = project.objects[cinematicId];
  if (!c) return state;
  const seconds = Math.max(2, cinematicTiming(project, cinematicId).seconds || 4);
  const returnTo = returnPointOf(project, state, String(c.data.returnTo ?? ''), global);
  return { ...state, cinematic: { id: cinematicId, name: c.name, seconds, until: state.time + seconds, ...(returnTo ? { returnTo } : {}) } };
};

/** Where a cinematic hands control back (its "Back to gameplay" field): the player start, the last checkpoint (else the start), or where the player was (nothing to do). */
const returnPointOf = (project: Project, state: LevelPlayState, returnTo: string, global?: readonly AssetDefinition[]): Where | undefined => {
  if (returnTo !== 'The player start' && returnTo !== 'The last checkpoint') return undefined;
  if (returnTo === 'The last checkpoint' && state.checkpoint) return state.checkpoint;
  const { x, y, z } = startPoint(project, state.levelId, global);
  return { x, y, z };
};

const runPuzzleClock = (project: Project, state: LevelPlayState): LevelPlayState => {
  const timed = Object.values(project.objects).filter((o) => o.type === 'puzzle' && !state.world.solved[o.id] && treeDrives(o) && nodesOf(o).some((n) => (n.within ?? 0) > 0));
  if (!timed.length) return state;
  const world = { ...state.world, clock: state.time };
  const ranOut = timed.some((o) => nodesOf(o).some((n) => {
    const at = world.steps?.[o.id];
    const start = at?.begun[n.id];
    return start !== undefined && !at!.done[n.id] && (n.within ?? 0) > 0 && state.time - start > n.within!;
  }));
  if (!ranOut) return { ...state, world };
  const settled = settleWorld(project, world);
  return changeWorld(project, state, settled.world, settled.log, undefined, 0);
};

/**
 * The screen puzzle up has an answer (puzzle spec §8): right, and its
 * interaction does what it does and the screen goes; wrong, and it counts
 * as a wrong move and stays; left, and it goes with nothing done.
 */
export const answerScreen = (project: Project, state: LevelPlayState, outcome: 'right' | 'wrong' | 'leave'): LevelPlayState => {
  const up = state.screen;
  if (!up) return state;
  if (outcome === 'leave') return { ...state, screen: undefined };
  if (outcome === 'wrong') {
    const r = screenWrongIn(project, state.world, up.objectId);
    return log(changeWorld(project, state, r.world, r.log, up.itemId, 0), { kind: 'check', itemId: up.itemId, pass: false, text: `${name(project, up.objectId)}: a wrong answer` });
  }
  const r = useInteractionIn(project, state.world, up.objectId, up.interactionId);
  const right = (project.objects[up.objectId]?.data.screen as { feedback?: { correct?: string } } | undefined)?.feedback?.correct;
  const s = say(log({ ...state, screen: undefined }, { kind: 'check', itemId: up.itemId, pass: true, text: `${name(project, up.objectId)}: solved` }), right || 'Solved.');
  return changeWorld(project, s, r.world, r.log, up.itemId, 0);
};

/** Skip or finish what is playing over the level: a cinematic, or a scene's card (its next line first, while it has lines left). */
export const dismiss = (state: LevelPlayState): LevelPlayState => {
  if (state.cinematic)
    return log({ ...state, cinematic: undefined, ...(state.cinematic.returnTo ? { placePlayer: state.cinematic.returnTo } : {}) }, { kind: 'info', text: `${state.cinematic.name} ends${state.cinematic.returnTo ? ', and the player is put back' : ''}` });
  const sc = state.scene;
  if (sc?.speech && (sc.beat ?? 0) < sc.speech.length - 1) return { ...state, scene: { ...sc, beat: (sc.beat ?? 0) + 1 } };
  return sc ? { ...state, scene: undefined } : state;
};

/** Leave a scene's card at once, whatever is left to say. */
export const skipScene = (state: LevelPlayState): LevelPlayState => (state.scene ? { ...state, scene: undefined } : state);

const spawnFrom = (project: Project, state: LevelPlayState, spawner: LevelItem, global?: readonly AssetDefinition[]): LevelPlayState => {
  const set = levelsOf(project);
  const def = assetOf(set, spawner, global);
  const actor = String(paramOf(set, spawner, 'actor', global) ?? '');
  const count = Math.max(1, Math.round(num(paramOf(set, spawner, 'count', global), 1)));
  const radius = num(paramOf(set, spawner, 'radius', global), 1);
  const f = frameOf(set, spawner, global);
  const who = project.objects[actor];
  const role: Spawned['role'] = who?.type === 'character' ? (def.id === 'spawn.enemy' || def.id === 'spawn.wave' ? 'enemy' : 'npc') : 'item';
  const made: Spawned[] = Array.from({ length: count }, (_, n) => {
    const a = (n / count) * Math.PI * 2;
    const r = count > 1 ? radius * 0.7 : 0;
    return { id: `${spawner.id}#${state.time.toFixed(1)}#${n}`, from: spawner.id, name: who?.name ?? spawner.name, role, ref: actor || undefined, x: f.x + Math.cos(a) * r, y: f.y + Math.sin(a) * r, floorId: spawner.floorId };
  });
  const s = log({ ...state, spawned: [...state.spawned, ...made], done: { ...state.done, [spawner.id]: true } }, { kind: 'action', itemId: spawner.id, text: `${spawner.name} spawns ${count} × ${who?.name ?? 'nobody'}` });
  return s;
};

// ---------------------------------------------------------------- using things

export interface Offer {
  itemId: string;
  verb: string;
  label: string;
  /** Why it can't be done now, when it can't. */
  blocked?: string;
}

const INTERACTIVE_ROLES = new Set(['building', 'door', 'pickup', 'inventory', 'weapon', 'ammo', 'health', 'npc', 'companion', 'neutral', 'dialogue', 'interaction', 'puzzle', 'elevator', 'ladder']);

/** What pressing Interact would do to this item, if anything. */
export const offerFor = (project: Project, state: LevelPlayState, item: LevelItem, global?: readonly AssetDefinition[], at?: Point): Offer | null => {
  const set = levelsOf(project);
  const def = assetOf(set, item, global);
  if (!present(project, state, item)) return null;
  const interactive = paramOf(set, item, 'interactive', global);
  const hasRules = (item.rules ?? []).some((r) => r.on === 'interact' || r.on === 'use' || r.on === 'pickup');
  if (interactive === false && !hasRules) return null;
  if (!(interactive === true || hasRules || INTERACTIVE_ROLES.has(def.role))) return null;
  const prompt = String(paramOf(set, item, 'prompt', global) || 'Use');
  if (tooDark(project, state, item, global)) {
    const source = lightOf(project, state.levelId, global).source;
    return { itemId: item.id, verb: prompt, label: item.name, blocked: hasLightSource(project, state, global) ? 'Too dark to see. Turn your light on (L).' : `Too dark to see.${source ? ` It needs ${name(project, source)} for light.` : ''}` };
  }
  if (def.role === 'building') {
    // A structure's mass (structure spec §12): the player goes in.
    const inside = set.levels.find((l) => l.anchorId === item.id && l.structure);
    return inside ? { itemId: item.id, verb: 'Enter', label: inside.name } : null;
  }
  if (def.role === 'door') {
    const open = isOpen(project, state, item, global);
    if (String(paramOf(set, item, 'swing', global)) === 'open archway' || state.broken?.[item.id]) return null;
    const rules = doorRules(set, item, global);
    // A secret door is the wall until it is searched (structure spec §7).
    if (rules.secret && !state.found?.[item.id]) return { itemId: item.id, verb: 'Search', label: 'the wall' };
    if (open) return { itemId: item.id, verb: 'Close', label: item.name };
    const side = rules.oneWay && at ? doorSide(set, item, at, global) : null;
    if (side && side !== rules.oneWay) return { itemId: item.id, verb: prompt, label: item.name, blocked: 'It won’t open from this side.' };
    const locked = rules.locked && !state.unlocked[item.id];
    const hasKey = !!rules.key && (state.world.items[rules.key] ?? 0) > 0;
    if (locked && !hasKey) {
      // A breakable door gives way, to bare hands or to what breaks it.
      if (rules.breakable && (!rules.breakWith || (state.world.items[rules.breakWith] ?? 0) > 0)) return { itemId: item.id, verb: 'Break', label: item.name };
      const needs = [rules.key && name(project, rules.key), rules.breakable && rules.breakWith && `${name(project, rules.breakWith)} to break it`].filter(Boolean).join(', or ');
      return { itemId: item.id, verb: prompt, label: item.name, blocked: needs ? `Locked. Needs ${needs}.` : 'Locked.' };
    }
    return { itemId: item.id, verb: locked ? prompt : 'Open', label: item.name };
  }
  if (def.role === 'container') {
    // A chest or safe (structure spec §9): once opened, there is nothing more to do.
    if (state.opened?.[item.id]) return null;
    const key = String(paramOf(set, item, 'keyItem', global) ?? '').trim();
    if (bool(paramOf(set, item, 'locked', global), false) && !(key && (state.world.items[key] ?? 0) > 0)) return { itemId: item.id, verb: prompt, label: item.name, blocked: key ? `Locked. Needs ${name(project, key)}.` : 'Locked.' };
    return { itemId: item.id, verb: prompt, label: item.name };
  }
  if (breakableSolid(set, item, global)) {
    const breaker = String(paramOf(set, item, 'breakWith', global) ?? '').trim();
    if (breaker && !((state.world.items[breaker] ?? 0) > 0)) return { itemId: item.id, verb: prompt, label: item.name, blocked: `Needs ${name(project, breaker)} to break it.` };
    return { itemId: item.id, verb: prompt, label: item.name };
  }
  return { itemId: item.id, verb: prompt, label: item.name };
};

/** A solid the player can break (structure spec §9): a breakable wall, a barricade, rubble, an urn. */
const breakableSolid = (set: LevelSet, item: LevelItem, global?: readonly AssetDefinition[]): boolean => {
  const def = assetOf(set, item, global);
  return def.kind === 'solid' && def.role !== 'door' && !['pickup', 'inventory', 'weapon', 'ammo', 'health', 'container'].includes(def.role) && bool(paramOf(set, item, 'destructible', global), false);
};

/**
 * A lever, switch or pressure plate works what it is set to (structure spec
 * §9): a door opens or shuts; anything else is switched on (there) or off
 * (gone). Open is "out of the way": for anything but a door, switched off.
 * While held, a plate works it as the player steps on, and back as they step off.
 */
const workTarget = (project: Project, state: LevelPlayState, worker: LevelItem, phase: 'use' | 'enter' | 'exit', global?: readonly AssetDefinition[]): LevelPlayState => {
  const set = levelsOf(project);
  const targetId = String(paramOf(set, worker, 'works', global) ?? '').trim();
  if (!targetId) return state;
  const target = set.items.find((i) => i.id === targetId && i.levelId === state.levelId);
  if (!target) return log(state, { kind: 'warn', itemId: worker.id, text: `${worker.name} works something that isn’t on this map` });
  const action = String(paramOf(set, worker, 'action', global) ?? 'toggle');
  if (phase === 'exit' && action !== 'while held') return state;
  const isDoor = assetOf(set, target, global).role === 'door';
  // Where it is now: a door open, anything else switched on.
  const now = isDoor ? isOpen(project, state, target, global) : switchedOn(state, target);
  let want: boolean;
  if (action === 'while held') want = phase === 'use' ? !now : phase === 'enter';
  else if (action === 'open') want = isDoor;
  else if (action === 'close') want = !isDoor;
  else if (action === 'switch on') want = true;
  else if (action === 'switch off') want = false;
  else want = !now;
  if (want === now) return state;
  let s: LevelPlayState;
  if (isDoor) {
    const closesAt = { ...state.closesAt };
    delete closesAt[target.id];
    s = { ...state, open: { ...state.open, [target.id]: want }, closesAt };
  } else s = { ...state, enabled: { ...state.enabled, [target.id]: want } };
  return log(s, { kind: 'action', itemId: worker.id, text: `${worker.name} ${isDoor ? (want ? 'opens' : 'shuts') : want ? 'switches on' : 'switches off'} ${target.name}` });
};

/** The player uses an item: what each kind of thing does, then its rules. */
export const interactWith = (project: Project, state: LevelPlayState, itemId: string, global?: readonly AssetDefinition[], at?: Point): LevelPlayState => {
  const set = levelsOf(project);
  const item = set.items.find((i) => i.id === itemId);
  if (!item) return state;
  const offer = offerFor(project, state, item, global, at);
  if (!offer) return state;
  const def = assetOf(set, item, global);
  let s = log(state, { kind: 'event', itemId, text: `${offer.verb} · ${item.name}` });
  if (offer.blocked) return say(log(s, { kind: 'check', itemId, pass: false, text: `${item.name}: ${offer.blocked}` }), offer.blocked);

  if (def.role === 'building') {
    const inside = set.levels.find((l) => l.anchorId === item.id && l.structure)!;
    const arrival = arrivalInto(project, inside.id, at, global);
    return log({ ...s, goTo: inside.id, ...(arrival ? { arrival } : {}) }, { kind: 'action', itemId, text: `Goes into ${inside.name}` });
  }
  if (def.role === 'door') {
    const rules = doorRules(set, item, global);
    const open = isOpen(project, s, item, global);
    if (offer.verb === 'Search') {
      // Found: a door from now on, to open like any other.
      s = say(log({ ...s, found: { ...s.found, [item.id]: true } }, { kind: 'action', itemId, text: `Finds ${item.name}` }), `A hidden door: ${item.name}.`);
    } else if (offer.verb === 'Break') {
      s = say(log({ ...s, broken: { ...s.broken, [item.id]: true } }, { kind: 'action', itemId, text: `${item.name} is broken open${rules.breakWith ? ` with ${name(project, rules.breakWith)}` : ''}` }), `${item.name} gives way.`);
    } else {
      const locked = rules.locked && !s.unlocked[item.id];
      if (!open && locked && rules.key) {
        s = log({ ...s, unlocked: { ...s.unlocked, [item.id]: true } }, { kind: 'check', itemId, pass: true, text: `${item.name} unlocks with ${name(project, rules.key)}` });
      }
      s = { ...s, open: { ...s.open, [item.id]: !open } };
      // A timed door shuts again on its own.
      const closesAt = { ...s.closesAt };
      if (!open && rules.openFor > 0) closesAt[item.id] = s.time + rules.openFor;
      else delete closesAt[item.id];
      s = log({ ...s, closesAt }, { kind: 'action', itemId, text: `${item.name} ${open ? 'closes' : 'opens'}${!open && rules.openFor > 0 ? ` for ${rules.openFor}s` : ''}` });
    }
  } else if (def.role === 'container') {
    s = { ...s, opened: { ...s.opened, [item.id]: true } };
    const holds = String(paramOf(set, item, 'item', global) ?? '');
    const quantity = Math.max(1, Math.round(num(paramOf(set, item, 'quantity', global), 1)));
    if (holds && project.objects[holds]) {
      const changed = applyStoryEffects(project, s.world, Array.from({ length: quantity }, () => ({ kind: 'give', ref: holds }) as const));
      s = changeWorld(project, s, changed.world, [{ kind: 'effect', text: `Takes ${project.objects[holds]!.name}${quantity > 1 ? ` × ${quantity}` : ''} from ${item.name}` }, ...changed.log], itemId, 0);
      s = say(s, `Took ${project.objects[holds]!.name}`);
    } else s = say(log(s, { kind: 'action', itemId, text: `${item.name} is empty` }), 'It’s empty.');
  } else if (breakableSolid(set, item, global)) {
    s = say(log({ ...s, gone: { ...s.gone, [item.id]: true } }, { kind: 'action', itemId, text: `${item.name} is broken` }), `${item.name} gives way.`);
  } else if (['pickup', 'inventory', 'weapon', 'ammo', 'health'].includes(def.role) && paramOf(set, item, 'collectible', global) !== false) {
    s = { ...s, gone: { ...s.gone, [item.id]: true } };
    const gives = String(paramOf(set, item, 'item', global) ?? '');
    const quantity = Math.max(1, Math.round(num(paramOf(set, item, 'quantity', global), 1)));
    if (def.role === 'health') s = { ...s, health: Math.min(100, s.health + num(paramOf(set, item, 'value', global), 25)) };
    // A pickup whose own rules give the item doesn't give it twice.
    const rulesGive = (item.rules ?? []).some((r) => r.on === 'pickup' && (r.effects ?? []).some((e) => e.kind === 'give' && e.ref === gives));
    if (gives && project.objects[gives] && !rulesGive) {
      const changed = applyStoryEffects(project, s.world, Array.from({ length: quantity }, () => ({ kind: 'give', ref: gives }) as const));
      s = changeWorld(project, s, changed.world, [{ kind: 'effect', text: `Takes ${project.objects[gives]!.name}${quantity > 1 ? ` × ${quantity}` : ''}` }, ...changed.log], itemId, 0);
    }
    s = say(s, `Took ${gives && project.objects[gives] ? project.objects[gives]!.name : item.name}`);
    s = runRules(project, s, itemId, 'pickup', undefined, 0, global);
  } else if (['npc', 'companion', 'neutral', 'dialogue'].includes(def.role)) {
    const who = String(paramOf(set, item, 'character', global) || paramOf(set, item, 'speaker', global) || '');
    const scene = (item.links ?? []).find((l) => project.objects[l]?.type === 'scene');
    if (scene) s = startScene(project, s, scene, 0);
    else s = say(s, `${project.objects[who]?.name ?? item.name} has nothing to say yet.`);
  } else {
    // An interaction point tied to a story object uses it as free play would, unless its own rules say what happens.
    const story = (item.links ?? []).find((l) => project.objects[l]?.type === 'object');
    const own = (item.rules ?? []).some((r) => r.on === 'interact');
    const first = story && !own ? firstInteraction(project, s.world, story) : undefined;
    if (story && first?.screen) {
      // Its screen puzzle comes up; what the interaction does waits for it to be solved.
      s = log({ ...s, screen: { objectId: story, interactionId: first.id, itemId } }, { kind: 'action', itemId, text: `${first.verb}: ${name(project, story)}’s screen` });
    } else if (story && !own) {
      const used = useStoryObject(project, s.world, story);
      if (used.needs) s = say(log(s, { kind: 'check', itemId, pass: false, text: `${name(project, story)}: needs ${used.needs}` }), `Needs ${used.needs}`);
      else s = changeWorld(project, s, used.world, used.log, itemId, 0);
    }
  }
  // A lever, a switch, a mechanism: it works what it is set to.
  if (def.role === 'interaction') s = workTarget(project, s, item, 'use', global);
  s = runRules(project, s, itemId, 'interact', undefined, 0, global);
  return runRules(project, s, itemId, 'use', undefined, 0, global);
};

// ---------------------------------------------------------------- time passing

// ---------------------------------------------------------------- climbing, swimming, stamina (spec §6)

/** What the player is at: a ladder, and water (its surface's height). Play Mode passes this to the controller. */
export const traversalAt = (project: Project, state: LevelPlayState, at: Where, global?: readonly AssetDefinition[]): { ladder: boolean; water?: number } => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === state.levelId);
  const elevation = new Map(level?.floors.map((f) => [f.id, f.elevation]) ?? []);
  let ladder = false;
  let water: number | undefined;
  for (const item of set.items) {
    if (item.levelId !== state.levelId || !present(project, state, item)) continue;
    const role = assetOf(set, item, global).role;
    if (role !== 'ladder' && role !== 'water') continue;
    const f = frameOf(set, item, global);
    const bottom = (elevation.get(item.floorId) ?? 0) + f.z;
    if (role === 'ladder') {
      // Within reach of its face, between its foot and its top.
      if (contains({ ...f, w: f.w + 0.4, d: f.d + 0.9 }, at) && at.z >= bottom - 0.2 && at.z <= bottom + f.h) ladder = true;
    } else if (contains(f, at) && at.z >= bottom - 0.25 && at.z <= bottom + f.h) water = Math.max(water ?? -Infinity, bottom + f.h);
  }
  return water === undefined ? { ladder } : { ladder, water };
};

/** Whether this level tracks stamina (its player start says so). */
export const tracksStamina = (project: Project, levelId: string, global?: readonly AssetDefinition[]): boolean => {
  const start = playerStartOf(project, levelId, global);
  return !!start && bool(paramOf(levelsOf(project), start, 'stamina', global), false);
};

/** What tires the player: running, swimming, climbing (per second), and how fast resting brings it back. */
export const STAMINA = { run: 15, swim: 6, climb: 8, rest: 12, drown: 15 } as const;

/**
 * Spend or win back stamina for dt seconds of effort. Out of it, the player
 * can't run (Play Mode stops them), and swimming hurts: they start to drown.
 */
export const spendStamina = (project: Project, state: LevelPlayState, dt: number, effort: { run?: boolean; swim?: boolean; climb?: boolean }, global?: readonly AssetDefinition[]): LevelPlayState => {
  if (!tracksStamina(project, state.levelId, global)) return state;
  const before = state.stamina ?? 100;
  const cost = (effort.run ? STAMINA.run : 0) + (effort.swim ? STAMINA.swim : 0) + (effort.climb ? STAMINA.climb : 0);
  const stamina = Math.min(100, Math.max(0, cost > 0 ? before - cost * dt : before + STAMINA.rest * dt));
  let s: LevelPlayState = { ...state, stamina };
  if (before > 0 && stamina === 0) s = say(log(s, { kind: 'warn', text: 'Out of stamina' }), 'You’re exhausted.');
  if (effort.swim && stamina === 0) s = { ...s, health: s.health - STAMINA.drown * dt };
  return s;
};

const volumeHolds = (set: LevelSet, item: LevelItem, at: Where, floorElevation: number, global?: readonly AssetDefinition[]): boolean => {
  const f = frameOf(set, item, global);
  if (!contains(f, at)) return false;
  const bottom = floorElevation + f.z;
  return at.z >= bottom - 0.25 && at.z <= bottom + f.h;
};

/**
 * Time passes and the player is somewhere: volumes notice them coming and
 * going, hazards hurt, timers and delayed spawns go off, what is showing
 * runs out.
 */
export const tick = (project: Project, state: LevelPlayState, dt: number, at: Where, global?: readonly AssetDefinition[]): LevelPlayState => {
  if (state.over || state.goTo) return state;
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === state.levelId);
  const elevation = new Map(level?.floors.map((f) => [f.id, f.elevation]) ?? []);
  let s: LevelPlayState = { ...state, time: state.time + dt };
  if (s.message && s.message.until <= s.time) s = { ...s, message: undefined };
  if (s.cinematic && s.cinematic.until <= s.time) s = dismiss(s);
  // While a cinematic, a scene card or a screen puzzle is up, the level waits.
  if (s.cinematic || s.scene || s.screen) return s;

  // The light burns its fuel while it is on, and goes out when that runs out (or its source is gone).
  if (s.light?.on) {
    if (!hasLightSource(project, s, global)) s = say({ ...s, light: { ...s.light, on: false } }, 'Your light goes out.');
    else if (Number.isFinite(s.light.fuel)) {
      const fuel = Math.max(0, s.light.fuel - dt);
      s = fuel > 0 ? { ...s, light: { ...s.light, fuel } } : log(say({ ...s, light: { on: false, fuel: 0 } }, 'Your light goes out: no fuel left.'), { kind: 'warn', text: 'The light ran out of fuel' });
    }
  }

  // Timed puzzle steps run on the play clock: one that ran out is undone (puzzle spec §6).
  s = runPuzzleClock(project, s);

  // Patrols walk on, companions keep up: round walls, on the level's navigation graph.
  const cast = levelCast(project, s.levelId, global);
  const driven = new Set(cast.filter((c) => c.placed).map((c) => c.itemId));
  const nav = cast.length || Object.keys(s.actors ?? {}).length ? navGraph(set, s.levelId, global) : null;
  const actors = stepActors(set, s.actors ?? {}, dt, s.time, at, (i) => !driven.has(i.id) && present(project, s, i), global, s.seen, nav);
  if (actors !== s.actors) s = { ...s, actors };

  // The Character Creator's people: group members go about their business, AI enemies run their machines (character spec §6.2, §7).
  if (cast.length) {
    const blockers = blockersOf(set, s.levelId, global).filter((b) => !(b.part === 'door' && s.open[b.itemId]));
    const here = cast.filter((c) => !c.placed || present(project, s, set.items.find((i) => i.id === c.itemId)!));
    const step = stepCast(here, s.cast ?? startCast(cast), dt, s.time, { ...at, alive: s.health > 0, noisy: false }, sightBlocked(blockers, at.z), nav);
    s = { ...s, cast: step.poses };
    for (const text of step.events) s = log(s, { kind: 'event', text });
    if (step.damage > 0) s = { ...s, health: Math.max(0, s.health - step.damage) };
    // A placed actor's own pose follows its machine, so it is drawn (and talked to) where it is.
    let moved: Record<string, ActorPose> | null = null;
    for (const c of here) {
      if (!c.placed) continue;
      const p = step.poses[c.key];
      if (!p) continue;
      (moved ??= { ...s.actors })[c.itemId] = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, stop: 0, until: 0, moving: p.moving };
    }
    if (moved) s = { ...s, actors: moved };
  }

  // Timed doors shut when their time is up, unless the player is standing in the doorway.
  for (const [id, when] of Object.entries(s.closesAt ?? {})) {
    if (when > s.time) continue;
    const door = set.items.find((i) => i.id === id);
    if (door) {
      const f = frameOf(set, door, global);
      if (Math.hypot(at.x - f.x, at.y - f.y) < Math.max(DOOR_REACH, f.w / 2 + 0.4) && Math.abs(at.z - ((elevation.get(door.floorId) ?? 0) + f.z)) < 1.5) continue;
    }
    const closesAt = { ...s.closesAt };
    delete closesAt[id];
    s = log({ ...s, closesAt, open: { ...s.open, [id]: false } }, { kind: 'action', itemId: id, text: `${door?.name ?? 'A door'} shuts again` });
  }

  // Walking up to a closed door opens it, as Interact would, or says why it won't: once each approach.
  s = approachDoors(project, s, at, global);

  // Who sees the player: an actor's "sees the player" rules run as the player comes into view, "loses sight" as they go.
  s = watch(project, s, at, global);

  const items = set.items.filter((i) => i.levelId === s.levelId && present(project, s, i));
  const volumes = items.filter((i) => assetOf(set, i, global).kind === 'volume');
  const inside = volumes.filter((v) => volumeHolds(set, v, at, elevation.get(v.floorId) ?? 0, global)).map((v) => v.id);

  for (const id of inside.filter((id) => !s.inside.includes(id))) s = enter(project, s, id, global);
  for (const id of s.inside.filter((id) => !inside.includes(id))) {
    s = log(s, { kind: 'event', itemId: id, text: `Leaves ${name(project, id)}` });
    // Off a pressure plate that works something while held: back it goes.
    const plate = set.items.find((i) => i.id === id);
    if (plate && assetOf(set, plate, global).role === 'trigger') s = workTarget(project, s, plate, 'exit', global);
    s = runRules(project, s, id, 'exit', undefined, 0, global);
  }
  s = { ...s, inside };

  // Hazards and damage hurt while you stand in them.
  for (const id of inside) {
    const item = set.items.find((i) => i.id === id)!;
    const role = assetOf(set, item, global).role;
    if (role !== 'hazard' && role !== 'damage') continue;
    if (role === 'damage' && bool(paramOf(set, item, 'kills', global), false)) {
      s = { ...s, health: 0 };
      continue;
    }
    // A trap in a cycle hurts only while it fires (structure spec §9).
    const cycle = num(paramOf(set, item, 'cycle', global), 0);
    if (role === 'hazard' && cycle > 0 && s.time % cycle >= num(paramOf(set, item, 'activeFor', global), cycle)) continue;
    const perSecond = num(paramOf(set, item, 'damage', global), 10);
    if (perSecond > 0) s = { ...s, health: Math.max(0, s.health - perSecond * dt) };
  }
  if (s.health <= 0 && !s.over) s = log({ ...s, over: { text: 'You didn’t make it.' } }, { kind: 'warn', text: 'The player is dead' });

  // A structure's objectives, and its completion (structure spec §10).
  if (level?.structure) s = checkStructure(project, s, at, global);
  // Walked out of a structure: back to the map it stands on, beside it.
  if (level?.structure && !s.goTo) s = leaveIfOutside(project, s, at, global);

  // Timers and delayed spawns.
  for (const item of items) {
    for (const rule of item.rules ?? []) {
      if (rule.on !== 'timer') continue;
      const every = Math.max(0.5, Number(rule.detail) || 5);
      const last = s.timers[rule.id] ?? 0;
      if (s.time - last >= every) {
        s = { ...s, timers: { ...s.timers, [rule.id]: s.time } };
        s = log(s, { kind: 'event', itemId: item.id, text: `${item.name}: ${every}s timer` });
        s = runRules(project, s, item.id, 'timer', undefined, 0, global);
      }
    }
    const def = assetOf(set, item, global);
    if (def.role === 'spawn' && def.kind === 'marker' && !s.done[item.id] && num(paramOf(set, item, 'delay', global), 0) <= s.time) s = spawnFrom(project, s, item, global);
  }
  return s;
};

const enter = (project: Project, state: LevelPlayState, id: string, global?: readonly AssetDefinition[]): LevelPlayState => {
  const set = levelsOf(project);
  const item = set.items.find((i) => i.id === id)!;
  const def = assetOf(set, item, global);
  const once = bool(paramOf(set, item, 'once', global), false);
  let s = log(state, { kind: 'event', itemId: id, text: `Enters ${item.name}` });
  if (once && s.done[id]) return s;
  if (once) s = { ...s, done: { ...s.done, [id]: true } };
  const plays = (item.rules ?? []).some((r) => (r.actions ?? []).some((a) => a.kind === 'playCinematic'));
  const cinematic = String(paramOf(set, item, 'cinematic', global) ?? '');
  if (def.role === 'cinematic' && cinematic && !plays) s = playCinematic(project, log(s, { kind: 'action', itemId: id, text: `Plays ${name(project, cinematic)}` }), cinematic, global);
  if (def.role === 'checkpoint') {
    const f = frameOf(set, item, global);
    const floor = set.levels.find((l) => l.id === s.levelId)?.floors.find((fl) => fl.id === item.floorId);
    s = say(log({ ...s, checkpoint: { x: f.x, y: f.y, z: floor?.elevation ?? 0 } }, { kind: 'info', itemId: id, text: 'Checkpoint' }), 'Checkpoint');
  }
  if (def.role === 'portal') {
    const to = String(paramOf(set, item, 'to', global) ?? '').trim().toLowerCase();
    const target = set.levels.find((l) => l.id !== s.levelId && l.name.toLowerCase() === to);
    if (target) s = log({ ...s, goTo: target.id }, { kind: 'action', itemId: id, text: `Goes to ${target.name}` });
    else if (to) s = log(s, { kind: 'warn', itemId: id, text: `${item.name} leads to “${to}”, which isn’t a level here` });
  }
  if (def.role === 'spawn' && def.kind === 'volume' && !s.done[id]) s = spawnFrom(project, s, item, global);
  // A pressure plate works what it is set to.
  if (def.role === 'trigger') s = workTarget(project, s, item, 'enter', global);
  return runRules(project, s, id, 'enter', undefined, 0, global);
};

/** Change the story by hand in the inspect panel (to set up a test), and let it settle. */
export const setWorldByHand = (project: Project, state: LevelPlayState, world: PlayWorld, what: string): LevelPlayState => {
  const settled = settleWorld(project, world);
  return changeWorld(project, log(state, { kind: 'info', text: `By hand: ${what}` }), settled.world, settled.log, undefined, 0);
};

// ---------------------------------------------------------------- gear, skills and crafting (spec §8)

export type GearAct = 'equip' | 'unequip' | 'use' | 'learn' | 'craft';

export const GEAR_VERBS: Record<GearAct, string> = { equip: 'Equip', unequip: 'Put away', use: 'Use', learn: 'Learn', craft: 'Craft' };

/** Something the player can do with their gear, skills or recipes, and why not ("" when they can). */
export interface GearOption {
  act: GearAct;
  id: string;
  label: string;
  why: string;
}

/**
 * The gear screen, in order, as the engines' level players list it: each item
 * of equipment carried (Use and Put away when it is equipped, else Equip), then
 * each skill (Learn), then each recipe (Craft), each with why not.
 */
export const gearMenu = (project: Project, world: PlayWorld): GearOption[] => {
  const out: GearOption[] = [];
  for (const o of equipmentList(project)) {
    if ((world.items[o.id] ?? 0) < 1) continue;
    if (isEquipped(world, o.id)) {
      out.push({ act: 'use', id: o.id, label: `Use ${o.name}`, why: useCheck(project, world, o.id) });
      out.push({ act: 'unequip', id: o.id, label: `Put away ${o.name}`, why: '' });
    } else out.push({ act: 'equip', id: o.id, label: `Equip ${o.name}`, why: equipCheck(project, world, o.id) });
  }
  for (const o of skillsOf(project)) out.push({ act: 'learn', id: o.id, label: `Learn ${o.name}`, why: learnCheck(project, world, o.id).needs ?? '' });
  for (const o of recipesOf(project)) out.push({ act: 'craft', id: o.id, label: `Craft ${o.name}`, why: craftCheck(project, world, o.id) });
  return out;
};

/** What the screen says once it is done ("Equipped Diving Knife", "Crafted 2 × Flare"). The engines say the same. */
const doneText = (project: Project, act: GearAct, id: string): string => {
  const n = name(project, id);
  if (act === 'craft') {
    const makes = recipeOf(project.objects[id])?.makes ?? 1;
    return `Crafted ${makes > 1 ? `${makes} × ` : ''}${n}`;
  }
  return `${{ equip: 'Equipped', unequip: 'Put away', use: 'Used', learn: 'Learned' }[act]} ${n}`;
};

/** A story entry as a line of the level's log, with its detail ("Used Diving Knife · 2 uses left"). */
const gearEntry = (e: Entry): Entry =>
  e.kind === 'skill' ? { kind: 'effect', text: `Learned ${e.text} (rank ${e.rank} of ${e.ranks})` } : (e.kind === 'gear' || e.kind === 'craft') && e.detail ? { ...e, text: `${e.text} · ${e.detail}` } : e;

/**
 * Equip, put away or use an item, learn a skill or craft (spec §8) in the
 * level: the same rules as the story play-through. What happened, or why not,
 * goes on screen and in the log, and the level's rules waiting on the story get their turn.
 */
export const gearDo = (project: Project, state: LevelPlayState, act: GearAct, id: string): LevelPlayState => {
  const r = act === 'learn' ? learnSkillIn(project, state.world, id) : act === 'craft' ? craftIn(project, state.world, id) : act === 'unequip' && !isEquipped(state.world, id) ? { world: state.world, log: [], needs: `${name(project, id)} is not equipped.` } : gearIn(project, state.world, id, act);
  if (r.needs) return say(log(state, { kind: 'warn', text: `${GEAR_VERBS[act]} ${name(project, id)}: ${r.needs}` }), r.needs);
  return say(changeWorld(project, state, r.world, r.log.map(gearEntry), undefined, 0), doneText(project, act, id));
};

/** What is in the player's hand ("" for nothing). */
export const inHand = (state: LevelPlayState): string => state.world.equipped?.Hand ?? '';

/** Use what is in the hand (R): as Use on the gear screen. */
export const useInHand = (project: Project, state: LevelPlayState): LevelPlayState => {
  const id = inHand(state);
  return id ? gearDo(project, state, 'use', id) : say(state, 'Nothing in hand.');
};

// ---------------------------------------------------------------- presets and notes

export const presetFrom = (world: PlayWorld, name: string): PlayPreset => ({
  id: guid(),
  name,
  flags: { ...world.flags },
  items: Object.fromEntries(Object.entries(world.items).filter(([, n]) => n > 0)),
  objects: { ...world.objects },
  solved: Object.fromEntries(Object.entries(world.solved).filter(([, v]) => v)),
  visited: Object.fromEntries(Object.entries(world.visited).filter(([, v]) => v)),
  chosen: { ...world.chosen },
  arcs: { ...world.arcs },
});

const withSet = (project: Project, change: (set: LevelSet) => LevelSet): Project => ({ ...project, levels: change(levelsOf(project)) });

export const savePreset = (project: Project, preset: PlayPreset): Project => withSet(project, (set) => ({ ...set, presets: [...(set.presets ?? []).filter((p) => p.id !== preset.id), preset] }));

export const removePreset = (project: Project, id: string): Project => withSet(project, (set) => ({ ...set, presets: (set.presets ?? []).filter((p) => p.id !== id) }));

export const addNote = (project: Project, note: Omit<PlayNote, 'id' | 'at'>): { project: Project; id: string } => {
  const id = guid();
  return { project: withSet(project, (set) => ({ ...set, notes: [...(set.notes ?? []), { ...note, id, at: new Date().toISOString() }] })), id };
};

export const resolveNote = (project: Project, id: string, resolved = true): Project =>
  withSet(project, (set) => ({ ...set, notes: (set.notes ?? []).map((n) => (n.id === id ? { ...n, resolved } : n)) }));

export const removeNote = (project: Project, id: string): Project => withSet(project, (set) => ({ ...set, notes: (set.notes ?? []).filter((n) => n.id !== id) }));

/** Where play begins: the player start (or the first space), facing as it faces. */
export const startPoint = (project: Project, levelId: string, global?: readonly AssetDefinition[]): Where & { yaw: number; floorId: string } => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId);
  const items = set.items.filter((i) => i.levelId === levelId && !i.hidden);
  const start = items.find((i) => assetOf(set, i, global).role === 'playerStart') ?? items.find((i) => assetOf(set, i, global).kind === 'space');
  const floorId = start?.floorId ?? level?.floors[0]?.id ?? '';
  const floor = level?.floors.find((f) => f.id === floorId);
  if (!start) return { x: 0, y: 0, z: floor?.elevation ?? 0, yaw: 0, floorId };
  const f = frameOf(set, start, global);
  return { x: f.x, y: f.y, z: (floor?.elevation ?? 0) + (assetOf(set, start, global).kind === 'space' ? 0 : start.z), yaw: (f.rotation * Math.PI) / 180, floorId };
};

/** Where to stand to begin at an item: beside it (in front of it), on its floor. */
export const pointNear = (project: Project, itemId: string, global?: readonly AssetDefinition[]): (Where & { yaw: number; floorId: string }) | null => {
  const set = levelsOf(project);
  const item = set.items.find((i) => i.id === itemId);
  if (!item) return null;
  const def = assetOf(set, item, global);
  const f = frameOf(set, item, global);
  const floor = set.levels.find((l) => l.id === item.levelId)?.floors.find((fl) => fl.id === item.floorId);
  const base = floor?.elevation ?? 0;
  if (def.kind === 'space' || def.kind === 'volume' || def.kind === 'marker') return { x: f.x, y: f.y, z: base + (def.kind === 'marker' ? item.z : 0), yaw: (f.rotation * Math.PI) / 180, floorId: item.floorId };
  // Stand to its south (in its own frame), facing it.
  const back = Math.max(f.w, f.d) / 2 + 1.2;
  const yaw = (f.rotation * Math.PI) / 180;
  return { x: f.x - Math.sin(yaw) * back, y: f.y + Math.cos(yaw) * back, z: base, yaw, floorId: item.floorId };
};

/** The level's play-relevant items, for the debug overlay and the inspect panel. */
export const volumesAt = (project: Project, state: LevelPlayState): LevelItem[] => {
  const set = levelsOf(project);
  return state.inside.map((id) => set.items.find((i) => i.id === id)).filter((i): i is LevelItem => !!i);
};

// ---------------------------------------------------------------- structures as scenes (structure spec §10)

const PICKUP_ROLES = new Set(['pickup', 'inventory', 'weapon', 'ammo', 'health']);

/** The puzzles a map's items are bound to or linked with. */
const puzzlesIn = (project: Project, levelId: string): string[] => {
  const set = levelsOf(project);
  const ids = new Set<string>();
  for (const i of set.items) {
    if (i.levelId !== levelId) continue;
    for (const b of i.puzzles ?? []) if (b.puzzle) ids.add(b.puzzle);
    for (const l of i.links ?? []) if (project.objects[l]?.type === 'puzzle') ids.add(l);
  }
  return [...ids];
};

/**
 * Coming into a structure: what it remembers of the last visit comes back,
 * as its persistence rules say (doors, items, enemies, puzzles: kept or
 * reset), and its first objective is shown.
 */
const enterStructure = (project: Project, state: LevelPlayState, global?: readonly AssetDefinition[]): LevelPlayState => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === state.levelId)!;
  // Any map the player has left remembers it; a structure says what it keeps (structure spec §10).
  const info: Partial<NonNullable<typeof level.structure>> = level.structure ?? {};
  const memory = state.world.places?.[level.id];
  let s: LevelPlayState = level.structure ? { ...state, structure: { objectives: { ...memory?.objectives }, complete: !!memory?.complete } } : state;
  if (memory) {
    const keep = { doors: 'keep', items: 'keep', enemies: 'keep', puzzles: 'keep', ...info.persist };
    const role = (id: string) => {
      const item = set.items.find((i) => i.id === id);
      return item ? assetOf(set, item, global).role : '';
    };
    const kept: string[] = [];
    const reset: string[] = [];
    (keep.doors === 'keep' ? kept : reset).push('doors');
    (keep.items === 'keep' ? kept : reset).push('items');
    (keep.enemies === 'keep' ? kept : reset).push('enemies');
    (keep.puzzles === 'keep' ? kept : reset).push('puzzles');
    if (keep.doors === 'keep') s = { ...s, open: { ...memory.open }, unlocked: { ...memory.unlocked }, found: { ...memory.found }, broken: { ...memory.broken }, enabled: { ...s.enabled, ...memory.enabled } };
    const gone: Record<string, boolean> = {};
    for (const [id, v] of Object.entries(memory.gone)) {
      const isItem = PICKUP_ROLES.has(role(id));
      if ((isItem && keep.items === 'keep') || (!isItem && keep.enemies === 'keep')) gone[id] = v;
    }
    s = { ...s, gone, ...(keep.items === 'keep' ? { opened: { ...memory.opened } } : {}) };
    if (keep.enemies === 'keep') s = { ...s, spawned: [...memory.spawned], done: { ...memory.done }, actors: { ...s.actors, ...memory.actors }, ...(memory.cast ? { cast: { ...memory.cast } } : {}) };
    if (keep.puzzles === 'reset') {
      // Its puzzles unsolved and its own states as the story starts them.
      const start = startWorld(project);
      const solved = { ...s.world.solved };
      for (const id of puzzlesIn(project, level.id)) delete solved[id];
      const flags = { ...s.world.flags };
      for (const id of info.localStates ?? []) {
        if (id in start.flags) flags[id] = start.flags[id]!;
        else delete flags[id];
      }
      s = { ...s, world: { ...s.world, solved, flags } };
    }
    s = log(s, { kind: 'info', text: `Back in ${level.name}${kept.length ? `: ${kept.join(', ')} as you left them` : ''}${reset.length ? `${kept.length ? ';' : ':'} ${reset.join(', ')} reset` : ''}.` });
  } else if (info.localStates?.length) {
    // The first time in, its own states start as the story starts them.
    const start = startWorld(project);
    const flags = { ...s.world.flags };
    for (const id of info.localStates) {
      if (id in start.flags) flags[id] = start.flags[id]!;
      else delete flags[id];
    }
    s = { ...s, world: { ...s.world, flags } };
  }
  if (!level.structure) return s;
  const next = nextObjective(info.objectives, s.structure!.objectives);
  if (next && !s.objective) s = { ...s, objective: next.text };
  return s;
};

const nextObjective = (objectives: StructureObjective[] | undefined, done: Record<string, boolean>): StructureObjective | undefined =>
  (objectives ?? []).find((o) => !done[o.id] && !o.optional) ?? (objectives ?? []).find((o) => !done[o.id]);

/** Which room the player is in now. */
export const roomAt = (project: Project, levelId: string, at: Where, global?: readonly AssetDefinition[]): LevelItem | undefined => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId);
  const floor = [...(level?.floors ?? [])].sort((a, b) => b.elevation - a.elevation).find((f) => f.elevation <= at.z + 0.5) ?? level?.floors[0];
  return floor ? spaceAt(set, levelId, floor.id, at, global) : undefined;
};

/** An objective is done when its condition holds, or (with none) when the player reaches its room or comes up to its item. */
const objectiveDone = (project: Project, state: LevelPlayState, o: StructureObjective, at: Where, room: LevelItem | undefined, global?: readonly AssetDefinition[]): boolean => {
  if (o.when && !isEmpty(o.when)) return evaluate(o.when, state.world);
  if (!o.at) return false;
  if (room?.id === o.at) return true;
  const set = levelsOf(project);
  const target = set.items.find((i) => i.id === o.at && i.levelId === state.levelId);
  if (!target || assetOf(set, target, global).kind === 'space' || !present(project, state, target)) return false;
  const f = frameOf(set, target, global);
  const base = set.levels.find((l) => l.id === state.levelId)?.floors.find((fl) => fl.id === target.floorId)?.elevation ?? 0;
  return Math.hypot(at.x - f.x, at.y - f.y) <= Math.max(2, f.w / 2 + 1) && Math.abs(at.z - (base + f.z)) < 2;
};

const checkStructure = (project: Project, state: LevelPlayState, at: Where, global?: readonly AssetDefinition[]): LevelPlayState => {
  const level = levelsOf(project).levels.find((l) => l.id === state.levelId)!;
  const info = level.structure!;
  let s = state.structure ? state : { ...state, structure: { objectives: {}, complete: false } };
  const objectives = info.objectives ?? [];
  const room = objectives.some((o) => o.at && !s.structure!.objectives[o.id]) ? roomAt(project, s.levelId, at, global) : undefined;
  for (const o of objectives) {
    if (s.structure!.objectives[o.id] || !objectiveDone(project, s, o, at, room, global)) continue;
    s = { ...s, structure: { ...s.structure!, objectives: { ...s.structure!.objectives, [o.id]: true } } };
    const next = nextObjective(objectives, s.structure!.objectives);
    s = log(say({ ...s, objective: next?.text ?? s.objective }, next ? `Done: ${o.text}. Next: ${next.text}` : `Done: ${o.text}`, 4), { kind: 'event', text: `Objective done: ${o.text}` });
  }
  if (s.structure!.complete) return s;
  const complete = info.completeWhen && !isEmpty(info.completeWhen) ? evaluate(info.completeWhen, s.world) : objectives.some((o) => !o.optional) && objectives.every((o) => o.optional || s.structure!.objectives[o.id]);
  if (!complete) return s;
  s = say(log({ ...s, structure: { ...s.structure!, complete: true } }, { kind: 'event', text: `${level.name} is complete` }), `${level.name} complete.`, 4);
  if (info.onComplete?.length) {
    const changed = applyStoryEffects(project, s.world, info.onComplete);
    s = changeWorld(project, s, changed.world, changed.log.length ? changed.log : info.onComplete.map((e) => ({ kind: 'effect', text: describeEffect(project, e) }) as Entry), undefined, 0);
  }
  return s;
};

/**
 * Leaving a map for another: the story goes on, and the map keeps what it
 * remembers of this visit for the next one (structure spec §10): its doors,
 * what was taken, who is where. A structure's persistence rules say what of
 * that comes back.
 */
export const leaveLevel = (project: Project, state: LevelPlayState): PlayWorld => {
  const level = levelsOf(project).levels.find((l) => l.id === state.levelId);
  if (!level) return state.world;
  const before = state.world.places?.[level.id];
  const memory: PlaceMemory = {
    open: { ...state.open },
    unlocked: { ...state.unlocked },
    found: { ...state.found },
    broken: { ...state.broken },
    gone: { ...state.gone },
    done: { ...state.done },
    opened: { ...state.opened },
    enabled: { ...state.enabled },
    spawned: [...state.spawned],
    actors: { ...state.actors },
    ...(state.cast ? { cast: { ...state.cast } } : {}),
    objectives: { ...state.structure?.objectives },
    complete: !!state.structure?.complete,
    visits: (before?.visits ?? 0) + 1,
  };
  return { ...state.world, places: { ...state.world.places, [level.id]: memory } };
};

// ---------------------------------------------------------------- in and out of a structure (structure spec §12)

/** A structure's map and its mass: the item on the parent map it details, and how its own plan sits on the parent's. */
const anchorOf = (project: Project, structureId: string, global?: readonly AssetDefinition[]) => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === structureId);
  const mass = level?.anchorId ? set.items.find((i) => i.id === level.anchorId) : undefined;
  if (!level || !mass || !level.parentId || mass.levelId !== level.parentId) return null;
  const f = frameOf(set, mass, global);
  const r = (f.rotation * Math.PI) / 180;
  const ox = level.origin?.x ?? 0;
  const oy = level.origin?.y ?? 0;
  const parentFloor = set.levels.find((l) => l.id === mass.levelId)?.floors.find((fl) => fl.id === mass.floorId);
  return {
    level,
    mass,
    frame: f,
    /** A point on the structure's plan, on the parent map. */
    out: (p: Point): Point => ({ x: f.x + (p.x + ox) * Math.cos(r) - (p.y + oy) * Math.sin(r), y: f.y + (p.x + ox) * Math.sin(r) + (p.y + oy) * Math.cos(r) }),
    /** A point on the parent map, on the structure's plan. */
    into: (p: Point): Point => {
      const dx = p.x - f.x;
      const dy = p.y - f.y;
      return { x: dx * Math.cos(r) + dy * Math.sin(r) - ox, y: -dx * Math.sin(r) + dy * Math.cos(r) - oy };
    },
    ground: (parentFloor?.elevation ?? 0) + mass.z,
  };
};

const facing = (dx: number, dy: number) => Math.atan2(dx, -dy);

/** The structure's ways in from outside: its doors to the outside, on the floors nearest the ground. */
const entrancesOf = (project: Project, structureId: string, global?: readonly AssetDefinition[]) => {
  const set = levelsOf(project);
  const graph = structureGraph(set, structureId, global);
  const level = set.levels.find((l) => l.id === structureId)!;
  const elevation = new Map(level.floors.map((f) => [f.id, f.elevation]));
  return graph.edges
    .filter((e) => e.kind === 'door' && (e.from === OUTSIDE || e.to === OUTSIDE) && !(e.oneWay && e.to === OUTSIDE))
    .map((e) => ({ door: set.items.find((i) => i.id === e.via)!, room: e.from === OUTSIDE ? e.to : e.from }))
    .filter((x) => x.door)
    .sort((a, b) => Math.abs(elevation.get(a.door.floorId) ?? 0) - Math.abs(elevation.get(b.door.floorId) ?? 0));
};

/**
 * Where the player arrives going into a structure from its mass: just inside
 * the way in nearest to where they stood outside, facing in. With no door
 * out, the structure's own start.
 */
export const arrivalInto = (project: Project, structureId: string, from: Point | undefined, global?: readonly AssetDefinition[]): (Where & { yaw: number; floorId: string }) | null => {
  const set = levelsOf(project);
  const anchor = anchorOf(project, structureId, global);
  const ways = entrancesOf(project, structureId, global);
  if (!ways.length) return null;
  const here = from && anchor ? anchor.into(from) : undefined;
  const lowest = Math.abs(set.levels.find((l) => l.id === structureId)!.floors.find((f) => f.id === ways[0]!.door.floorId)?.elevation ?? 0);
  const best = ways
    .filter((w) => Math.abs(set.levels.find((l) => l.id === structureId)!.floors.find((f) => f.id === w.door.floorId)?.elevation ?? 0) === lowest)
    .map((w) => ({ w, f: frameOf(set, w.door, global) }))
    .sort((a, b) => (here ? Math.hypot(a.f.x - here.x, a.f.y - here.y) - Math.hypot(b.f.x - here.x, b.f.y - here.y) : 0))[0]!;
  const room = set.items.find((i) => i.id === best.w.room);
  const rf = room ? frameOf(set, room, global) : undefined;
  // Step in from the door, toward the middle of the room behind it.
  const dx = (rf?.x ?? 0) - best.f.x;
  const dy = (rf?.y ?? 0) - best.f.y;
  const n = Math.hypot(dx, dy) || 1;
  const step = Math.min(1.5, n * 0.6);
  const floor = set.levels.find((l) => l.id === structureId)!.floors.find((f) => f.id === best.w.door.floorId);
  return { x: best.f.x + (dx / n) * step, y: best.f.y + (dy / n) * step, z: floor?.elevation ?? 0, yaw: facing(dx, dy), floorId: best.w.door.floorId };
};

/** Whether a plan point is outside every floor's footprint of a structure, by more than a margin. */
const outsideFootprints = (project: Project, levelId: string, p: Point, margin: number, global?: readonly AssetDefinition[]): boolean | null => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId);
  if (!level) return null;
  const polys = level.floors.map((f) => footprintOf(set, level, f.id, global)).filter((x): x is Point[] => !!x);
  if (!polys.length) return null;
  return polys.every((poly) => !insidePolygon(p, poly, 0) && distanceToPolygon(p, poly) > margin);
};

const distanceToPolygon = (p: Point, poly: readonly Point[]) => {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1)));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))));
  }
  return best;
};

/**
 * Out through a structure's way in and past its footprint: the player goes
 * back to the map it stands on, outside the mass where they came out, facing
 * away from it.
 */
const leaveIfOutside = (project: Project, state: LevelPlayState, at: Where, global?: readonly AssetDefinition[]): LevelPlayState => {
  const anchor = anchorOf(project, state.levelId, global);
  if (!anchor || outsideFootprints(project, state.levelId, at, 0.8, global) !== true) return state;
  const p = anchor.out(at);
  const f = anchor.frame;
  // Beyond the mass's edge, on the side they came out.
  let dx = p.x - f.x;
  let dy = p.y - f.y;
  const n = Math.hypot(dx, dy) || 1;
  dx /= n;
  dy /= n;
  const reach = Math.hypot(f.w, f.d) / 2;
  const r = (f.rotation * Math.PI) / 180;
  const lx = dx * Math.cos(r) + dy * Math.sin(r);
  const ly = -dx * Math.sin(r) + dy * Math.cos(r);
  // How far from the middle to the mass's edge along this way.
  const edge = Math.min(lx ? f.w / 2 / Math.abs(lx) : Infinity, ly ? f.d / 2 / Math.abs(ly) : Infinity, reach);
  const out = Math.max(n, edge + 1.2);
  const arrival = { x: f.x + dx * out, y: f.y + dy * out, z: anchor.ground, yaw: facing(dx, dy), floorId: anchor.mass.floorId };
  return log({ ...state, goTo: anchor.level.parentId!, arrival }, { kind: 'action', text: `Comes out of ${anchor.level.name}` });
};
