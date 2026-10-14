import { rng } from '../character/groups';
import type { Project } from '../types';
import { assetOf, contains, corners, frameOf, type Point } from './geometry';
import { boundsOf } from './hierarchy';
import { guid, levelsOf, placeAsset, removeItems, withSet } from './level';
import { floorKindOf, footprintOf, insidePolygon, structureGraph } from './structure';
import { travelPoints } from './travel';
import type { AssetDefinition, Floor, GenerationRun, GeneratorSettings, LayoutRules, Level, LevelItem, LevelSet, ParamValue, StructureType } from './types';

/**
 * The structure generator (structure spec §6): an editable layout proposed
 * inside a structure's footprints from a seed — the whole structure, chosen
 * floors, or one wing or room. Plan-first lays out whole floor plates
 * (corridors, rooms, a stair core lined up through the floors); path-first
 * builds chambers and passages along the route drawn on a floor, with dead
 * ends and secret branches. The same seed, settings and version give the same
 * layout. It never overwrites the designer's work: items placed by hand,
 * locked items and generated items changed since are kept, and anything it
 * can't fit is reported, not left disconnected.
 */

export const GENERATOR_VERSION = 'structure-gen-1';

export const LAYOUT_RULES: readonly { id: LayoutRules; label: string; hint: string }[] = [
  { id: 'linear', label: 'Linear', hint: 'One corridor through each floor, rooms off it.' },
  { id: 'branching', label: 'Branching', hint: 'A main corridor with side corridors off it.' },
  { id: 'hub', label: 'Hub and spoke', hint: 'A central hall with corridors out to the walls.' },
  { id: 'maze', label: 'Maze', hint: 'Rooms opening into rooms, with a few loops.' },
  { id: 'chokepoints', label: 'Chokepoints', hint: 'Survival horror: one way through, single doors, dead ends.' },
  { id: 'puzzleChain', label: 'Puzzle chain', hint: 'Chambers one after another, with clue rooms off the chain.' },
  { id: 'openPlan', label: 'Open plan', hint: 'A few large spaces joined by wide openings.' },
];

/** Good starting settings for a kind of structure. */
export const defaultGenerator = (type: StructureType | undefined): GeneratorSettings => {
  const base: GeneratorSettings = { mode: 'plan', rules: 'branching', roomMin: 4, roomMax: 8, corridor: 2, entrances: 1, chamber: 8, deadEnds: 1, secrets: 1, fill: false, density: 1, cell: 1 };
  switch (type) {
    case 'pyramid':
      return { ...base, mode: 'path', rules: 'puzzleChain', roomMin: 4, roomMax: 9, chamber: 9, deadEnds: 2, secrets: 1 };
    case 'temple':
      return { ...base, rules: 'hub', roomMin: 4, roomMax: 8 };
    case 'fortress':
      return { ...base, rules: 'hub', roomMin: 5, roomMax: 10, entrances: 2 };
    case 'office':
      return { ...base, rules: 'branching', roomMin: 4, roomMax: 7, entrances: 2 };
    case 'apartment':
      return { ...base, rules: 'linear', roomMin: 4, roomMax: 6 };
    case 'industrial':
      return { ...base, rules: 'openPlan', roomMin: 8, roomMax: 16, corridor: 3, entrances: 2 };
    case 'bunker':
      return { ...base, rules: 'chokepoints', roomMin: 3, roomMax: 6 };
    case 'dungeon':
      return { ...base, rules: 'maze', roomMin: 4, roomMax: 7 };
    default:
      return base;
  }
};

const NAMES: Record<StructureType, { room: string[]; corridor: string; hub: string; core: string; entrance: string; final: string; dead: string; secret: string; clue: string; zone: string }> = {
  pyramid: { room: ['Chamber', 'Antechamber', 'Treasury', 'False Tomb', 'Shrine', 'Store'], corridor: 'Passage', hub: 'Great Gallery', core: 'Shaft', entrance: 'Entrance Hall', final: 'Relic Chamber', dead: 'Dead End', secret: 'Hidden Chamber', clue: 'Painted Chamber', zone: 'Summit' },
  temple: { room: ['Chapel', 'Sanctum', 'Vestry', 'Shrine', 'Cloister'], corridor: 'Aisle', hub: 'Nave', core: 'Stair', entrance: 'Narthex', final: 'Inner Sanctum', dead: 'Alcove', secret: 'Hidden Reliquary', clue: 'Scriptorium', zone: 'Roof Terrace' },
  fortress: { room: ['Guard Room', 'Armoury', 'Barracks', 'Store', 'Hall', 'Cell'], corridor: 'Passage', hub: 'Great Hall', core: 'Stair Tower', entrance: 'Gatehouse', final: 'Keep', dead: 'Blind Passage', secret: 'Secret Room', clue: 'Map Room', zone: 'Wall Walk' },
  office: { room: ['Office', 'Meeting Room', 'Open Office', 'Kitchen', 'Store Room', 'Server Room'], corridor: 'Corridor', hub: 'Lobby', core: 'Stair Core', entrance: 'Reception', final: 'Executive Office', dead: 'Store', secret: 'Hidden Office', clue: 'Records', zone: 'Roof Terrace' },
  apartment: { room: ['Apartment', 'Room', 'Suite', 'Laundry', 'Store'], corridor: 'Hallway', hub: 'Lobby', core: 'Stairwell', entrance: 'Lobby', final: 'Penthouse', dead: 'Closet', secret: 'Hidden Room', clue: 'Caretaker', zone: 'Roof Terrace' },
  industrial: { room: ['Workshop', 'Control Room', 'Store', 'Plant Room', 'Loading Bay'], corridor: 'Gangway', hub: 'Shop Floor', core: 'Stairs', entrance: 'Loading Dock', final: 'Control Room', dead: 'Bay', secret: 'Hidden Store', clue: 'Office', zone: 'Roof Deck' },
  bunker: { room: ['Bunk Room', 'Armoury', 'Generator Room', 'Comms', 'Store', 'Med Bay'], corridor: 'Tunnel', hub: 'Command', core: 'Shaft', entrance: 'Blast Door Hall', final: 'Command Room', dead: 'Collapsed Tunnel', secret: 'Sealed Room', clue: 'Records Room', zone: 'Surface' },
  dungeon: { room: ['Chamber', 'Cell', 'Crypt', 'Vault', 'Guard Post', 'Pit'], corridor: 'Passage', hub: 'Hall', core: 'Stairs', entrance: 'Entrance', final: 'Deepest Vault', dead: 'Dead End', secret: 'Secret Vault', clue: 'Carved Chamber', zone: 'Ruin Top' },
  custom: { room: ['Room'], corridor: 'Corridor', hub: 'Hall', core: 'Stairwell', entrance: 'Entrance', final: 'Room', dead: 'Dead End', secret: 'Hidden Room', clue: 'Room', zone: 'Roof Terrace' },
};

// ---------------------------------------------------------------- the grid

interface Rect {
  c: number;
  r: number;
  w: number;
  h: number;
}

interface Grid {
  x0: number;
  y0: number;
  cell: number;
  cols: number;
  rows: number;
  /** 1 where the cell is inside the footprint (and the area). */
  inside: Uint8Array;
  /** 1 where it is taken: by a kept room, or something placed this run. */
  taken: Uint8Array;
}

