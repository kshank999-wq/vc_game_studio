import { makeObject, nextCode, placeNew } from './project';
import { addElement } from './scene';
import { addEvent } from './timeline';
import { setData, varTypeOf } from './details';
import { sceneTimeline } from './timeline';
import { dropEquipped } from './rules';
import type { PlayWorld } from './play';
import type { Project, StoryObject } from './types';

/**
 * Captured (adventure games): losing a fight doesn't have to end the game.
 * The player can be taken to a holding cell instead: what they carry is taken
 * and kept in a locker, they escape the cell (a scene of its own, with its
 * puzzle), get their things back, and the story picks up where they were
 * caught. Each capture is counted in a number state, so endings can depend
 * on it, and enough captures can end the story outright.
 *
 * What captures the player: losing an encounter whose "If the player loses"
 * is Captured; or, with the rule's health set, any loss that leaves health
 * below 1. In Play Mode, health running out, or a captor catching the player.
 */
export interface CaptureRule {
  /** The holding cell: a scene, off the spine, that the player is taken to. */
  cellId?: string;
  /** What is taken from the player. */
  take: 'all' | 'listed' | 'none';
  /** With 'listed': the items taken. */
  items?: string[];
  /** Items never taken (what the story needs the player to keep). */
  keep?: string[];
  /** Where the taken things are kept: an object; using it gives them back. Without one they come back on the way out. */
  lockerId?: string;
  /** A number state that counts captures (endings and choices can depend on it). */
  countId?: string;
  /** The player's health, a number state: set to `healthAfter` on capture; a loss that leaves it below 1 captures the player. */
  healthId?: string;
  healthAfter?: number;
  /** Where the story goes on after the escape: a node, or (absent) back where the player was caught, past the fight. */
  backTo?: string;
  /** Captured this many times, the story ends at `limitId` (an ending, or a game over) instead. 0 or absent: no limit. */
  limit?: number;
  limitId?: string;
  /** Characters who catch the player in Play Mode, rather than fight them. */
  captors?: string[];
}

export const captureOf = (project: Project): CaptureRule | undefined => project.capture;

/** Whether capture is on: there is a rule, and its cell is a scene in the story. */
export const captureOn = (project: Project): boolean => project.objects[project.capture?.cellId ?? '']?.type === 'scene';

/** Change the rule (starting from an empty one). */
export const setCapture = (project: Project, patch: Partial<CaptureRule>): Project => {
  const next: CaptureRule = { take: 'all', ...project.capture, ...patch };
  for (const key of Object.keys(next) as (keyof CaptureRule)[]) if (next[key] === undefined || (Array.isArray(next[key]) && !(next[key] as unknown[]).length) || next[key] === '') delete next[key];
  return { ...project, capture: next };
};

export const clearCapture = (project: Project): Project => {
  const { capture: _gone, ...rest } = project;
  return rest;
};

/** The verb the locker gets in a free play while it holds the player's things. */
export const LOCKER_VERB = { id: 'vcgs.locker', verb: 'Take back your things' } as const;

/** What a capture takes from these carried items: what is taken (and kept in the locker), and what the player keeps. */
export const takenFrom = (rule: CaptureRule, items: Readonly<Record<string, number>>): { taken: Record<string, number>; left: Record<string, number> } => {
  const keep = new Set(rule.keep ?? []);
  const listed = new Set(rule.items ?? []);
  const taken: Record<string, number> = {};
  const left: Record<string, number> = {};
  for (const [id, n] of Object.entries(items)) {
    if (n <= 0) continue;
    const goes = rule.take === 'all' ? !keep.has(id) : rule.take === 'listed' ? listed.has(id) && !keep.has(id) : false;
    if (goes) taken[id] = n;
    else left[id] = n;
  }
  return { taken, left };
};

const numberIn = (world: PlayWorld, id: string | undefined) => (id ? Number(world.flags[id] ?? 0) || 0 : 0);

/** With capture on and its health set: whether health has run out (below 1). */
export const healthOut = (project: Project, world: PlayWorld): boolean => captureOn(project) && !!project.capture!.healthId && numberIn(world, project.capture!.healthId) < 1;

