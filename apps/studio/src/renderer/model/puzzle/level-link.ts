import { assetOf, contains, frameOf } from '../level/geometry';
import { pathTo } from '../level/hierarchy';
import { levelsOf, linkItem } from '../level/level';
import { bindToPuzzle, partsOfItem } from '../level/puzzles';
import type { AssetDefinition, Level, LevelItem } from '../level/types';
import type { Project } from '../types';
import { createPuzzle, nodesOf, updateDefinition } from './design';
import { addElement, conditionFor, elementsOf, itemsFor, stepFromElement, type ElementKind } from './elements';

/**
 * The Puzzle Creator and the Level Designer together (puzzle spec §12): a
 * puzzle made from a level item, where a puzzle is in the levels (its
 * breadcrumbs), and which items stand for a step. The logic stays in the
 * puzzle; level items only point at it.
 */

/** What kind of element an item most likely is, by its role and its name. */
const kindFor = (role: string, name: string): ElementKind => {
  const n = name.toLowerCase();
  if (role === 'door' || /door|gate|hatch/.test(n)) return 'door';
  if (/safe|chest|box|cabinet|drawer|locker|crate/.test(n)) return 'container';
  if (/lever/.test(n)) return 'lever';
  if (/switch|panel|breaker/.test(n)) return 'switch';
  if (/dial/.test(n)) return 'dial';
  if (/plate/.test(n)) return 'plate';
  if (/lock/.test(n)) return 'lock';
  if (/generator|battery|fuse/.test(n)) return 'power';
  if (/socket|altar|pedestal|slot/.test(n)) return 'socket';
  return 'custom';
};

/**
 * A new puzzle from a level item (§12): a room or area is where it is
 * played (an area puzzle, the room its entry); anything else — a door, a
 * safe, a terminal, an altar, a machine — is what it is about (an object
 * puzzle): its story element (the one it already stands for, or a new one
 * made for it) becomes the puzzle's first element and its first step.
 */
export const puzzleFromItem = (project: Project, itemId: string, global?: readonly AssetDefinition[]): { project: Project; puzzleId: string } => {
  const set = levelsOf(project);
  const item = set.items.find((i) => i.id === itemId);
  if (!item) return { project, puzzleId: '' };
  const def = assetOf(set, item, global);
  const room = def.kind === 'space' || (def.kind === 'volume' && def.role === 'zone');
  const made = createPuzzle(project, `${item.name} puzzle`, room ? 'area' : 'object');
  let p = updateDefinition(made.project, made.id, { objective: room ? `Get through ${item.name}` : `Work the ${item.name}` });
  if (room) {
    p = linkItem(p, itemId, made.id);
    p = bindToPuzzle(p, itemId, { puzzle: made.id, role: 'entry' }, global);
    return { project: p, puzzleId: made.id };
  }
  // The element it stands for, or one made for it and linked.
  let elementId = (item.links ?? []).find((l) => ['object', 'inventory'].includes(p.objects[l]?.type ?? ''));
  if (!elementId) {
    const added = addElement(p, made.id, kindFor(def.role, item.name), item.name);
    p = linkItem(added.project, itemId, added.elementId);
    elementId = added.elementId;
  }
  if (conditionFor(p, elementId)) p = stepFromElement(p, made.id, elementId).project;
  return { project: p, puzzleId: made.id };
};

/** Items that stand for a step: bound to its element, linked to it, or its pickup. */
export const itemsForStep = (project: Project, puzzleId: string, nodeId: string): LevelItem[] => {
  const node = nodesOf(project.objects[puzzleId]).find((n) => n.id === nodeId);
  const ref = node?.when?.ref;
  if (!ref) return [];
  const bound = levelsOf(project).items.filter((i) => (i.puzzles ?? []).some((b) => b.puzzle === puzzleId && b.node === ref));
  return [...new Set([...bound, ...itemsFor(project, ref)])];
};

export interface PuzzlePlace {
  /** The maps from the top down to the one it is on. */
  maps: Level[];
  /** The room or area it is in, if any. */
  room?: LevelItem;
  item: LevelItem;
}

/**
 * Where a puzzle is (§14's breadcrumbs: Project › World › Level › Room ›
 * Puzzle): its entry if it has one, else the first item that is a part of it
 * or stands for one of its elements; the maps down to it, and the room it is in.
 */
export const placeOf = (project: Project, puzzleId: string, global?: readonly AssetDefinition[]): PuzzlePlace | undefined => {
  const set = levelsOf(project);
  const elements = new Set(elementsOf(project, puzzleId).map((e) => e.id));
  const parts = set.items.map((i) => ({ i, roles: partsOfItem(project, puzzleId, i, global).map((r) => r.role) })).filter((x) => x.roles.length || (x.i.links ?? []).some((l) => elements.has(l)));
  const pick = parts.find((x) => x.roles.includes('entry')) ?? parts[0];
  if (!pick) return undefined;
  const item = pick.i;
  const def = assetOf(set, item, global);
  const isRoom = def.kind === 'space';
  const at = frameOf(set, item, global);
  const room = isRoom
    ? item
    : set.items.find((s) => s.levelId === item.levelId && s.floorId === item.floorId && s.id !== item.id && assetOf(set, s, global).kind === 'space' && contains(frameOf(set, s, global), { x: at.x, y: at.y }));
  return { maps: pathTo(set, item.levelId), ...(room ? { room } : {}), item };
};