const at = (g: Grid, c: number, r: number) => r * g.cols + c;
const isFree = (g: Grid, c: number, r: number) => c >= 0 && r >= 0 && c < g.cols && r < g.rows && g.inside[at(g, c, r)] === 1 && g.taken[at(g, c, r)] === 0;
const isInside = (g: Grid, c: number, r: number) => c >= 0 && r >= 0 && c < g.cols && r < g.rows && g.inside[at(g, c, r)] === 1;
const rectFree = (g: Grid, R: Rect) => {
  for (let r = R.r; r < R.r + R.h; r++) for (let c = R.c; c < R.c + R.w; c++) if (!isFree(g, c, r)) return false;
  return true;
};
const mark = (g: Grid, R: Rect) => {
  for (let r = R.r; r < R.r + R.h; r++) for (let c = R.c; c < R.c + R.w; c++) if (c >= 0 && r >= 0 && c < g.cols && r < g.rows) g.taken[at(g, c, r)] = 1;
};
const unmark = (g: Grid, R: Rect) => {
  for (let r = R.r; r < R.r + R.h; r++) for (let c = R.c; c < R.c + R.w; c++) if (c >= 0 && r >= 0 && c < g.cols && r < g.rows) g.taken[at(g, c, r)] = 0;
};
const toPlan = (g: Grid, R: Rect) => ({ x: g.x0 + (R.c + R.w / 2) * g.cell, y: g.y0 + (R.r + R.h / 2) * g.cell, w: R.w * g.cell, d: R.h * g.cell });
const cellOf = (g: Grid, p: Point) => ({ c: Math.floor((p.x - g.x0) / g.cell), r: Math.floor((p.y - g.y0) / g.cell) });

/** The free cells' bounding box. */
const freeBox = (g: Grid): Rect | null => {
  let c0 = Infinity;
  let r0 = Infinity;
  let c1 = -1;
  let r1 = -1;
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++)
      if (isFree(g, c, r)) {
        c0 = Math.min(c0, c);
        r0 = Math.min(r0, r);
        c1 = Math.max(c1, c);
        r1 = Math.max(r1, r);
      }
  return c1 < 0 ? null : { c: c0, r: r0, w: c1 - c0 + 1, h: r1 - r0 + 1 };
};

/** The largest rectangle of free cells inside a region (the histogram method). */
const largestFree = (g: Grid, R: Rect): Rect | null => {
  const heights = new Array<number>(R.w).fill(0);
  let best: Rect | null = null;
  let bestArea = 0;
  for (let r = R.r; r < R.r + R.h; r++) {
    for (let k = 0; k < R.w; k++) heights[k] = isFree(g, R.c + k, r) ? heights[k]! + 1 : 0;
    const stack: number[] = [];
    for (let k = 0; k <= R.w; k++) {
      const h = k < R.w ? heights[k]! : 0;
      while (stack.length && heights[stack[stack.length - 1]!]! >= h) {
        const H = heights[stack.pop()!]!;
        const left = stack.length ? stack[stack.length - 1]! + 1 : 0;
        const area = H * (k - left);
        if (area > bestArea) {
          bestArea = area;
          best = { c: R.c + left, r: r - H + 1, w: k - left, h: H };
        }
      }
      stack.push(k);
    }
  }
  return best;
};

// ---------------------------------------------------------------- the elements of a floor's layout

type Kind = 'room' | 'corridor' | 'core' | 'hub' | 'zone' | 'chamber' | 'kept';

interface Element {
  rect: Rect;
  kind: Kind;
  name: string;
  /** A kept room's item id (it gets doors, it isn't made). */
  keptId?: string;
  /** Path-first: where it is in the route (chambers and passages), for linking along the route only. */
  route?: number;
  secret?: boolean;
}

interface Edge {
  a: number;
  b: number;
  /** The shared wall, in cells: vertical (x = const) or horizontal (y = const), from..to along it. */
  vertical: boolean;
  line: number;
  from: number;
  to: number;
}

/** Where two elements share a wall at least `min` cells long. */
const shared = (A: Rect, B: Rect, min: number): Omit<Edge, 'a' | 'b'> | null => {
  const span = (a0: number, a1: number, b0: number, b1: number) => [Math.max(a0, b0), Math.min(a1, b1)] as const;
  if (A.c + A.w === B.c || B.c + B.w === A.c) {
    const [f, t] = span(A.r, A.r + A.h, B.r, B.r + B.h);
    if (t - f >= min) return { vertical: true, line: A.c + A.w === B.c ? B.c : A.c, from: f, to: t };
  }
  if (A.r + A.h === B.r || B.r + B.h === A.r) {
    const [f, t] = span(A.c, A.c + A.w, B.c, B.c + B.w);
    if (t - f >= min) return { vertical: false, line: A.r + A.h === B.r ? B.r : A.r, from: f, to: t };
  }
  return null;
};

const edgesOf = (els: Element[], min: number): Edge[] => {
  const out: Edge[] = [];
  for (let a = 0; a < els.length; a++)
    for (let b = a + 1; b < els.length; b++) {
      const s = shared(els[a]!.rect, els[b]!.rect, min);
      if (s) out.push({ a, b, ...s });
    }
  return out;
};

/** A walk of free cells in a straight band from (c, r) on: the runs it makes, cut where the band is blocked. */
const bandRuns = (g: Grid, horizontal: boolean, fixed: number, width: number, from: number, to: number, minRun: number): Rect[] => {
  const runs: Rect[] = [];
  let start = -1;
  const ok = (k: number) => {
    for (let w = 0; w < width; w++) if (!(horizontal ? isFree(g, k, fixed + w) : isFree(g, fixed + w, k))) return false;
    return true;
  };
  for (let k = from; k <= to; k++) {
    const good = k < to && ok(k);
    if (good && start < 0) start = k;
    if (!good && start >= 0) {
      if (k - start >= minRun) runs.push(horizontal ? { c: start, r: fixed, w: k - start, h: width } : { c: fixed, r: start, w: width, h: k - start });
      start = -1;
    }
  }
  return runs;
};

/** The run of a band that starts right at `from` (touching what it leaves from), or nothing. */
const bandFrom = (g: Grid, horizontal: boolean, fixed: number, width: number, from: number, step: 1 | -1, limit: number): Rect | null => {
  const ok = (k: number) => {
    for (let w = 0; w < width; w++) if (!(horizontal ? isFree(g, k, fixed + w) : isFree(g, fixed + w, k))) return false;
    return true;
  };
  let k = from;
  let n = 0;
  while (n < limit && ok(k)) {
    k += step;
    n++;
  }
  if (n < width) return null;
  const lo = step > 0 ? from : k + 1;
  return horizontal ? { c: lo, r: fixed, w: n, h: width } : { c: fixed, r: lo, w: width, h: n };
};

/** Rooms in the free cells: split the region (binary space partition), then the largest free rectangle in each part. */
const fillRooms = (g: Grid, region: Rect, rand: () => number, minC: number, maxC: number, kind: Kind, names: () => string, density = 1): Element[] => {
  const out: Element[] = [];
  let free = 0;
  for (let r = region.r; r < region.r + region.h; r++) for (let c = region.c; c < region.c + region.w; c++) if (isFree(g, c, r)) free++;
  const budget = free * Math.max(0.05, Math.min(1, density));
  let used = 0;
  const stack: Rect[] = [region];
  while (stack.length) {
    const R = stack.pop()!;
    const long = R.w >= R.h;
    const len = long ? R.w : R.h;
    if ((R.w > maxC || R.h > maxC) && len >= 2 * minC) {
      const cut = minC + Math.floor(rand() * (len - 2 * minC + 1));
      if (long) stack.push({ ...R, w: cut }, { ...R, c: R.c + cut, w: R.w - cut });
      else stack.push({ ...R, h: cut }, { ...R, r: R.r + cut, h: R.h - cut });
      continue;
    }
    for (let tries = 0; tries < 4; tries++) {
      const best = largestFree(g, R);
      if (!best || best.w < minC || best.h < minC) break;
      if (used >= budget) break;
      const room = { ...best, w: Math.min(best.w, maxC), h: Math.min(best.h, maxC) };
      mark(g, room);
      used += room.w * room.h;
      out.push({ rect: room, kind, name: names() });
    }
  }
  return out;
};