/**
 * What a capture does to the world: counted, health set, what is carried
 * taken (unequipped) into the locker. `ends` is the end the rule names when
 * this capture is one too many.
 */
export const captureWorld = (project: Project, world: PlayWorld): { world: PlayWorld; times: number; taken: string[]; ends?: string } => {
  const r = project.capture!;
  const times = numberIn(world, r.countId) + 1;
  const flags = { ...world.flags };
  if (r.countId) flags[r.countId] = String(times);
  if (r.healthId && r.healthAfter !== undefined) flags[r.healthId] = String(r.healthAfter);
  const { taken, left } = takenFrom(r, world.items);
  const next: PlayWorld = { ...world, flags, items: left, equipped: { ...world.equipped }, wear: { ...world.wear } };
  for (const id of Object.keys(taken)) dropEquipped(next, id);
  const held = { ...world.taken };
  for (const [id, n] of Object.entries(taken)) held[id] = (held[id] ?? 0) + n;
  if (Object.keys(held).length) next.taken = held;
  const ends = (r.limit ?? 0) > 0 && times >= r.limit! && r.limitId && project.objects[r.limitId] ? r.limitId : undefined;
  return { world: next, times, taken: Object.keys(taken), ...(ends ? { ends } : {}) };
};

/** What a capture took, given back. */
export const giveBackWorld = (world: PlayWorld): { world: PlayWorld; items: string[] } => {
  const taken = world.taken;
  if (!taken) return { world, items: [] };
  const items = { ...world.items };
  for (const [id, n] of Object.entries(taken)) items[id] = (items[id] ?? 0) + n;
  const { taken: _gone, ...rest } = world;
  return { world: { ...rest, items }, items: Object.keys(taken) };
};

/** The locker, while it holds what a capture took. */
export const lockerHolding = (project: Project, world: PlayWorld): string | undefined => {
  const id = project.capture?.lockerId;
  return id && project.objects[id] && Object.keys(world.taken ?? {}).length ? id : undefined;
};

const numberState = (o: StoryObject | undefined) => o?.type === 'state' && varTypeOf(o) === 'number';

/** What is wrong with the rule, in words, for the capture panel and the path. */
export const captureIssues = (project: Project): string[] => {
  const r = project.capture;
  if (!r) return [];
  const out: string[] = [];
  const o = (id?: string) => (id ? project.objects[id] : undefined);
  if (!r.cellId) out.push('Choose the holding cell: the scene the player is taken to.');
  else if (o(r.cellId)?.type !== 'scene') out.push('The holding cell is no longer a scene in the story.');
  else if (project.placements[r.cellId]?.laneId) out.push('The holding cell is on a track: put it off the spine, so the story only goes there by capture.');
  if (r.lockerId && o(r.lockerId)?.type !== 'object') out.push('The locker is no longer an object in the story.');
  if (r.countId && !numberState(o(r.countId))) out.push('What counts captures must be a number state.');
  if (r.healthId && !numberState(o(r.healthId))) out.push('Health must be a number state.');
  if (r.take === 'listed' && !(r.items ?? []).length) out.push('Nothing is listed to take: list the items, or take everything.');
  if (r.backTo && !o(r.backTo)) out.push('Where the story goes after the escape is no longer in the story.');
  if ((r.limit ?? 0) > 0 && !(o(r.limitId)?.type === 'end' || o(r.limitId)?.data.outcome)) out.push('Choose where too many captures end the story: an ending, or a game over.');
  if (r.cellId && o(r.cellId)?.type === 'scene' && !sceneTimeline(project, r.cellId)[0]?.events.length) out.push('The holding cell has nothing in it yet: give it a way out (a puzzle in a free play).');
  return out;
};

/** A number state of this name (case aside), if there is one. */
const numberNamed = (project: Project, name: string) => Object.values(project.objects).find((o) => numberState(o) && o.name.trim().toLowerCase() === name.toLowerCase());

