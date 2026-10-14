import type { Project } from '../types';
import { levelsOf, withSet } from './level';
import type { Floor, Level, LevelItem } from './types';

/**
 * Cooperative editing (structure spec V2), without a server: a structure is
 * handed out as a working copy, worked on elsewhere, and merged back.
 *
 * - **Claims.** A structure can be claimed: "Sam is working on this". A
 *   claim warns, it doesn't lock; it is released when the copy comes back.
 * - **Working copies.** Handing out a structure makes a project file the
 *   teammate opens as usual: the whole project, so the story is there, with
 *   the structure as it was handed out (its base) kept inside.
 * - **Merging back** is three-way, by GUID. For each item, floor and the
 *   structure's settings, what changed only on their side comes in, what
 *   changed only here stays, and what changed differently on both sides is a
 *   conflict, chosen item by item: keep mine or take theirs.
 *   Story objects they added and their items point at come with it.
 */

export interface Claim {
  by: string;
  at: string;
  /** The working copy it was handed out as, if it was. */
  copyId?: string;
  note?: string;
}

/** What a working copy remembers: where it came from, and the structure as it was handed out. */
export interface WorkingCopyInfo {
  copyId: string;
  levelId: string;
  levelName: string;
  /** The project it was handed out from (its name), and by whom, when, to whom. */
  from: string;
  by: string;
  to: string;
  at: string;
  base: { level: Level; items: LevelItem[] };
}

export const WORKING_SUFFIX = ' (working copy)';

