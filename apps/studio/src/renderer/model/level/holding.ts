import { captureOn } from '../capture';
import type { Project } from '../types';
import { assetOf, frameOf } from './geometry';
import { levelsOf } from './level';
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
