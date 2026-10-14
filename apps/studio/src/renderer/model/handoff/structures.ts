import { initialState } from '../details';
import { doorRules } from '../level/doors';
import { assetOf, paramOf } from '../level/geometry';
import { floorCodes, floorKindOf, footprintOf, OUTSIDE, structureGraph } from '../level/structure';
import type { Level, LevelSet } from '../level/types';
import { walkStructure } from '../level/walkthrough';
import type { Project } from '../types';
import type { IrEffect, IrRule } from './ir';
import type { StoryKeys } from './levels';

/**
 * A structure's manifest (structure spec §13, §14): the parts of a
 * structure an engine needs beyond the items it places — its floors with
 * their codes and footprints, its rooms, how they connect, each door's
 * rules, what the player is there to do, when it is complete and what that
 * does, which states are its own, and what it remembers between visits.
 * Everything is by the same stable ids as the items (GUIDs) and the story's
 * keys, so a re-export updates what is there rather than adding to it.
 */
export interface IrStructure {
  /** The structure's name, as the studio shows it. */
  name: string;
  type: string;
  purpose: string;
  tags: string[];
  author: string;
  /** stairs, ladders, accessible (step-free) or mixed: which ways between floors count. */
  traversal: string;
  /** The story scene it plays as (its key), if any. */
  scene: string | null;
  /** Its mass on the map it stands on (a GUID there), if any. */
  mass: string | null;
  floors: IrStructureFloor[];
  /** Its rooms, halls and stairwells, by GUID. */
  spaces: { guid: string; name: string; floor: string; role: string }[];
  /** How the rooms connect: `outside` for the way in. */
  connections: IrConnection[];
  /** Each door's rules (structure spec §7), by GUID. */
  doors: IrDoorRules[];
  /** The doors that lead in from outside, by GUID. */
  entrances: string[];
  objectives: { id: string; text: string; at: string | null; when?: IrRule; optional: boolean }[];
  /** When it is complete; absent, when every objective that isn't optional is done. */
  complete_when?: IrRule;
  /** What completing it does to the story outside. */
  on_complete?: IrEffect[];
  /** Story states that belong to it (their keys, and the value the story starts them at): back to that whenever its puzzles reset. */
  local_states: { key: string; start: string }[];
  /** The puzzles its items are bound to or linked with (their keys): unsolved again when its puzzles reset. */
  puzzles: string[];
  /** What it remembers between visits: keep or reset. */
  persist: { doors: string; items: string; enemies: string; puzzles: string };
  /** The seed and generator version of the layout last accepted, for reproducing it. */
  generation: { seed: number; version: string; accepted: string } | null;
  /** How a player gets through it, step by step, as the studio's solvability check walks it (for testing in the engine). */
  walkthrough: string[];
}

export interface IrStructureFloor {
  /** The level's floor key. */
  key: string;
  /** B2, B1, G, 2, 3 … R. */
  code: string;
  kind: string;
  elevation: number;
  height: number;
  /** Its footprint's corners [x, z] in metres, clockwise seen from above; null when it has none. */
  footprint: [number, number][] | null;
}

export interface IrConnection {
  from: string;
  to: string;
  /** The item that joins them: the door, the stairs, the lift (a GUID). */
  via: string;
  kind: string;
  vertical: boolean;
  /** Shut until something opens it: a key, a condition, a puzzle. */
  gated: boolean;
  /** Only from `from` to `to`. */
  one_way: boolean;
  secret: boolean;
}