/** Close the gaps the fill leaves: each made room grows into free cells beside it, a strip at a time, up to `limit` cells. */
const growRooms = (g: Grid, els: Element[], limit: number) => {
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const e of els) {
      if (e.kind !== 'room' && e.kind !== 'zone' && e.kind !== 'chamber') continue;
      const R = e.rect;
      const tries: [Rect, Rect][] = [
        [{ c: R.c + R.w, r: R.r, w: 1, h: R.h }, { ...R, w: R.w + 1 }],
        [{ c: R.c - 1, r: R.r, w: 1, h: R.h }, { ...R, c: R.c - 1, w: R.w + 1 }],
        [{ c: R.c, r: R.r + R.h, w: R.w, h: 1 }, { ...R, h: R.h + 1 }],
        [{ c: R.c, r: R.r - 1, w: R.w, h: 1 }, { ...R, r: R.r - 1, h: R.h + 1 }],
      ];
      for (const [strip, bigger] of tries) {
        if (bigger.w > limit || bigger.h > limit || !rectFree(g, strip)) continue;
        mark(g, strip);
        e.rect = bigger;
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
};

// ---------------------------------------------------------------- what is kept, what is replaced

const hashOf = (i: LevelItem): string => {
  const s = JSON.stringify([i.floorId, i.name, i.x, i.y, i.z, i.rotation, i.size, i.outline, i.params, i.host, i.activeWhen, i.rules, i.links, i.puzzles, i.locked, i.hidden]);
  let h = 2166136261;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
  return (h >>> 0).toString(36);
};

const recorded = (level: Level): Map<string, string> => {
  const m = new Map<string, string>();
  for (const run of level.generation ?? []) for (const x of run.items) m.set(x.id, x.hash);
  return m;
};

// ---------------------------------------------------------------- generating

export interface GenerateRequest {
  levelId: string;
  /** The floors to lay out (one, several or all). */
  floorIds: string[];
  /** Keep to this space or volume: a wing, one room. */
  areaId?: string;
  seed: number;
  settings: GeneratorSettings;
}

export interface Proposal {
  /** The project with the layout in, to preview; commit it to accept. */
  project: Project;
  run: GenerationRun;
  made: string[];
  removed: string[];
  kept: { id: string; why: string }[];
  problems: string[];
  counts: { rooms: number; corridors: number; doors: number; connectors: number };
}

interface FloorPlan {
  floor: Floor;
  grid: Grid;
  elements: Element[];
  links: { a: number; b: number; open: boolean; secret?: boolean }[];
  entrances: { el: number; vertical: boolean; line: number; along: number }[];
  core?: Rect;
}

/**
 * Propose a layout (structure spec §6): the project as it would be with it,
 * what it made, what it kept and why, and what it couldn't do. Nothing is
 * committed; the designer accepts, rejects or regenerates.
 */
export const proposeLayout = (project: Project, req: GenerateRequest, global?: readonly AssetDefinition[]): Proposal => {
  const rand = rng(req.seed);
  const s = req.settings;
  const problems: string[] = [];
  const kept: { id: string; why: string }[] = [];
  let set = levelsOf(project);
  const level = set.levels.find((l) => l.id === req.levelId)!;
  const type = level.structure?.type ?? 'custom';
  const N = NAMES[type];
  const nameBag = (list: string[]) => {
    let n = 0;
    return () => list[(n++ + Math.floor(rand() * list.length)) % list.length]!;
  };
  const roomName = nameBag(N.room);
  const sorted = [...level.floors].sort((a, b) => a.elevation - b.elevation);
  const targets = sorted.filter((f) => req.floorIds.includes(f.id));
  const area = req.areaId ? set.items.find((i) => i.id === req.areaId) : undefined;
  const areaPoly = area ? corners(frameOf(set, area, global)) : undefined;
  const cell = Math.max(0.5, s.cell);
  const minC = Math.max(2, Math.round(s.roomMin / cell));
  const maxC = Math.max(minC, Math.round(s.roomMax / cell));
  const cw = Math.max(2, Math.round(s.corridor / cell));
  const doorMin = Math.ceil(1.8 / cell);
  const old = recorded(level);

  // What goes: what an earlier run made, unchanged, not locked, and holding nothing placed by hand.
  const onTargets = set.items.filter((i) => i.levelId === level.id && req.floorIds.includes(i.floorId) && (!areaPoly || (i.id !== area?.id && insidePolygon({ x: i.x, y: i.y }, areaPoly, 0.01))));
  const removable = new Set<string>();
  for (const i of onTargets) {
    if (!i.generated) continue;
    if (i.locked) kept.push({ id: i.id, why: `${i.name} is locked.` });
    else if (old.has(i.id) && old.get(i.id) !== hashOf(i)) kept.push({ id: i.id, why: `${i.name} was changed since it was generated.` });
    else removable.add(i.id);
  }
  // A generated room that holds something placed by hand stays, with its doors.
  for (const i of onTargets) {
    if (!removable.has(i.id) || assetOf(set, i, global).kind !== 'space') continue;
    const f = frameOf(set, i, global);
    const holds = set.items.find((o) => o.levelId === level.id && o.floorId === i.floorId && !o.generated && assetOf(set, o, global).role !== 'footprint' && (o.host?.id === i.id || (assetOf(set, o, global).kind !== 'space' && contains(f, { x: o.x, y: o.y }))));
    if (holds) {
      removable.delete(i.id);
      kept.push({ id: i.id, why: `${i.name} holds ${holds.name}, placed by hand.` });
    }
  }
  if (area?.generated && !area.locked) removable.add(area.id);
  const removed = [...removable];
  // Doors in a removed room go with it (removeItems takes what is hosted).
  set = levelsOf(removeItems(project, removed));
  const lockedIds = set.items.filter((i) => i.levelId === level.id && req.floorIds.includes(i.floorId) && (i.locked || !i.generated) && assetOf(set, i, global).kind === 'space').map((i) => i.id);

  // A grid over each floor's footprint, the area, minus the rooms that stay.
  const grids = new Map<string, Grid>();
  const bounds = boundsOf(set, level, global);
  for (const floor of targets) {
    const fp = footprintOf(set, level, floor.id, global) ?? (bounds ? [{ x: -bounds.w / 2, y: -bounds.d / 2 }, { x: bounds.w / 2, y: -bounds.d / 2 }, { x: bounds.w / 2, y: bounds.d / 2 }, { x: -bounds.w / 2, y: bounds.d / 2 }] : undefined);
    if (!fp) {
      problems.push(`${floor.name} has no footprint and the structure no size: nothing to lay out.`);
      continue;
    }
    const poly = fp;
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    const x0 = Math.floor(Math.min(...xs) / cell) * cell;
    const y0 = Math.floor(Math.min(...ys) / cell) * cell;
    const cols = Math.ceil((Math.max(...xs) - x0) / cell);
    const rows = Math.ceil((Math.max(...ys) - y0) / cell);
    const g: Grid = { x0, y0, cell, cols, rows, inside: new Uint8Array(cols * rows), taken: new Uint8Array(cols * rows) };
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const pts = [
          { x: x0 + c * cell, y: y0 + r * cell },
          { x: x0 + (c + 1) * cell, y: y0 + r * cell },
          { x: x0 + c * cell, y: y0 + (r + 1) * cell },
          { x: x0 + (c + 1) * cell, y: y0 + (r + 1) * cell },
          { x: x0 + (c + 0.5) * cell, y: y0 + (r + 0.5) * cell },
        ];
        if (pts.every((p) => insidePolygon(p, poly, 0.01) && (!areaPoly || insidePolygon(p, areaPoly, 0.01)))) g.inside[at(g, c, r)] = 1;
      }
    for (const i of set.items) {
      if (i.levelId !== level.id || i.floorId !== floor.id || assetOf(set, i, global).kind !== 'space') continue;
      const f = frameOf(set, i, global);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (contains(f, { x: x0 + (c + 0.5) * cell, y: y0 + (r + 0.5) * cell })) g.taken[at(g, c, r)] = 1;
    }
    grids.set(floor.id, g);
  }

  // The stair core (spec §6: connections lined up through the floors): where stairs from a floor not
  // being laid out come up, or where a stairwell already stands, else the middle; the same place on every floor.
  const plans: FloorPlan[] = [];
  const multi = level.floors.length > 1;
  const routes = (floor: Floor) => (set.travel ?? []).filter((t) => t.levelId === level.id && (t.floorId === floor.id || (!t.floorId && level.floors.length === 1)) && (t.kind === 'progression' || t.kind === 'route'));
  // The floors laid out plan-first (path-first lays out only the routes), which share the stair core.
  const planFloors = s.mode === 'plan' ? targets.filter((f) => grids.has(f.id)) : [];
  let core: Rect | null = null;
  const coreW = Math.max(2, Math.round(4 / cell));
  const coreH = Math.max(3, Math.round(6 / cell));
  if (multi && planFloors.length) {
    const anchors: Point[] = [];
    for (const i of set.items) {
      if (i.levelId !== level.id || req.floorIds.includes(i.floorId)) continue;
      const role = assetOf(set, i, global).role;
      if (role === 'stairwell' || role === 'stairs' || role === 'ladder' || role === 'elevator') anchors.push({ x: i.x, y: i.y });
    }
    const g0 = grids.get(planFloors[0]!.id)!;
    const box = freeBox(g0) ?? { c: 0, r: 0, w: g0.cols, h: g0.rows };
    const centre = anchors[0] ? cellOf(g0, anchors[0]) : { c: box.c + Math.floor(box.w / 2), r: box.r + Math.floor(box.h / 2) };
    const fits = (R: Rect) => planFloors.every((f) => {
      const g = grids.get(f.id)!;
      // Every floor's grid is laid on the same origin by its own footprint: compare in plan metres.
      const p = toPlan(g0, R);
      const cc = cellOf(g, { x: p.x - p.w / 2 + cell / 2, y: p.y - p.d / 2 + cell / 2 });
      return rectFree(g, { c: cc.c, r: cc.r, w: R.w, h: R.h });
    });
    for (let ring = 0; ring < Math.max(g0.cols, g0.rows) && !core; ring++)
      for (let dr = -ring; dr <= ring && !core; dr++)
        for (let dc = -ring; dc <= ring && !core; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const R = { c: centre.c - Math.floor(coreW / 2) + dc, r: centre.r - Math.floor(coreH / 2) + dr, w: coreW, h: coreH };
          if (fits(R)) core = R;
        }
    if (!core) problems.push('No place for a stair core on every floor being laid out: the floors are laid out without one.');
    else if (anchors.length && (Math.abs(core.c + core.w / 2 - centre.c) > coreW || Math.abs(core.r + core.h / 2 - centre.r) > coreH)) problems.push('The stair core couldn’t stand over the stairs of the floors kept: check they still meet.');
  }
  const corePlan = core ? toPlan(grids.get(planFloors[0]!.id)!, core) : null;

  for (const floor of targets) {
    const g = grids.get(floor.id);
    if (!g) continue;
    const els: Element[] = [];
    const links: FloorPlan['links'] = [];
    const isRoof = floorKindOf(floor) === 'roof';
    const isGround = floorKindOf(floor) === 'ground' || (floorKindOf(floor) !== 'basement' && floor === sorted.find((f) => floorKindOf(f) !== 'basement'));
    const plan: FloorPlan = { floor, grid: g, elements: els, links, entrances: [] };
    // Kept rooms (axis-aligned) take doors to what is made next to them.
    for (const i of set.items) {
      if (i.levelId !== level.id || i.floorId !== floor.id || assetOf(set, i, global).kind !== 'space' || i.outline || ((i.rotation % 180) + 180) % 180 !== 0) continue;
      const f = frameOf(set, i, global);
      const w = i.rotation % 180 === 0 ? f.w : f.d;
      const d = i.rotation % 180 === 0 ? f.d : f.w;
      const c = Math.round((f.x - w / 2 - g.x0) / cell);
      const r = Math.round((f.y - d / 2 - g.y0) / cell);
      els.push({ rect: { c, r, w: Math.round(w / cell), h: Math.round(d / cell) }, kind: 'kept', name: i.name, keptId: i.id });
    }
    const keptCount = els.length;
    if (corePlan) {
      const cc = cellOf(g, { x: corePlan.x - corePlan.w / 2 + cell / 2, y: corePlan.y - corePlan.d / 2 + cell / 2 });
      const R = { c: cc.c, r: cc.r, w: coreW, h: coreH };
      if (planFloors.includes(floor) && rectFree(g, R)) {
        mark(g, R);
        els.push({ rect: R, kind: 'core', name: N.core });
        plan.core = R;
      }
    }
    const box = freeBox(g);
    if (!box) {
      problems.push(`${floor.name} has no free space left to lay out.`);
      plans.push(plan);
      continue;
    }

    if (isRoof) {
      // The roof: open ground in pieces, round the stair house.
      for (const z of fillRooms(g, box, rand, minC, Math.max(maxC * 2, minC), 'zone', () => N.zone)) els.push(z);
    } else if (s.mode === 'path' && routes(floor).length) {
      layPath(set, g, routes(floor), els, links, s, rand, N, problems, floor, cw, minC, global);
      if (s.fill) for (const e of fillRooms(g, box, rand, minC, maxC, 'room', roomName, s.density)) els.push(e);
    } else if (s.mode === 'path') {
      // Path-first lays out only the floors with a route: a pyramid is mostly solid.
      problems.push(`${floor.name} has no route drawn, so nothing was laid out there. Draw a Progression path on it, or lay it out plan-first.`);
    } else {
      layPlan(g, box, els, s.rules, rand, N, minC, maxC, cw, roomName, plan.core, s.density);
    }
    // Rooms grow into the gaps beside them (a full floor), so they share walls to put doors in.
    const pathFloor = s.mode === 'path' && routes(floor).length > 0;
    if ((s.density >= 1 && (!pathFloor || s.fill)) || isRoof) growRooms(g, els, Math.round(maxC * (isRoof ? 3 : 1.5)));
    plan.entrances = [];
    connect(plan, s.rules, rand, doorMin, problems, keptCount, s.mode === 'path' && routes(floor).length > 0, isRoof);
    if (isGround && !isRoof && !areaPoly) {
      // Path-first: the way in is the route's first chamber, by a passage out to the edge if it is inside.
      if (pathFloor) entranceFromRoute(plan, cw, N.corridor, doorMin, problems);
      else entrancesFor(plan, s.entrances, doorMin, problems);
    }
    plans.push(plan);
  }

  // Build it: rooms first, then the doors in their walls, then what joins the floors.
  let next = withSet(project, set);
  const runId = guid();
  const made: string[] = [];
  const put = (floorId: string, assetId: string, x: number, y: number, name: string, size?: { w?: number; d?: number; h?: number }, params?: Record<string, ParamValue>, extra?: Partial<LevelItem>) => {
    const placed = placeAsset(next, level.id, floorId, assetId, { x, y }, { global, name });
    const id = placed.ids[0];
    if (!id) return '';
    const s2 = levelsOf(placed.project);
    next = withSet(placed.project, {
      ...s2,
      items: s2.items.map((i) => (i.id === id ? { ...i, x, y, generated: runId, ...(size ? { size: { ...i.size, ...size } } : {}), ...(params ? { params: { ...i.params, ...params } } : {}), ...extra } : i)),
    });
    made.push(id);
    return id;
  };
  const counts = { rooms: 0, corridors: 0, doors: 0, connectors: 0 };
  const ids = new Map<string, string>();
  for (const plan of plans) {
    const g = plan.grid;
    const h = plan.floor.height;
    plan.elements.forEach((e, n) => {
      if (e.kind === 'kept') return;
      const p = toPlan(g, e.rect);
      const asset = e.kind === 'corridor' ? 'space.corridor' : e.kind === 'core' ? 'space.stairwell' : e.kind === 'zone' ? 'space.exterior' : 'space.room';
      const id = put(plan.floor.id, asset, p.x, p.y, e.name, { w: p.w, d: p.d, h: e.kind === 'zone' ? 3 : h });
      ids.set(`${plan.floor.id}:${n}`, id);
      if (e.kind === 'corridor') counts.corridors++;
      else counts.rooms++;
    });
  }
  // Doors: mid-way along each shared wall (or an outside wall for an entrance).
  const door = (plan: FloorPlan, vertical: boolean, line: number, along: number, name: string, open: boolean, secret?: boolean, wall = 0) => {
    const g = plan.grid;
    const x = vertical ? g.x0 + line * g.cell : g.x0 + along * g.cell;
    const y = vertical ? g.y0 + along * g.cell : g.y0 + line * g.cell;
    // An opening as wide as its wall allows (to 3 m), leaving 0.4 m each side.
    const wide = open ? Math.max(1.2, Math.min(3, wall * g.cell - 0.8)) : 0;
    const id = put(plan.floor.id, 'arch.door', x, y, name, open ? { w: wide } : undefined, open ? { swing: 'open archway' } : undefined, secret ? { tags: ['secret'] } : undefined);
    if (id) counts.doors++;
  };
  for (const plan of plans) {
    for (const l of plan.links) {
      const A = plan.elements[l.a]!;
      const B = plan.elements[l.b]!;
      const sh = shared(A.rect, B.rect, doorMin);
      if (!sh) continue;
      const mid = (sh.from + sh.to) / 2;
      door(plan, sh.vertical, sh.line, mid, l.secret ? 'Secret door' : l.open ? 'Opening' : 'Door', l.open, l.secret, sh.to - sh.from);
    }
    for (const e of plan.entrances) door(plan, e.vertical, e.line, e.along, 'Way in', false);
  }
  // Between floors: stairs (or a ladder, or a lift) in the core, up to the floor above.
  const s3 = levelsOf(next);
  const style = level.structure?.traversal ?? 'mixed';
  for (let i = 0; i + 1 < sorted.length; i++) {
    const lower = sorted[i]!;
    const upper = sorted[i + 1]!;
    if (!req.floorIds.includes(lower.id) && !req.floorIds.includes(upper.id)) continue;
    const lp = plans.find((p) => p.floor.id === lower.id);
    const up = plans.find((p) => p.floor.id === upper.id);
    const rise = Math.round((upper.elevation - lower.elevation) * 1000) / 1000;
    if (lp?.core) {
      const c = toPlan(lp.grid, lp.core);
      const landing = { x: c.x, y: c.y - 2.3 };
      const above = up?.core || s3.items.some((it) => it.levelId === level.id && it.floorId === upper.id && assetOf(s3, it, global).kind === 'space' && contains(frameOf(s3, it, global), landing));
      if (!above) {
        problems.push(`The stairs from ${lower.name} have no room to come up into on ${upper.name}.`);
        continue;
      }
      if (style === 'ladders') put(lower.id, 'arch.ladder', c.x, c.y - 2.5, `Ladder to ${upper.name}`, { h: rise });
      else put(lower.id, 'arch.stairs', style === 'accessible' ? c.x - 0.9 : c.x, c.y, `Stairs to ${upper.name}`, { w: 1.2, d: Math.min(4, c.d - 1.5), h: rise }, { steps: Math.max(4, Math.round(rise / 0.18)) });
      counts.connectors++;
      continue;
    }
    // Path-first floors meet where a chamber sits over another: a shaft with a ladder.
    const pathOnly = (pl?: FloorPlan) => !!pl && pl.elements.some((e) => e.kind === 'chamber');
    if (lp && up && (pathOnly(lp) || pathOnly(up))) {
      const over = overlapOf(lp, up);
      if (over) {
        put(lower.id, 'arch.ladder', over.x, over.y, `${N.core} to ${upper.name}`, { h: rise });
        counts.connectors++;
      } else if (lp.elements.length && up.elements.length) problems.push(`${lower.name} and ${upper.name} don’t meet: no chamber stands over another, so nothing joins them. Draw their routes so one chamber sits over another.`);
    }
  }
  // Step-free: one lift in the core through every floor that has it.
  if (style === 'accessible') {
    const withCore = plans.filter((p) => p.core).sort((a, b) => a.floor.elevation - b.floor.elevation);
    if (withCore.length > 1) {
      const low = withCore[0]!;
      const c = toPlan(low.grid, low.core!);
      put(low.floor.id, 'arch.elevator', c.x + 1, c.y, 'Lift', { w: 1.6, d: 1.6 }, { travel: Math.round((withCore[withCore.length - 1]!.floor.elevation - low.floor.elevation) * 1000) / 1000 });
      counts.connectors++;
    }
  }

  // Last, nothing the run made may be left where no one can get to it (spec §6): take it out and say so.
  const graph = structureGraph(levelsOf(next), level.id, global);
  if (graph.start) {
    const lost = graph.unreachable.filter((sid) => made.includes(sid));
    if (lost.length) {
      const s4 = levelsOf(next);
      const byFloor = new Map<string, number>();
      for (const sid of lost) {
        const it = s4.items.find((i) => i.id === sid)!;
        byFloor.set(it.floorId, (byFloor.get(it.floorId) ?? 0) + 1);
      }
      const inside = new Set(lost);
      for (const it of s4.items) {
        if (!made.includes(it.id) || inside.has(it.id) || assetOf(s4, it, global).kind === 'space') continue;
        const room = lost.map((sid) => s4.items.find((i) => i.id === sid)!).find((r) => contains(frameOf(s4, r, global), { x: it.x, y: it.y }));
        if (room && room.floorId === it.floorId) inside.add(it.id);
      }
      next = removeItems(next, [...inside]);
      for (let k = made.length - 1; k >= 0; k--) if (inside.has(made[k]!) || !levelsOf(next).items.some((i) => i.id === made[k])) made.splice(k, 1);
      for (const [fid, n] of byFloor) problems.push(`${n} ${n === 1 ? 'space' : 'spaces'} on ${level.floors.find((f) => f.id === fid)!.name} couldn’t be reached from the rest, so ${n === 1 ? 'it was' : 'they were'} left out.`);
      counts.rooms = made.filter((mid) => levelsOf(next).items.find((i) => i.id === mid)?.assetId.startsWith('space.') && !levelsOf(next).items.find((i) => i.id === mid)?.assetId.endsWith('corridor')).length;
      counts.corridors = made.filter((mid) => levelsOf(next).items.find((i) => i.id === mid)?.assetId === 'space.corridor').length;
      counts.doors = made.filter((mid) => levelsOf(next).items.find((i) => i.id === mid)?.assetId === 'arch.door').length;
    }
  }

  // The run, recorded with what it made as it made it.
  const finalSet = levelsOf(next);
  const run: GenerationRun = {
    id: runId,
    seed: req.seed,
    algorithmVersion: GENERATOR_VERSION,
    settings: s,
    floorIds: [...req.floorIds],
    ...(req.areaId ? { areaId: req.areaId } : {}),
    lockedElementIds: [...lockedIds, ...kept.map((k) => k.id)],
    acceptedAt: '',
    items: finalSet.items.filter((i) => i.generated === runId).map((i) => ({ id: i.id, hash: hashOf(i) })),
  };
  return { project: next, run, made, removed, kept, problems, counts };
};

