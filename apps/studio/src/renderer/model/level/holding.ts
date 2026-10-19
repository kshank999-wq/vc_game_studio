import { captureOn, escapePuzzleOf } from '../capture';
import { elementsOf } from '../puzzle/elements';
import type { Project } from '../types';
import { assetOf, frameOf } from './geometry';
import { levelsOf, linkItem, placeAsset, resizeItem } from './level';
import type { AssetDefinition, AssetRole, LevelItem } from './types';

/**
 * Where the hero is held once captured, in the levels. What is linked to the
 * holding cell, when anything is (in this map, else the first in another
 * map). When nothing is, each map picks its own spot: a room named like a
 * cell (a jail, a prison, a dungeon…), else the room farthest from the
 * player start, else any other space, so a catch always takes the hero
 * somewhere without the cell being linked by hand.
 */
export interface HoldingSpot {
  item: LevelItem;
  /** Picked by the studio, not linked by the designer. */
  auto: boolean;
}

/** Names that say a place is where the hero is held. */
export const CELL_WORDS = /\b(cells?|jail|gaol|prison|brig|dungeon|holding|lock-?up|stockade|cage|oubliette)\b/i;
const ROOMS: readonly AssetRole[] = ['room'];
const SPACES: readonly AssetRole[] = ['arena', 'corridor', 'zone', 'platform', 'stairwell'];

/** Items linked by hand to the holding cell (none when capture is off). */
export const linkedToCell = (project: Project): LevelItem[] => {
  const cell = project.capture?.cellId;
  if (!captureOn(project) || !cell) return [];
  return levelsOf(project).items.filter((i) => !i.hidden && (i.links ?? []).includes(cell));
};

export const holdingSpot = (project: Project, levelId: string, global?: readonly AssetDefinition[]): HoldingSpot | undefined => {
  if (!captureOn(project) || !project.capture?.cellId) return undefined;
  const linked = linkedToCell(project);
  if (linked.length) return { item: linked.find((i) => i.levelId === levelId) ?? linked[0]!, auto: false };
  const set = levelsOf(project);
  const here = set.items.filter((i) => i.levelId === levelId && !i.hidden);
  const role = (i: LevelItem) => assetOf(set, i, global).role;
  const spaces = here.filter((i) => ROOMS.includes(role(i)) || SPACES.includes(role(i)));
  const named = spaces.find((i) => CELL_WORDS.test(i.name)) ?? here.find((i) => CELL_WORDS.test(i.name) && role(i) !== 'door');
  if (named) return { item: named, auto: true };
  const start = here.find((i) => role(i) === 'playerStart');
  const from = start ? frameOf(set, start, global) : { x: 0, y: 0 };
  const far = (list: LevelItem[]) => {
    let best: LevelItem | undefined;
    let most = -1;
    for (const i of list) {
      const f = frameOf(set, i, global);
      const d = (f.x - from.x) ** 2 + (f.y - from.y) ** 2;
      if (d > most) [best, most] = [i, d];
    }
    return best;
  };
  const pick = far(spaces.filter((i) => ROOMS.includes(role(i)))) ?? far(spaces);
  return pick ? { item: pick, auto: true } : undefined;
};

/** Each map and where the hero is held in it, for the Captured pane. */
export const holdingSpots = (project: Project, global?: readonly AssetDefinition[]): { levelId: string; level: string; spot?: HoldingSpot }[] =>
  captureOn(project) ? levelsOf(project).levels.map((l) => ({ levelId: l.id, level: l.name, spot: holdingSpot(project, l.id, global) })) : [];

// ---------------------------------------------------------------- the cell, built in a level

/** How big a cell is built (metres, square), and the least a room must be to hold one. */
export const CELL_SIZE = 3.5;
const ROOM_FOR_CELL = 5.5;

/** Where the cell is built already: the room holding the escape puzzle's door. */
export const builtCell = (project: Project): LevelItem | undefined => {
  const puzzle = escapePuzzleOf(project);
  if (!puzzle) return undefined;
  const door = elementsOf(project, puzzle.id).find((e) => e.type === 'object' && e.data.elementKind === 'door');
  const set = levelsOf(project);
  const hosted = door && set.items.find((i) => !i.hidden && i.host && (i.links ?? []).includes(door.id));
  return hosted ? set.items.find((i) => i.id === hosted.host!.id) : undefined;
};

