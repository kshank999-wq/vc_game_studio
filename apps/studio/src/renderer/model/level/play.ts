import { startPoses, stepActors, type ActorPose } from './actors';
import { applyStoryEffects, settleWorld, startWorld, useStoryObject, type Entry, type PlayWorld } from '../play';
import { describeEffect, describeRule, evaluate, isEmpty } from '../rules';
import { cinematicTiming } from '../shots';
import type { Project } from '../types';
import { assetOf, bool, contains, frameOf, num, paramOf, type Point } from './geometry';
import { guid, levelsOf } from './level';
import type { AssetDefinition, LevelAction, LevelEvent, LevelItem, LevelSet, PlayNote, PlayPreset } from './types';

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
  /** Items switched off (false) or back on (true) by rules. */
  enabled: Record<string, boolean>;
  /** Items taken or despawned. */
  gone: Record<string, boolean>;
  spawned: Spawned[];
  /** The player's light (spec §6): whether it is on, and the seconds of fuel left (Infinity when it never runs out). */
  light: { on: boolean; fuel: number };
  /** Actors that move (patrols, companions), where they are now, by item id. */
  actors: Record<string, ActorPose>;
  /** Spawners and once-only volumes that have gone off. */
  done: Record<string, boolean>;
  /** Volumes the player is inside. */
  inside: string[];
  /** Rule id → when it last ran (timers). */
  timers: Record<string, number>;
  objective?: string;
  checkpoint?: Where;
  health: number;
  time: number;
  cinematic?: { id: string; name: string; seconds: number; until: number };
  scene?: { id: string; title: string; text: string };
  message?: { text: string; until: number };
  /** A portal or rule sent the player to another level. */
  goTo?: string;
  over?: { text: string };
  log: LevelLogEntry[];
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
    light: { on: false, fuel: fullFuel(project, levelId, options.global) },
    done: {},
    inside: [],
    timers: {},
    health: 100,
    time: 0,
    log: [{ t: 0, kind: 'info', text: `${level?.name ?? 'Level'} starts${options.preset ? ` from “${options.preset.name}”` : options.world ? ' carrying the story on' : ''}.` }],
  };
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
export const present = (project: Project, state: LevelPlayState, item: LevelItem): boolean =>
  item.levelId === state.levelId && !item.hidden && !state.gone[item.id] && state.enabled[item.id] !== false && evaluate(item.activeWhen, state.world);

export const isOpen = (project: Project, state: LevelPlayState, item: LevelItem, global?: readonly AssetDefinition[]): boolean => {
  if (item.id in state.open) return state.open[item.id]!;
  const set = levelsOf(project);
  return bool(paramOf(set, item, 'startsOpen', global), false) || String(paramOf(set, item, 'swing', global)) === 'open archway';
};

const name = (project: Project, id: string) => project.objects[id]?.name ?? levelsOf(project).items.find((i) => i.id === id)?.name ?? '?';

const log = (state: LevelPlayState, entry: Omit<LevelLogEntry, 't'>): LevelPlayState => ({ ...state, log: [...state.log, { t: Math.round(state.time * 10) / 10, ...entry }].slice(-LOG_LIMIT) });

const say = (state: LevelPlayState, text: string, seconds = 3): LevelPlayState => ({ ...state, message: { text, until: state.time + seconds } });

const fromStory = (state: LevelPlayState, entries: Entry[], itemId?: string): LevelPlayState =>
  entries.reduce((s, e) => ('text' in e ? log(s, { kind: e.kind === 'fired' ? 'event' : 'effect', text: e.text, itemId }) : s), state);

const changeWorld = (project: Project, state: LevelPlayState, world: PlayWorld, entries: Entry[], itemId: string | undefined, depth: number): LevelPlayState => {
  const before = JSON.stringify(state.world);
  let next = fromStory({ ...state, world }, entries, itemId);
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
  return { ...s, scene: { id: sceneId, title: `${scene.data.code ? `${String(scene.data.code)} ` : ''}${scene.name}`, text: String(scene.data.summary ?? '') } };
};

export const playCinematic = (project: Project, state: LevelPlayState, cinematicId: string): LevelPlayState => {
  const c = project.objects[cinematicId];
  if (!c) return state;
  const seconds = Math.max(2, cinematicTiming(project, cinematicId).seconds || 4);
  return { ...state, cinematic: { id: cinematicId, name: c.name, seconds, until: state.time + seconds } };
};

/** Skip or finish what is playing over the level: a cinematic, or a scene's card. */
export const dismiss = (state: LevelPlayState): LevelPlayState =>
  state.cinematic ? log({ ...state, cinematic: undefined }, { kind: 'info', text: `${state.cinematic.name} ends` }) : state.scene ? { ...state, scene: undefined } : state;

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

const INTERACTIVE_ROLES = new Set(['door', 'pickup', 'inventory', 'weapon', 'ammo', 'health', 'npc', 'companion', 'neutral', 'dialogue', 'interaction', 'puzzle', 'elevator', 'ladder']);