const addNumber = (project: Project, name: string, initial: number, now: string): { project: Project; id: string } => {
  const found = numberNamed(project, name);
  if (found) return { project, id: found.id };
  const o = makeObject('state', name, now, { code: nextCode(project, { prefix: 'ST-', pad: 2 }), varType: 'number', ...(initial ? { initialValue: initial } : {}) });
  return { project: { ...project, objects: { ...project.objects, [o.id]: o } }, id: o.id };
};

/**
 * Set capture up with what it needs, keeping anything already there: a
 * holding cell (a scene off the spine), a locker (an object), Times captured
 * and Health (number states; Health starts at 100). Everything is taken but
 * what is kept; the story goes on where the player was caught.
 */
export const setUpCapture = (project: Project, now = new Date().toISOString()): Project => {
  let p = project;
  const r = p.capture;
  let cellId = r?.cellId && p.objects[r.cellId]?.type === 'scene' ? r.cellId : undefined;
  let lockerId = r?.lockerId && p.objects[r.lockerId]?.type === 'object' ? r.lockerId : undefined;
  if (!cellId) {
    const placed = placeNew(p, 'scene', null, 0, -420, now);
    if (placed) {
      p = { ...placed.project, objects: { ...placed.project.objects, [placed.id]: { ...placed.project.objects[placed.id]!, name: 'Holding cell', data: { ...placed.project.objects[placed.id]!.data, summary: 'Where the player is taken when captured. Give it a way out: a puzzle in a free play.' } } } };
      cellId = placed.id;
      // A way out to fill in, and the locker on the way, where the player gets their things back.
      p = addEvent(p, cellId, 'freePlay', { label: 'Find a way out' })?.project ?? p;
      if (!lockerId) {
        const locker = addElement(p, cellId, 'object', 'Evidence locker', now);
        if (locker) {
          p = setData(locker.project, locker.id, { summary: 'Where what was taken from the player is kept. Using it gives it all back.' });
          lockerId = locker.id;
        }
      }
    }
  }
  if (!lockerId) {
    const o = makeObject('object', 'Evidence locker', now, { code: nextCode(p, { prefix: 'OBJ-', pad: 2 }), summary: 'Where what was taken from the player is kept. Using it gives it all back.' });
    p = { ...p, objects: { ...p.objects, [o.id]: o } };
    lockerId = o.id;
  }
  const count = r?.countId && numberState(p.objects[r.countId]) ? { project: p, id: r.countId } : addNumber(p, 'Times captured', 0, now);
  p = count.project;
  const health = r?.healthId && numberState(p.objects[r.healthId]) ? { project: p, id: r.healthId } : addNumber(p, 'Health', 100, now);
  p = health.project;
  if (!(p.objects[health.id]!.data.initialValue)) p = setData(p, health.id, { initialValue: 100 });
  return setCapture(p, { cellId, lockerId, countId: count.id, healthId: health.id, healthAfter: r?.healthAfter ?? 50, take: r?.take ?? 'all' });
};

/** The rule in a sentence, for the path and the Bible. */
export const describeCapture = (project: Project): string => {
  const r = project.capture;
  if (!captureOn(project) || !r) return 'No capture: a lost fight plays as it says.';
  const n = (id?: string) => (id ? project.objects[id]?.name ?? '?' : '');
  const taken = r.take === 'all' ? `everything${r.keep?.length ? ` but ${r.keep.map(n).join(', ')}` : ''} is taken` : r.take === 'listed' ? `${(r.items ?? []).map(n).join(', ') || 'nothing'} is taken` : 'nothing is taken';
  const kept = r.take === 'none' ? '' : r.lockerId ? `, into ${n(r.lockerId)}` : ', and given back on the way out';
  const back = r.backTo ? `the story goes on at ${n(r.backTo)}` : 'the story goes on where they were caught';
  const limit = (r.limit ?? 0) > 0 && r.limitId ? `; captured ${r.limit} times, it ends at ${n(r.limitId)}` : '';
  return `Captured, the player is taken to ${n(r.cellId)}; ${taken}${kept}. Once out, ${back}${limit}.`;
};