export interface IrDoorRules {
  guid: string;
  locked: boolean;
  /** The item that unlocks it (its story key), if any. */
  key: string | null;
  /** Opens only from inside its room, or only from outside it; null both ways. */
  one_way: 'inside' | 'outside' | null;
  /** The room whose wall it is in (a GUID): what inside and outside mean. */
  room: string | null;
  /** Seconds it stays open before it shuts again; 0 for good. */
  open_for: number;
  secret: boolean;
  breakable: boolean;
  /** What it takes to break it (its story key); null for bare hands. */
  break_with: string | null;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export const structureManifest = (project: Project, set: LevelSet, level: Level, floorKey: ReadonlyMap<string, string>, exported: ReadonlySet<string>, story: StoryKeys): IrStructure | undefined => {
  const info = level.structure;
  if (!info) return undefined;
  const codes = floorCodes(level);
  const graph = structureGraph(set, level.id);
  const id = (x: string) => (x === OUTSIDE ? 'outside' : x);
  const items = set.items.filter((i) => i.levelId === level.id && exported.has(i.id));
  const doors = items.filter((i) => assetOf(set, i).role === 'door');
  const last = level.generation?.[level.generation.length - 1];
  return {
    name: level.name,
    type: info.type,
    purpose: info.purpose,
    tags: [...info.tags],
    author: info.author,
    traversal: info.traversal,
    scene: info.scene ? story.key(info.scene) : null,
    mass: level.anchorId ?? null,
    floors: [...level.floors]
      .sort((a, b) => a.elevation - b.elevation)
      .map((f) => {
        const poly = footprintOf(set, level, f.id);
        return { key: floorKey.get(f.id)!, code: codes.get(f.id) ?? '', kind: floorKindOf(f), elevation: f.elevation, height: f.height, footprint: poly ? poly.map((p): [number, number] => [round(p.x), round(p.y)]) : null };
      }),
    spaces: graph.nodes.filter((n) => exported.has(n.id)).map((n) => ({ guid: n.id, name: n.name, floor: floorKey.get(n.floorId) ?? '', role: n.role })),
    connections: graph.edges
      .filter((e) => exported.has(e.via))
      .map((e) => ({ from: id(e.from), to: id(e.to), via: e.via, kind: e.kind, vertical: e.vertical, gated: e.gated, one_way: !!e.oneWay, secret: !!e.secret })),
    doors: doors.map((d) => {
      const r = doorRules(set, d);
      return {
        guid: d.id,
        locked: r.locked,
        key: r.key ? story.key(r.key) : null,
        one_way: r.oneWay,
        room: d.host && exported.has(d.host.id) ? d.host.id : null,
        open_for: round(r.openFor),
        secret: r.secret,
        breakable: r.breakable,
        break_with: r.breakWith ? story.key(r.breakWith) : null,
      };
    }),
    entrances: graph.edges.filter((e) => e.kind === 'door' && (e.from === OUTSIDE || e.to === OUTSIDE) && exported.has(e.via)).map((e) => e.via),
    objectives: (info.objectives ?? []).map((o) => {
      const when = story.rule(o.when);
      return { id: o.id, text: o.text, at: o.at && exported.has(o.at) ? o.at : null, ...(when ? { when } : {}), optional: !!o.optional };
    }),
    ...(story.rule(info.completeWhen) ? { complete_when: story.rule(info.completeWhen) } : {}),
    ...(story.effects(info.onComplete) ? { on_complete: story.effects(info.onComplete) } : {}),
    local_states: (info.localStates ?? []).flatMap((s) => (story.key(s) ? [{ key: story.key(s)!, start: initialState(project.objects[s]) ?? '' }] : [])),
    puzzles: [...new Set(items.flatMap((i) => [...(i.puzzles ?? []).map((b) => b.puzzle), ...(i.links ?? []).filter((l) => project.objects[l]?.type === 'puzzle')]))].map((k) => story.key(k)).filter((k): k is string => !!k),
    persist: { doors: 'keep', items: 'keep', enemies: 'keep', puzzles: 'keep', ...info.persist },
    generation: last ? { seed: last.seed, version: last.algorithmVersion, accepted: last.acceptedAt } : null,
    walkthrough: walkStructure(project, level.id).steps.map((s) => s.text),
  };
};

/** Whether an item's parameter says to leave it out of the export. */
export const exportedIds = (set: LevelSet, levelId: string): Set<string> => new Set(set.items.filter((i) => i.levelId === levelId && !i.hidden && paramOf(set, i, 'export') !== false).map((i) => i.id));