/** Accept a proposal (one undo step): the layout stays, and the run is recorded on the structure. */
export const acceptLayout = (proposal: Proposal, now = new Date().toISOString()): Project => {
  const set = levelsOf(proposal.project);
  const levelId = set.items.find((i) => i.id === proposal.made[0])?.levelId ?? set.levels.find((l) => l.floors.some((f) => proposal.run.floorIds.includes(f.id)))?.id;
  const run = { ...proposal.run, acceptedAt: now };
  return withSet(proposal.project, { ...set, levels: set.levels.map((l) => (l.id === levelId ? { ...l, generation: [...(l.generation ?? []), run].slice(-20) } : l)) });
};

// ---------------------------------------------------------------- plan-first (spec §6)

const layPlan = (g: Grid, box: Rect, els: Element[], rules: LayoutRules, rand: () => number, N: (typeof NAMES)[StructureType], minC: number, maxC: number, cw: number, roomName: () => string, core: Rect | undefined, density: number) => {
  const horizontal = box.w >= box.h;
  const corridor = (R: Rect) => {
    mark(g, R);
    els.push({ rect: R, kind: 'corridor', name: N.corridor });
  };
  if (rules === 'linear' || rules === 'branching') {
    // The spine: along the long way, past the core (or through the middle).
    let fixed: number;
    if (core) fixed = horizontal ? (core.r + core.h + cw <= box.r + box.h ? core.r + core.h : core.r - cw) : core.c + core.w + cw <= box.c + box.w ? core.c + core.w : core.c - cw;
    else fixed = horizontal ? box.r + Math.floor((box.h - cw) / 2) : box.c + Math.floor((box.w - cw) / 2);
    const spine = bandRuns(g, horizontal, fixed, cw, horizontal ? box.c : box.r, (horizontal ? box.c + box.w : box.r + box.h) + 1, cw);
    spine.forEach(corridor);
    if (rules === 'branching') {
      // Side corridors off the spine, both ways, every room-and-a-corridor along it.
      const step = maxC + cw;
      for (const run of spine) {
        const len = horizontal ? run.w : run.h;
        for (let k = Math.floor(step / 2); k + cw <= len; k += step) {
          const at0 = (horizontal ? run.c : run.r) + k;
          for (const dir of [-1, 1] as const) {
            const from = dir < 0 ? (horizontal ? run.r - 1 : run.c - 1) : horizontal ? run.r + run.h : run.c + run.w;
            const b = bandFrom(g, !horizontal, at0, cw, from, dir, 999);
            if (b && (horizontal ? b.h : b.w) >= minC) corridor(b);
          }
        }
      }
    }
  } else if (rules === 'hub') {
    const size = Math.max(minC, Math.min(Math.round(maxC * 1.5), Math.floor(Math.min(box.w, box.h) / 3)));
    let hub: Rect = { c: box.c + Math.floor((box.w - size) / 2), r: box.r + Math.floor((box.h - size) / 2), w: size, h: size };
    if (!rectFree(g, hub)) hub = largestFree(g, { c: box.c + Math.floor(box.w / 4), r: box.r + Math.floor(box.h / 4), w: Math.ceil(box.w / 2), h: Math.ceil(box.h / 2) }) ?? hub;
    if (rectFree(g, hub) && hub.w >= minC && hub.h >= minC) {
      mark(g, hub);
      els.push({ rect: hub, kind: 'hub', name: N.hub });
      const midC = hub.c + Math.floor((hub.w - cw) / 2);
      const midR = hub.r + Math.floor((hub.h - cw) / 2);
      for (const b of [bandFrom(g, true, midR, cw, hub.c + hub.w, 1, 999), bandFrom(g, true, midR, cw, hub.c - 1, -1, 999), bandFrom(g, false, midC, cw, hub.r + hub.h, 1, 999), bandFrom(g, false, midC, cw, hub.r - 1, -1, 999)]) if (b) corridor(b);
    }
  }
  const big = rules === 'openPlan';
  for (const e of fillRooms(g, box, rand, big ? Math.max(minC, Math.round(maxC / 2)) : minC, big ? maxC * 2 : maxC, 'room', roomName, density)) els.push(e);
};