const json = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
const same = (a: unknown, b: unknown) => json(a) === json(b);
const copyId = () => `copy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const claimOf = (project: Project, levelId: string): Claim | undefined => levelsOf(project).levels.find((l) => l.id === levelId)?.claim;

const withLevel = (project: Project, levelId: string, patch: (l: Level) => Level): Project => {
  const set = levelsOf(project);
  return withSet(project, { ...set, levels: set.levels.map((l) => (l.id === levelId ? patch(l) : l)) });
};

/** Claim a structure: say who is working on it. */
export const claim = (project: Project, levelId: string, by: string, now = new Date().toISOString(), note?: string): Project =>
  withLevel(project, levelId, (l) => ({ ...l, claim: { by: by.trim() || 'Someone', at: now, ...(note ? { note } : {}) } }));

export const release = (project: Project, levelId: string): Project =>
  withLevel(project, levelId, (l) => {
    const { claim: _c, ...rest } = l;
    return rest;
  });

const structureItems = (project: Project, levelId: string) => levelsOf(project).items.filter((i) => i.levelId === levelId);
const strippedLevel = (l: Level): Level => {
  const { claim: _c, ...rest } = l;
  return rest;
};

/**
 * Hand a structure out (structure spec V2): the project as a working copy to
 * give a teammate, and this project with the structure claimed for them.
 */
export const handOut = (project: Project, levelId: string, to: string, by: string, now = new Date().toISOString()): { project: Project; copy: Project } | null => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId);
  if (!level) return null;
  const id = copyId();
  const info: WorkingCopyInfo = { copyId: id, levelId, levelName: level.name, from: project.name, by: by.trim() || 'Someone', to: to.trim() || 'a teammate', at: now, base: { level: strippedLevel(level), items: structureItems(project, levelId) } };
  const claimed = withLevel(project, levelId, (l) => ({ ...l, claim: { by: info.to, at: now, copyId: id } }));
  const cs = levelsOf(claimed);
  const copy = withSet({ ...claimed, name: `${project.name} — ${level.name}${WORKING_SUFFIX}` }, { ...cs, working: info });
  return { project: claimed, copy };
};

export const workingCopyOf = (project: Project): WorkingCopyInfo | undefined => levelsOf(project).working;

// ---------------------------------------------------------------- merging back

export type Side = 'mine' | 'theirs';

/** One thing the merge does, or asks about. */
export interface MergeEntry {
  /** An item's GUID, a floor's id, or "settings" for the structure's own settings. */
  id: string;
  what: 'item' | 'floor' | 'settings';
  name: string;
  /** What happened on each side since the hand-out. */
  mine: 'same' | 'added' | 'changed' | 'removed';
  theirs: 'same' | 'added' | 'changed' | 'removed';
  /** Which fields differ, where it changed on both sides. */
  fields?: string[];
  /** What it comes to unless chosen: theirs where only they changed it; a conflict otherwise. */
  take: Side | 'conflict';
}

export interface MergePlan {
  levelId: string;
  levelName: string;
  from: { by: string; to: string; at: string };
  entries: MergeEntry[];
  conflicts: MergeEntry[];
  /** Story objects they added that the structure points at. */
  objects: string[];
  problems: string[];
}

const changedFields = (a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined) => {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  return [...keys].filter((k) => !same(a?.[k], b?.[k])).sort();
};

const three = <T extends { id: string }>(base: readonly T[], mine: readonly T[], theirs: readonly T[], what: MergeEntry['what'], nameOf: (x: T) => string): MergeEntry[] => {
  const B = new Map(base.map((x) => [x.id, x]));
  const M = new Map(mine.map((x) => [x.id, x]));
  const T = new Map(theirs.map((x) => [x.id, x]));
  const ids = [...new Set([...B.keys(), ...M.keys(), ...T.keys()])];
  const state = (b: T | undefined, x: T | undefined): MergeEntry['mine'] => (!b ? (x ? 'added' : 'same') : !x ? 'removed' : same(b, x) ? 'same' : 'changed');
  const out: MergeEntry[] = [];
  for (const id of ids) {
    const b = B.get(id);
    const m = M.get(id);
    const t = T.get(id);
    const mine = state(b, m);
    const theirs = state(b, t);
    if (theirs === 'same') continue;
    const both = mine !== 'same' && !(m && t && same(m, t)) && !(mine === 'removed' && theirs === 'removed');
    if (mine !== 'same' && !both) continue;
    out.push({
      id,
      what,
      name: nameOf((t ?? m ?? b)!),
      mine,
      theirs,
      ...(both && m && t ? { fields: changedFields(m as Record<string, unknown>, t as Record<string, unknown>) } : {}),
      take: both ? 'conflict' : 'theirs',
    });
  }
  return out;
};

const SETTINGS = (l: Level) => {
  const { floors: _f, generation: _g, claim: _c, ...rest } = l;
  return { ...rest, id: 'settings' };
};

/**
 * What merging this working copy back would do (structure spec V2): every
 * change of theirs, and each conflict to choose. Nothing is changed yet.
 */
export const mergePlan = (project: Project, copy: Project): MergePlan | { problems: string[] } => {
  const info = workingCopyOf(copy);
  if (!info) return { problems: ['That isn’t a working copy: it was saved from a project, not handed out from one.'] };
  const ours = levelsOf(project).levels.find((l) => l.id === info.levelId);
  if (!ours) return { problems: [`${info.levelName} isn’t in this project: the working copy was handed out from ${info.from}.`] };
  const theirsLevel = levelsOf(copy).levels.find((l) => l.id === info.levelId);
  if (!theirsLevel) return { problems: [`The working copy no longer has ${info.levelName} in it.`] };
  const problems: string[] = [];
  const claimNow = ours.claim;
  if (claimNow?.copyId && claimNow.copyId !== info.copyId) problems.push(`${info.levelName} was handed out again since (to ${claimNow.by}); merging this older copy may bring back what that one changes.`);
  const items = three(info.base.items, structureItems(project, info.levelId), structureItems(copy, info.levelId), 'item', (i) => i.name);
  const floors = three<Floor>(info.base.level.floors, ours.floors, theirsLevel.floors, 'floor', (f) => f.name);
  const settings = three([SETTINGS(info.base.level)], [SETTINGS(ours)], [SETTINGS(theirsLevel)], 'settings', () => `${info.levelName}’s settings`);
  const entries = [...settings, ...floors, ...items];
  // Story objects they made, that their structure points at, and this project hasn't.
  const wanted = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      if (copy.objects[v] && !project.objects[v]) wanted.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(structureItems(copy, info.levelId));
  return { levelId: info.levelId, levelName: info.levelName, from: { by: info.by, to: info.to, at: info.at }, entries, conflicts: entries.filter((e) => e.take === 'conflict'), objects: [...wanted], problems };
};

/**
 * Merge a working copy back, as one change: their changes in, conflicts as
 * chosen (mine unless chosen otherwise), the story objects they added, and
 * the claim released.
 */
export const applyMerge = (project: Project, copy: Project, choices: Readonly<Record<string, Side>> = {}): { project: Project; taken: number; kept: number } => {
  const plan = mergePlan(project, copy);
  if (!('entries' in plan)) return { project, taken: 0, kept: 0 };
  const theirSet = levelsOf(copy);
  const set = levelsOf(project);
  const theirLevel = theirSet.levels.find((l) => l.id === plan.levelId)!;
  const takeIt = (e: MergeEntry) => (e.take === 'conflict' ? choices[e.id] === 'theirs' : true);
  let taken = 0;
  let kept = 0;
  const take = new Set<string>();
  for (const e of plan.entries) {
    if (takeIt(e)) {
      take.add(`${e.what}:${e.id}`);
      taken++;
    } else kept++;
  }
  // Items: theirs where taken (or gone, where they removed it).
  const theirItems = new Map(theirSet.items.filter((i) => i.levelId === plan.levelId).map((i) => [i.id, i]));
  let items = set.items.filter((i) => !(i.levelId === plan.levelId && take.has(`item:${i.id}`) && !theirItems.has(i.id)));
  items = items.map((i) => (take.has(`item:${i.id}`) && theirItems.has(i.id) ? theirItems.get(i.id)! : i));
  for (const [id, i] of theirItems) if (take.has(`item:${id}`) && !items.some((x) => x.id === id)) items.push(i);
  // Floors and settings.
  const levels = set.levels.map((l) => {
    if (l.id !== plan.levelId) return l;
    let floors = l.floors.filter((f) => !(take.has(`floor:${f.id}`) && !theirLevel.floors.some((t) => t.id === f.id)));
    floors = floors.map((f) => (take.has(`floor:${f.id}`) ? theirLevel.floors.find((t) => t.id === f.id) ?? f : f));
    for (const f of theirLevel.floors) if (take.has(`floor:${f.id}`) && !floors.some((x) => x.id === f.id)) floors.push(f);
    floors.sort((a, b) => a.elevation - b.elevation);
    const base = take.has('settings:settings') ? { ...theirLevel, floors, generation: l.generation ?? theirLevel.generation } : { ...l, floors };
    const { claim: _c, ...rest } = base as Level;
    return (l.claim && l.claim.copyId && l.claim.copyId !== workingCopyOf(copy)!.copyId ? { ...rest, claim: l.claim } : rest) as Level;
  });
  // Serials: keep the counters ahead of anything they numbered.
  const counters = { ...set.counters };
  for (const [k, v] of Object.entries(theirSet.counters)) counters[k as keyof typeof counters] = Math.max(counters[k as keyof typeof counters] ?? 0, v ?? 0);
  const objects = { ...project.objects };
  for (const id of plan.objects) objects[id] = copy.objects[id]!;
  // Their project assets the merged items use and this project hasn't.
  const assets = [...set.assets];
  for (const i of items) if (i.levelId === plan.levelId && !assets.some((a) => a.id === i.assetId)) {
    const a = theirSet.assets.find((x) => x.id === i.assetId);
    if (a) assets.push(a);
  }
  return { project: withSet({ ...project, objects }, { ...set, levels, items, counters, assets }), taken, kept };
};

/** Send a working copy back: the same file, saved; this names it plainly. */
export const sendBackName = (project: Project): string => {
  const info = workingCopyOf(project);
  return `${(info ? `${info.from} — ${info.levelName} from ${info.to}` : project.name).replace(/[\\/:*?"<>|]+/g, ' ').trim()}.vcgs`;
};