/** What pressing Interact would do to this item, if anything. */
export const offerFor = (project: Project, state: LevelPlayState, item: LevelItem, global?: readonly AssetDefinition[]): Offer | null => {
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
  if (def.role === 'door') {
    const open = isOpen(project, state, item, global);
    if (String(paramOf(set, item, 'swing', global)) === 'open archway') return null;
    const key = String(paramOf(set, item, 'keyItem', global) ?? '');
    const locked = bool(paramOf(set, item, 'locked', global), false) && !state.unlocked[item.id];
    if (!open && locked && key && !(state.world.items[key] ?? 0)) return { itemId: item.id, verb: prompt, label: item.name, blocked: `Locked. Needs ${name(project, key)}.` };
    if (!open && locked && !key) return { itemId: item.id, verb: prompt, label: item.name, blocked: 'Locked.' };
    return { itemId: item.id, verb: open ? 'Close' : locked ? `${prompt}` : 'Open', label: item.name };
  }
  return { itemId: item.id, verb: prompt, label: item.name };
};

/** The player uses an item: what each kind of thing does, then its rules. */
export const interactWith = (project: Project, state: LevelPlayState, itemId: string, global?: readonly AssetDefinition[]): LevelPlayState => {
  const set = levelsOf(project);
  const item = set.items.find((i) => i.id === itemId);
  if (!item) return state;
  const offer = offerFor(project, state, item, global);
  if (!offer) return state;
  const def = assetOf(set, item, global);
  let s = log(state, { kind: 'event', itemId, text: `${offer.verb} · ${item.name}` });
  if (offer.blocked) return say(log(s, { kind: 'check', itemId, pass: false, text: `${item.name}: ${offer.blocked}` }), offer.blocked);

  if (def.role === 'door') {
    const open = isOpen(project, s, item, global);
    const key = String(paramOf(set, item, 'keyItem', global) ?? '');
    const locked = bool(paramOf(set, item, 'locked', global), false) && !s.unlocked[item.id];
    if (!open && locked && key) {
      s = log({ ...s, unlocked: { ...s.unlocked, [item.id]: true } }, { kind: 'check', itemId, pass: true, text: `${item.name} unlocks with ${name(project, key)}` });
    }
    s = { ...s, open: { ...s.open, [item.id]: !open } };
    s = log(s, { kind: 'action', itemId, text: `${item.name} ${open ? 'closes' : 'opens'}` });
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
    if (story && !own) {
      const used = useStoryObject(project, s.world, story);
      if (used.needs) s = say(log(s, { kind: 'check', itemId, pass: false, text: `${name(project, story)}: needs ${used.needs}` }), `Needs ${used.needs}`);
      else s = changeWorld(project, s, used.world, used.log, itemId, 0);
    }
  }
  s = runRules(project, s, itemId, 'interact', undefined, 0, global);
  return runRules(project, s, itemId, 'use', undefined, 0, global);
};

// ---------------------------------------------------------------- time passing

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
  // While a cinematic or a scene card is up, the level waits.
  if (s.cinematic || s.scene) return s;

  // The light burns its fuel while it is on, and goes out when that runs out (or its source is gone).
  if (s.light?.on) {
    if (!hasLightSource(project, s, global)) s = say({ ...s, light: { ...s.light, on: false } }, 'Your light goes out.');
    else if (Number.isFinite(s.light.fuel)) {
      const fuel = Math.max(0, s.light.fuel - dt);
      s = fuel > 0 ? { ...s, light: { ...s.light, fuel } } : log(say({ ...s, light: { on: false, fuel: 0 } }, 'Your light goes out: no fuel left.'), { kind: 'warn', text: 'The light ran out of fuel' });
    }
  }

  // Patrols walk on, companions keep up.
  const actors = stepActors(set, s.actors ?? {}, dt, s.time, at, (i) => present(project, s, i), global);
  if (actors !== s.actors) s = { ...s, actors };

  const items = set.items.filter((i) => i.levelId === s.levelId && present(project, s, i));
  const volumes = items.filter((i) => assetOf(set, i, global).kind === 'volume');
  const inside = volumes.filter((v) => volumeHolds(set, v, at, elevation.get(v.floorId) ?? 0, global)).map((v) => v.id);

  for (const id of inside.filter((id) => !s.inside.includes(id))) s = enter(project, s, id, global);
  for (const id of s.inside.filter((id) => !inside.includes(id))) {
    s = log(s, { kind: 'event', itemId: id, text: `Leaves ${name(project, id)}` });
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
    const perSecond = num(paramOf(set, item, 'damage', global), 10);
    if (perSecond > 0) s = { ...s, health: Math.max(0, s.health - perSecond * dt) };
  }
  if (s.health <= 0 && !s.over) s = log({ ...s, over: { text: 'You didn’t make it.' } }, { kind: 'warn', text: 'The player is dead' });

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
  if (def.role === 'cinematic' && cinematic && !plays) s = playCinematic(project, log(s, { kind: 'action', itemId: id, text: `Plays ${name(project, cinematic)}` }), cinematic);
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
  return runRules(project, s, id, 'enter', undefined, 0, global);
};

/** Change the story by hand in the inspect panel (to set up a test), and let it settle. */
export const setWorldByHand = (project: Project, state: LevelPlayState, world: PlayWorld, what: string): LevelPlayState => {
  const settled = settleWorld(project, world);
  return changeWorld(project, log(state, { kind: 'info', text: `By hand: ${what}` }), settled.world, settled.log, undefined, 0);
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