// ---------------------------------------------------------------- path-first (spec §6)

const layPath = (set: LevelSet, g: Grid, routes: NonNullable<LevelSet['travel']>, els: Element[], links: FloorPlan['links'], s: GeneratorSettings, rand: () => number, N: (typeof NAMES)[StructureType], problems: string[], floor: Floor, cw: number, minC: number, global?: readonly AssetDefinition[]) => {
  const size = Math.max(minC, Math.round(s.chamber / g.cell));
  for (const route of routes) {
    const points = travelPoints(set, route, global);
    const chambers: number[] = [];
    points.forEach((p, k) => {
      const c = cellOf(g, p);
      if (!isInside(g, c.c, c.r)) {
        problems.push(`A point of ${route.name || 'the route'} on ${floor.name} is outside the footprint: no chamber there.`);
        return;
      }
      // The chamber: centred on the point, as big as fits.
      let R: Rect | null = null;
      for (let sz = size; sz >= minC && !R; sz--) {
        const T = { c: c.c - Math.floor(sz / 2), r: c.r - Math.floor(sz / 2), w: sz, h: sz };
        if (rectFree(g, T)) R = T;
      }
      if (!R) R = largestFree(g, { c: c.c - size, r: c.r - size, w: size * 2, h: size * 2 });
      if (!R || R.w < 2 || R.h < 2 || !(c.c >= R.c - 1 && c.c <= R.c + R.w && c.r >= R.r - 1 && c.r <= R.r + R.h)) {
        problems.push(`No room for a chamber at point ${k + 1} of ${route.name || 'the route'} on ${floor.name}.`);
        return;
      }
      mark(g, R);
      const name = k === 0 ? N.entrance : k === points.length - 1 ? N.final : `${N.room[0]} ${k}`;
      chambers.push(els.push({ rect: R, kind: 'chamber', name, route: k }) - 1);
    });
    // Passages between chambers, along the route: across, then along (an L), cut where blocked.
    for (let k = 0; k + 1 < chambers.length; k++) {
      const A = els[chambers[k]!]!.rect;
      const B = els[chambers[k + 1]!]!.rect;
      const ay = A.r + Math.floor((A.h - cw) / 2);
      const bx = B.c + Math.floor((B.w - cw) / 2);
      const pieces: number[] = [chambers[k]!];
      const goingRight = bx >= A.c + A.w;
      const goingLeft = bx + cw <= A.c;
      if (goingRight || goingLeft) {
        const end = goingRight ? bx + cw : bx;
        const run = goingRight ? bandFrom(g, true, ay, cw, A.c + A.w, 1, Math.max(0, end - (A.c + A.w))) : bandFrom(g, true, ay, cw, A.c - 1, -1, Math.max(0, A.c - end));
        if (run) {
          mark(g, run);
          pieces.push(els.push({ rect: run, kind: 'corridor', name: N.corridor, route: k }) - 1);
        }
      }
      const last = els[pieces[pieces.length - 1]!]!.rect;
      const down = B.r >= last.r + last.h;
      const fromRow = down ? last.r + last.h : last.r - 1;
      const toRow = down ? B.r : B.r + B.h - 1;
      if (Math.abs(toRow - fromRow) > 0 && !shared(last, B, 2)) {
        const col = pieces.length > 1 ? (goingRight ? last.c + last.w - cw : last.c) : bx;
        const run = bandFrom(g, false, col, cw, fromRow, down ? 1 : -1, Math.abs(toRow - fromRow));
        if (run) {
          mark(g, run);
          pieces.push(els.push({ rect: run, kind: 'corridor', name: N.corridor, route: k }) - 1);
        }
      }
      pieces.push(chambers[k + 1]!);
      for (let p = 0; p + 1 < pieces.length; p++) {
        const a = pieces[p]!;
        const b = pieces[p + 1]!;
        if (shared(els[a]!.rect, els[b]!.rect, 2)) links.push({ a, b, open: els[a]!.kind === 'corridor' && els[b]!.kind === 'corridor' });
        else problems.push(`The passage from ${els[chambers[k]!]!.name} to ${els[chambers[k + 1]!]!.name} on ${floor.name} is blocked part of the way.`);
      }
    }
    // Dead ends and secret branches off chambers along the way.
    const middle = chambers.slice(1, -1).length ? chambers.slice(1, -1) : chambers;
    const branch = (secret: boolean) => {
      for (let tries = 0; tries < 24; tries++) {
        const from = middle[Math.floor(rand() * middle.length)];
        if (from === undefined) return;
        const R = els[from]!.rect;
        const dir = Math.floor(rand() * 4);
        const len = 3 + Math.floor(rand() * 4);
        const horizontal = dir < 2;
        const fixed = horizontal ? R.r + Math.floor((R.h - cw) / 2) : R.c + Math.floor((R.w - cw) / 2);
        const start = dir === 0 ? R.c + R.w : dir === 1 ? R.c - 1 : dir === 2 ? R.r + R.h : R.r - 1;
        const step = dir === 0 || dir === 2 ? 1 : -1;
        const run = bandFrom(g, horizontal, fixed, cw, start, step as 1 | -1, len);
        if (!run || (horizontal ? run.w : run.h) < len) continue;
        mark(g, run);
        const end = horizontal ? (step > 0 ? run.c + run.w : run.c - 4) : step > 0 ? run.r + run.h : run.r - 4;
        const room: Rect = horizontal ? { c: end, r: fixed - 1, w: 4, h: 4 } : { c: fixed - 1, r: end, w: 4, h: 4 };
        if (!rectFree(g, room)) {
          unmark(g, run);
          continue;
        }
        mark(g, room);
        const p = els.push({ rect: run, kind: 'corridor', name: N.corridor }) - 1;
        const q = els.push({ rect: room, kind: 'room', name: secret ? N.secret : N.dead, secret }) - 1;
        links.push({ a: from, b: p, open: false, ...(secret ? { secret: true } : {}) });
        links.push({ a: p, b: q, open: false });
        return;
      }
      problems.push(`No room for ${secret ? 'a secret branch' : 'a dead end'} off the route on ${floor.name}.`);
    };
    for (let n = 0; n < s.deadEnds; n++) branch(false);
    for (let n = 0; n < s.secrets; n++) branch(true);
  }
};