/** Why the cell can't be built in this level, or "" when it can. */
export const cellBlocked = (project: Project, levelId: string, global?: readonly AssetDefinition[]): string => {
  if (!escapePuzzleOf(project)) return 'Add an escape puzzle first.';
  if (builtCell(project)) return 'The cell is built already.';
  const spot = holdingSpot(project, levelId, global);
  if (!spot || spot.item.levelId !== levelId) return 'This level has no room to build it in: add a room.';
  const set = levelsOf(project);
  const f = frameOf(set, spot.item, global);
  if (Math.min(f.w, f.d) < ROOM_FOR_CELL) return `${spot.item.name} is too small for a cell: it needs ${ROOM_FOR_CELL} m each way.`;
  // The player must not begin the level locked in.
  const start = set.items.find((i) => i.levelId === levelId && !i.hidden && assetOf(set, i, global).role === 'playerStart');
  const s = start && frameOf(set, start, global);
  if (s && Math.abs(s.x - f.x) <= CELL_SIZE / 2 + 0.5 && Math.abs(s.y - f.y) <= CELL_SIZE / 2 + 0.5) return `The player starts in the middle of ${spot.item.name}, where the cell would go: move the start, or link another room to the holding cell.`;
  return '';
};

/**
 * Build the holding cell in a level, for Play Mode: a small room inside the
 * room the level holds the hero in, linked to the holding cell (so every
 * catch brings the hero here), with a door in its wall that plays the
 * escape puzzle's cell door (locked until the lock is picked), and an
 * interaction point for each of the puzzle's other objects (the loose
 * brick, the scratches). The locker goes outside the cell, where the hero
 * finds their things once out. Returns the project unchanged when it can't
 * be built (see cellBlocked).
 */
export const buildCell = (project: Project, levelId: string, global?: readonly AssetDefinition[]): Project => {
  if (cellBlocked(project, levelId, global)) return project;
  const puzzle = escapePuzzleOf(project)!;
  const spot = holdingSpot(project, levelId, global)!.item;
  const set = levelsOf(project);
  const at = frameOf(set, spot, global);
  const floorId = spot.floorId;
  const half = CELL_SIZE / 2;
  const room = placeAsset(project, levelId, floorId, 'space.room', { x: at.x, y: at.y }, { name: 'Holding cell', ...(global ? { global } : {}) });
  const cellId = room.ids[0];
  if (!cellId) return project;
  let p = resizeItem(room.project, cellId, { w: CELL_SIZE, d: CELL_SIZE }, global);
  p = linkItem(p, cellId, project.capture!.cellId!);
  const objects = elementsOf(p, puzzle.id).filter((e) => e.type === 'object');
  const door = objects.find((e) => e.data.elementKind === 'door');
  if (door) {
    const placed = placeAsset(p, levelId, floorId, 'arch.door', { x: at.x + half, y: at.y }, { name: door.name, ...(global ? { global } : {}) });
    if (placed.ids[0]) p = linkItem(placed.project, placed.ids[0], door.id);
  }
  // The rest inside, along the back wall.
  const rest = objects.filter((e) => e !== door);
  rest.forEach((e, n) => {
    const y = at.y - half + 0.8 + (n * (CELL_SIZE - 1.6)) / Math.max(1, rest.length - 1);
    const placed = placeAsset(p, levelId, floorId, 'logic.interaction', { x: at.x - half + 0.7, y: rest.length === 1 ? at.y : y }, { name: e.name, ...(global ? { global } : {}) });
    if (placed.ids[0]) p = linkItem(placed.project, placed.ids[0], e.id);
  });
  // The locker, outside the cell, if nothing in the levels is it yet.
  const locker = project.capture?.lockerId;
  if (locker && project.objects[locker] && !levelsOf(p).items.some((i) => (i.links ?? []).includes(locker))) {
    const placed = placeAsset(p, levelId, floorId, 'logic.interaction', { x: at.x, y: at.y + half + 0.7 }, { name: project.objects[locker]!.name, ...(global ? { global } : {}) });
    if (placed.ids[0]) p = linkItem(placed.project, placed.ids[0], locker);
  }
  return p;
};