// ---------------------------------------------------------------- doors (spec §6: never disconnected)

const connect = (plan: FloorPlan, rules: LayoutRules, rand: () => number, doorMin: number, problems: string[], keptCount: number, path: boolean, roof: boolean) => {
  const els = plan.elements;
  if (els.length <= keptCount) return;
  const edges = edgesOf(els, doorMin);
  const parent = els.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const join = (a: number, b: number) => (parent[find(a)] = find(b));
  const linked = new Set(plan.links.map((l) => `${Math.min(l.a, l.b)}:${Math.max(l.a, l.b)}`));
  const link = (a: number, b: number, open = false) => {
    const k = `${Math.min(a, b)}:${Math.max(a, b)}`;
    if (linked.has(k)) return;
    linked.add(k);
    plan.links.push({ a, b, open });
    join(a, b);
  };
  for (const l of plan.links) join(l.a, l.b);
  // Open spaces (the roof's zones) join what they touch by being open.
  if (roof) {
    for (const e of edges) if (els[e.a]!.kind === 'zone' || els[e.b]!.kind === 'zone') join(e.a, e.b);
  }
  const corridorish = (i: number) => els[i]!.kind === 'corridor' || els[i]!.kind === 'hub';
  const shuffled = [...edges];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  if (!path && !roof) {
    if (rules === 'linear' || rules === 'branching' || rules === 'hub') {
      for (const e of edges) if (corridorish(e.a) && corridorish(e.b)) link(e.a, e.b, true);
      // Each room opens onto the corridor it shares the longest wall with.
      els.forEach((el, i) => {
        if (corridorish(i) || el.kind === 'kept') return;
        const best = edges.filter((e) => (e.a === i && corridorish(e.b)) || (e.b === i && corridorish(e.a))).sort((x, y) => y.to - y.from - (x.to - x.from))[0];
        if (best) link(best.a, best.b);
      });
    } else if (rules === 'openPlan') {
      for (const e of edges) link(e.a, e.b, true);
    } else if (rules === 'maze') {
      for (const e of shuffled) if (find(e.a) !== find(e.b)) link(e.a, e.b);
      for (const e of shuffled) if (rand() < 0.15) link(e.a, e.b);
    } else {
      // Chokepoints and puzzle chains: a walk from the core (or a corner) through the rooms, one way on.
      const start = els.findIndex((e) => e.kind === 'core') >= 0 ? els.findIndex((e) => e.kind === 'core') : 0;
      const seen = new Set([start]);
      const order = [start];
      const stack = [start];
      while (stack.length) {
        const here = stack[stack.length - 1]!;
        const options = shuffled.filter((e) => (e.a === here && !seen.has(e.b)) || (e.b === here && !seen.has(e.a)));
        if (!options.length) {
          stack.pop();
          continue;
        }
        const e = options[0]!;
        const there = e.a === here ? e.b : e.a;
        seen.add(there);
        order.push(there);
        stack.push(there);
        link(here, there);
      }
      if (rules === 'puzzleChain') {
        let n = 1;
        for (const i of order) if (els[i]!.kind === 'room') els[i]!.name = plan.links.filter((l) => l.a === i || l.b === i).length > 1 ? `Chamber ${n++}` : 'Clue Room';
      }
    }
  }
  // Whatever is still apart joins the rest through any shared wall; what can't be reached is left out.
  const anchor = () => {
    const kept = els.findIndex((e) => e.kind === 'core' || e.kind === 'hub' || e.kind === 'corridor' || e.kind === 'chamber');
    return kept >= 0 ? kept : 0;
  };
  for (let pass = 0; pass < els.length; pass++) {
    let changed = false;
    for (const e of shuffled) {
      if (find(e.a) === find(e.b)) continue;
      if (find(e.a) === find(anchor()) || find(e.b) === find(anchor())) {
        link(e.a, e.b, (rules === 'openPlan' && !path) || (corridorish(e.a) && corridorish(e.b)));
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Kept rooms may be reached from elsewhere: only what this run made has to join up.
  const lost = els.map((e, i) => i).filter((i) => i >= keptCount && find(i) !== find(anchor()) && !(roof && els[i]!.kind === 'zone'));
  if (lost.length && els.length > 1) {
    for (const i of lost) {
      unmark(plan.grid, els[i]!.rect);
      els[i]!.kind = 'kept';
      els[i]!.keptId = '__dropped';
    }
    plan.links = plan.links.filter((l) => !lost.includes(l.a) && !lost.includes(l.b));
    problems.push(`${lost.length} ${lost.length === 1 ? 'room' : 'rooms'} on ${plan.floor.name} couldn’t be joined to the rest, so ${lost.length === 1 ? 'it was' : 'they were'} left out.`);
  }
};

/** The ways in (spec §6 entrances): corridors first, then halls, then rooms, on an outside wall, the south first. */
const entrancesFor = (plan: FloorPlan, count: number, doorMin: number, problems: string[]) => {
  const g = plan.grid;
  const options: { el: number; vertical: boolean; line: number; along: number; rank: number; y: number }[] = [];
  plan.elements.forEach((e, i) => {
    if (e.kind === 'kept' || e.kind === 'zone') return;
    const R = e.rect;
    const rank = e.kind === 'corridor' ? 0 : e.kind === 'hub' || e.kind === 'chamber' ? 1 : e.kind === 'room' ? 2 : 3;
    const sides: { vertical: boolean; line: number; cells: [number, number][] }[] = [
      { vertical: false, line: R.r + R.h, cells: Array.from({ length: R.w }, (_, k) => [R.c + k, R.r + R.h] as [number, number]) },
      { vertical: false, line: R.r, cells: Array.from({ length: R.w }, (_, k) => [R.c + k, R.r - 1] as [number, number]) },
      { vertical: true, line: R.c + R.w, cells: Array.from({ length: R.h }, (_, k) => [R.c + R.w, R.r + k] as [number, number]) },
      { vertical: true, line: R.c, cells: Array.from({ length: R.h }, (_, k) => [R.c - 1, R.r + k] as [number, number]) },
    ];
    for (const side of sides) {
      // The longest run of the side that faces outside.
      let best: [number, number] | null = null;
      let start = -1;
      side.cells.forEach(([c, r], k) => {
        const out = !isInside(g, c, r);
        if (out && start < 0) start = k;
        if ((!out || k === side.cells.length - 1) && start >= 0) {
          const end = out ? k + 1 : k;
          if (!best || end - start > best[1] - best[0]) best = [start, end];
          start = -1;
        }
      });
      if (best && best[1] - best[0] >= doorMin) {
        const along = (side.vertical ? R.r : R.c) + (best[0] + best[1]) / 2;
        options.push({ el: i, vertical: side.vertical, line: side.line, along, rank, y: side.vertical ? along : side.line });
      }
    }
  });
  const used = new Set<number>();
  options.sort((a, b) => a.rank - b.rank || b.y - a.y);
  for (const o of options) {
    if (plan.entrances.length >= count) break;
    if (used.has(o.el)) continue;
    used.add(o.el);
    plan.entrances.push({ el: o.el, vertical: o.vertical, line: o.line, along: o.along });
  }
  if (plan.entrances.length < count && plan.elements.some((e) => e.kind !== 'kept')) problems.push(`Only ${plan.entrances.length} of ${count} ways in fit on an outside wall of ${plan.floor.name}.`);
};

/** Path-first's way in (spec §18): through the route's first chamber; a passage cut out to the nearest outside wall when it doesn't reach one. */
const entranceFromRoute = (plan: FloorPlan, cw: number, passage: string, doorMin: number, problems: string[]) => {
  const first = plan.elements.findIndex((e) => e.kind === 'chamber' && e.route === 0);
  if (first < 0) return;
  const only = { ...plan, entrances: [] as FloorPlan['entrances'], elements: plan.elements.map((e, i) => (i === first ? e : { ...e, kind: 'kept' as const })) };
  entrancesFor(only, 1, doorMin, []);
  if (only.entrances.length) {
    plan.entrances.push(...only.entrances);
    return;
  }
  const g = plan.grid;
  const R = plan.elements[first]!.rect;
  const options = [
    bandFrom(g, false, R.c + Math.floor((R.w - cw) / 2), cw, R.r + R.h, 1, 999),
    bandFrom(g, false, R.c + Math.floor((R.w - cw) / 2), cw, R.r - 1, -1, 999),
    bandFrom(g, true, R.r + Math.floor((R.h - cw) / 2), cw, R.c + R.w, 1, 999),
    bandFrom(g, true, R.r + Math.floor((R.h - cw) / 2), cw, R.c - 1, -1, 999),
  ]
    .filter((b): b is Rect => !!b)
    // Only a passage that ends at the footprint's edge (not at another room) leads out.
    .filter((b) => {
      const beyond = b.h > b.w ? (b.r + b.h < g.rows && b.r > R.r ? { c: b.c, r: b.r + b.h } : { c: b.c, r: b.r - 1 }) : b.c > R.c ? { c: b.c + b.w, r: b.r } : { c: b.c - 1, r: b.r };
      return !isInside(g, beyond.c, beyond.r);
    })
    .sort((a, b) => a.w * a.h - b.w * b.h);
  const way = options[0];
  if (!way) {
    problems.push(`No way out to an outside wall from ${plan.elements[first]!.name} on ${plan.floor.name}: put its way in by hand.`);
    return;
  }
  mark(g, way);
  const p = plan.elements.push({ rect: way, kind: 'corridor', name: passage, route: -1 }) - 1;
  plan.links.push({ a: first, b: p, open: false });
  const only2 = { ...plan, entrances: [] as FloorPlan['entrances'], elements: plan.elements.map((e, i) => (i === p ? e : { ...e, kind: 'kept' as const })) };
  entrancesFor(only2, 1, doorMin, []);
  plan.entrances.push(...only2.entrances);
};

/** Where a made element of one floor stands over one of the next: the middle of their overlap, in plan metres. */
const overlapOf = (a: FloorPlan, b: FloorPlan): Point | null => {
  for (const ea of a.elements) {
    if (ea.kind === 'kept' || ea.kind === 'corridor') continue;
    const pa = toPlan(a.grid, ea.rect);
    for (const eb of b.elements) {
      if (eb.kind === 'kept' || eb.kind === 'corridor') continue;
      const pb = toPlan(b.grid, eb.rect);
      const x0 = Math.max(pa.x - pa.w / 2, pb.x - pb.w / 2);
      const x1 = Math.min(pa.x + pa.w / 2, pb.x + pb.w / 2);
      const y0 = Math.max(pa.y - pa.d / 2, pb.y - pb.d / 2);
      const y1 = Math.min(pa.y + pa.d / 2, pb.y + pb.d / 2);
      if (x1 - x0 >= 1.2 && y1 - y0 >= 1.2) return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    }
  }
  return null;
};
