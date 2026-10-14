import { rng } from '../character/groups';
import type { Project } from '../types';
import { assetOf, contains, frameOf, toPlan, type Point } from './geometry';
import { levelsOf, placeAsset, removeItems, withSet } from './level';
import { findAsset } from './library';
import type { AssetDefinition, LevelItem, ParamValue, StructureType, ThemeId } from './types';

/**
 * Procedural themes (structure spec V2, advanced procedural themes): what a
 * layout is dressed as. A theme decides each room's furniture by what the
 * room is for (a desk and a chair in an office, a sarcophagus in a crypt,
 * racks in a server room), its lights (torches on the walls, or lamps in the
 * ceiling), what its walls are made of, how far it has fallen to ruin
 * (rubble, barricades, broken-through walls) and how many traps it hides.
 * Dressing uses its own random stream from the seed, so changing the theme
 * never moves a wall; the same seed and theme dress a layout the same way.
 */

export type { ThemeId };

/** One kind of thing to put in a room: how many, and where (along a wall, in the middle, in a corner). */
export interface DressRule {
  asset: string;
  min: number;
  max: number;
  place: 'wall' | 'centre' | 'corner' | 'anywhere';
  name?: string;
}

export interface Theme {
  id: ThemeId;
  label: string;
  hint: string;
  /** What room walls are made of (the proxy material). */
  material: string;
  /** Its lights: what they are, their colour and strength, on the walls (torches) or overhead. */
  light: { asset: string; color: string; intensity: number; place: 'wall' | 'ceiling'; flicker: boolean } | null;
  /** Furniture by what the room is for: matched against its name (any word), then its kind. */
  byName: { words: string[]; dress: DressRule[] }[];
  byKind: Partial<Record<'room' | 'corridor' | 'stairwell' | 'zone', DressRule[]>>;
  /** How ruined it starts (0 to 1), and how trapped. */
  decay: number;
  traps: number;
}

const R = (asset: string, min: number, max: number, place: DressRule['place'], name?: string): DressRule => ({ asset, min, max, place, ...(name ? { name } : {}) });

export const THEMES: readonly Theme[] = [
  { id: 'none', label: 'None', hint: 'Bare rooms, as laid out.', material: 'neutral', light: null, byName: [], byKind: {}, decay: 0, traps: 0 },
  {
    id: 'ancient',
    label: 'Ancient tomb / temple',
    hint: 'Stone, torchlight, sarcophagi, urns and altars; traps in the passages.',
    material: 'stone',
    light: { asset: 'light.emissive', color: '#ffb35a', intensity: 1.4, place: 'wall', flicker: true },
    byName: [
      { words: ['tomb', 'crypt', 'burial', 'relic'], dress: [R('prop.sarcophagus', 1, 1, 'centre'), R('prop.urn', 1, 3, 'corner')] },
      { words: ['shrine', 'sanctum', 'chapel', 'altar', 'nave'], dress: [R('prop.altar', 1, 1, 'wall'), R('prop.statue', 1, 2, 'corner')] },
      { words: ['treasury', 'vault', 'store'], dress: [R('play.chest', 1, 1, 'wall'), R('prop.urn', 2, 4, 'wall')] },
      { words: ['painted', 'carved', 'scriptorium'], dress: [R('prop.statue', 1, 1, 'wall'), R('logic.clue', 1, 1, 'wall', 'Inscription')] },
    ],
    byKind: { room: [R('prop.urn', 0, 2, 'corner')], corridor: [], zone: [R('prop.statue', 0, 1, 'anywhere')] },
    decay: 0.15,
    traps: 0.25,
  },
  {
    id: 'gothic',
    label: 'Gothic castle',
    hint: 'Stone and timber, torches, long tables, armouries and cells.',
    material: 'stone',
    light: { asset: 'light.emissive', color: '#ffa84a', intensity: 1.2, place: 'wall', flicker: true },
    byName: [
      { words: ['hall', 'keep'], dress: [R('prop.table', 1, 2, 'centre'), R('prop.chair', 2, 6, 'anywhere')] },
      { words: ['armoury'], dress: [R('prop.shelf', 2, 3, 'wall'), R('play.weapon', 1, 1, 'wall')] },
      { words: ['barracks', 'bunk'], dress: [R('prop.bed', 2, 4, 'wall')] },
      { words: ['cell'], dress: [R('prop.bed', 1, 1, 'wall'), R('prop.barrel', 0, 1, 'corner')] },
      { words: ['store'], dress: [R('prop.crate', 2, 4, 'corner'), R('prop.barrel', 1, 3, 'corner')] },
      { words: ['map', 'study'], dress: [R('prop.table', 1, 1, 'centre'), R('prop.shelf', 1, 2, 'wall')] },
    ],
    byKind: { room: [R('prop.barrel', 0, 1, 'corner')], corridor: [] },
    decay: 0.05,
    traps: 0,
  },
  {
    id: 'modern',
    label: 'Modern office',
    hint: 'Desks and chairs, meeting tables, server racks, ceiling lights.',
    material: 'neutral',
    light: { asset: 'light.practical', color: '#f4f6ff', intensity: 1.2, place: 'ceiling', flicker: false },
    byName: [
      { words: ['meeting', 'conference'], dress: [R('prop.table', 1, 1, 'centre'), R('prop.chair', 4, 8, 'anywhere')] },
      { words: ['open'], dress: [R('prop.desk', 4, 8, 'anywhere'), R('prop.chair', 4, 8, 'anywhere')] },
      { words: ['office', 'executive'], dress: [R('prop.desk', 1, 2, 'wall'), R('prop.chair', 1, 2, 'anywhere'), R('prop.cabinet', 1, 1, 'corner')] },
      { words: ['kitchen'], dress: [R('prop.table', 1, 1, 'centre'), R('prop.cabinet', 2, 3, 'wall')] },
      { words: ['server'], dress: [R('prop.shelf', 3, 6, 'wall', 'Server rack'), R('prop.console', 1, 1, 'wall')] },
      { words: ['reception', 'lobby'], dress: [R('prop.console', 1, 1, 'centre', 'Reception desk'), R('prop.chair', 2, 4, 'wall')] },
      { words: ['store', 'records'], dress: [R('prop.shelf', 2, 4, 'wall'), R('prop.cabinet', 1, 2, 'corner')] },
    ],
    byKind: { room: [R('prop.desk', 0, 1, 'wall')], corridor: [] },
    decay: 0,
    traps: 0,
  },
  {
    id: 'residential',
    label: 'Residential',
    hint: 'Beds, tables, shelves and lamps: flats, hotels, houses.',
    material: 'wood',
    light: { asset: 'light.practical', color: '#ffe2b0', intensity: 1, place: 'ceiling', flicker: false },
    byName: [
      { words: ['apartment', 'suite', 'penthouse', 'room'], dress: [R('prop.bed', 1, 1, 'wall'), R('prop.table', 0, 1, 'centre'), R('prop.chair', 1, 2, 'anywhere'), R('prop.shelf', 0, 1, 'wall')] },
      { words: ['laundry'], dress: [R('prop.cabinet', 2, 3, 'wall')] },
      { words: ['closet', 'store', 'caretaker'], dress: [R('prop.shelf', 1, 2, 'wall'), R('prop.crate', 0, 2, 'corner')] },
      { words: ['lobby'], dress: [R('prop.console', 1, 1, 'wall', 'Front desk'), R('prop.chair', 1, 3, 'wall')] },
    ],
    byKind: { room: [R('prop.chair', 0, 1, 'anywhere')], corridor: [] },
    decay: 0,
    traps: 0,
  },
  {
    id: 'industrial',
    label: 'Industrial',
    hint: 'Metal, machines, pipe runs, crates and barrels; harsh lamps.',
    material: 'metal',
    light: { asset: 'light.point', color: '#d8e4ff', intensity: 1.6, place: 'ceiling', flicker: false },
    byName: [
      { words: ['workshop', 'plant', 'shop', 'generator'], dress: [R('prop.machine', 1, 3, 'anywhere'), R('prop.pipe', 1, 2, 'wall')] },
      { words: ['control', 'comms', 'command'], dress: [R('prop.console', 2, 4, 'wall'), R('prop.chair', 1, 3, 'anywhere')] },
      { words: ['store', 'loading', 'bay', 'dock'], dress: [R('prop.crate', 3, 6, 'anywhere'), R('prop.barrel', 2, 4, 'corner')] },
      { words: ['armoury'], dress: [R('prop.shelf', 2, 3, 'wall'), R('play.ammo', 1, 2, 'wall')] },
      { words: ['bunk', 'barracks'], dress: [R('prop.bed', 2, 4, 'wall')] },
      { words: ['med'], dress: [R('prop.bed', 1, 2, 'wall'), R('play.health', 1, 1, 'wall', 'Medkit')] },
    ],
    byKind: { room: [R('prop.crate', 0, 2, 'corner')], corridor: [R('prop.pipe', 0, 1, 'wall')] },
    decay: 0.05,
    traps: 0,
  },
  {
    id: 'scifi',
    label: 'Sci-fi facility',
    hint: 'Glass and metal, consoles and machines, cold light, sealed doors.',
    material: 'metal',
    light: { asset: 'light.point', color: '#9fd8ff', intensity: 1.4, place: 'ceiling', flicker: false },
    byName: [
      { words: ['command', 'control', 'comms'], dress: [R('prop.console', 3, 5, 'wall'), R('prop.chair', 2, 4, 'anywhere')] },
      { words: ['generator', 'plant', 'reactor'], dress: [R('prop.machine', 1, 2, 'centre'), R('prop.pipe', 2, 3, 'wall')] },
      { words: ['med', 'lab'], dress: [R('prop.bed', 1, 2, 'wall'), R('prop.console', 1, 1, 'wall'), R('play.health', 0, 1, 'wall', 'Medkit')] },
      { words: ['bunk', 'quarters'], dress: [R('prop.bed', 2, 4, 'wall'), R('prop.cabinet', 1, 2, 'wall')] },
      { words: ['armoury'], dress: [R('prop.shelf', 2, 3, 'wall'), R('play.weapon', 1, 1, 'wall')] },
      { words: ['store', 'records'], dress: [R('prop.crate', 2, 4, 'anywhere')] },
    ],
    byKind: { room: [R('prop.console', 0, 1, 'wall')], corridor: [] },
    decay: 0,
    traps: 0.05,
  },
  {
    id: 'ruin',
    label: 'Ruin / dungeon',
    hint: 'Broken stone: rubble in the way, barricades, holes knocked through, traps and torches.',
    material: 'stone',
    light: { asset: 'light.emissive', color: '#ff9a40', intensity: 1, place: 'wall', flicker: true },
    byName: [
      { words: ['crypt', 'vault', 'tomb'], dress: [R('prop.sarcophagus', 1, 2, 'wall'), R('play.chest', 0, 1, 'corner')] },
      { words: ['cell', 'pit'], dress: [R('prop.barrel', 0, 1, 'corner'), R('arch.rubble', 0, 1, 'corner')] },
      { words: ['guard'], dress: [R('prop.table', 1, 1, 'centre'), R('prop.chair', 1, 2, 'anywhere'), R('prop.barrel', 1, 2, 'corner')] },
      { words: ['carved', 'chamber'], dress: [R('prop.statue', 0, 1, 'corner'), R('prop.urn', 1, 2, 'corner')] },
    ],
    byKind: { room: [R('prop.urn', 0, 2, 'corner')], corridor: [] },
    decay: 0.35,
    traps: 0.3,
  },
];

export const themeOf = (id: ThemeId | undefined): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0]!;

/** A theme to start from for a kind of structure. */
export const defaultTheme = (type: StructureType | undefined): ThemeId => {
  switch (type) {
    case 'pyramid':
    case 'temple':
      return 'ancient';
    case 'fortress':
      return 'gothic';
    case 'office':
      return 'modern';
    case 'apartment':
      return 'residential';
    case 'industrial':
    case 'bunker':
      return 'industrial';
    case 'dungeon':
      return 'ruin';
    default:
      return 'none';
  }
};

/** Dressing items carry this tag: dressing again replaces what the last dressing made, nothing else. */
export const DRESSING = 'dressing';

export interface DressOptions {
  theme: ThemeId;
  seed: number;
  /** How ruined (0 to 1) and how trapped; the theme's own when absent. */
  decay?: number;
  traps?: number;
  global?: readonly AssetDefinition[];
}

export interface Dressed {
  project: Project;
  /** What it put in, by GUID. */
  made: string[];
  counts: { props: number; lights: number; traps: number; ruin: number };
}

/**
 * Dress rooms in a theme: furniture by what each room is for, lights, the
 * walls' material, and as much ruin and as many traps as asked. Nothing is
 * put in a doorway, on stairs or on top of something else. What it makes is
 * tagged as dressing and marked with the run, so it can be replaced.
 */
export const dressRooms = (project: Project, roomIds: readonly string[], opts: DressOptions, mark: (item: LevelItem) => LevelItem = (i) => i): Dressed => {
  const theme = themeOf(opts.theme);
  const counts = { props: 0, lights: 0, traps: 0, ruin: 0 };
  const made: string[] = [];
  if (theme.id === 'none') return { project, made, counts };
  // Its own stream: the layout's random numbers aren't touched.
  const rand = rng((opts.seed * 7919 + 104729) >>> 0);
  const decay = Math.max(0, Math.min(1, opts.decay ?? theme.decay));
  const traps = Math.max(0, Math.min(1, opts.traps ?? theme.traps));
  let p = project;
  const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  for (const roomId of roomIds) {
    const set = levelsOf(p);
    const room = set.items.find((i) => i.id === roomId);
    if (!room) continue;
    const def = assetOf(set, room, opts.global);
    if (def.kind !== 'space') continue;
    const f = frameOf(set, room, opts.global);
    // Walls of the theme's material.
    if (theme.material !== 'neutral' && room.params?.material === undefined) {
      p = withSet(p, { ...set, items: set.items.map((i) => (i.id === room.id ? { ...i, params: { ...i.params, material: theme.material } } : i)) });
    }
    // Keep out: doorways, stairs, lifts and ladders, and what is already in the room.
    const keepOut: { x: number; y: number; r: number }[] = [];
    for (const i of levelsOf(p).items) {
      if (i.levelId !== room.levelId || i.floorId !== room.floorId || i.id === room.id) continue;
      const r = assetOf(levelsOf(p), i, opts.global).role;
      const fi = frameOf(levelsOf(p), i, opts.global);
      if (i.host?.id === room.id || r === 'door') {
        if (Math.hypot(fi.x - f.x, fi.y - f.y) < Math.hypot(f.w, f.d)) keepOut.push({ x: fi.x, y: fi.y, r: Math.max(1.6, fi.w / 2 + 1) });
      } else if (contains(f, { x: fi.x, y: fi.y }) && assetOf(levelsOf(p), i, opts.global).kind !== 'volume') keepOut.push({ x: fi.x, y: fi.y, r: Math.max(fi.w, fi.d) / 2 + (r === 'stairs' || r === 'elevator' || r === 'ladder' ? 1.2 : 0.3) });
    }
    const put = (assetId: string, at: Point, name: string, rotation: number, z: number, params?: Record<string, ParamValue>, size?: { w: number; d: number }) => {
      const placed = placeAsset(p, room.levelId, room.floorId, assetId, at, { name, rotation, global: opts.global });
      const id = placed.ids[0];
      if (!id) return '';
      const s2 = levelsOf(placed.project);
      p = withSet(placed.project, { ...s2, items: s2.items.map((i) => (i.id === id ? mark({ ...i, x: at.x, y: at.y, z, tags: [...(i.tags ?? []), DRESSING], ...(params ? { params: { ...i.params, ...params } } : {}), ...(size ? { size: { ...i.size, ...size } } : {}) }) : i)) });
      made.push(id);
      return id;
    };
    /** A spot for something this big, by its kind of place, clear of the doorways and of what is there. */
    const spot = (w: number, d: number, place: DressRule['place']): { at: Point; rotation: number; w: number; d: number } | null => {
      const hw = f.w / 2 - 0.35;
      const hd = f.d / 2 - 0.35;
      if (hw <= w / 2 || hd <= d / 2) return null;
      for (let tries = 0; tries < 16; tries++) {
        let lx: number;
        let ly: number;
        let rot = 0;
        if (place === 'wall') {
          const side = Math.floor(rand() * 4);
          if (side < 2) {
            lx = (rand() * 2 - 1) * (hw - w / 2);
            ly = side === 0 ? -hd + d / 2 : hd - d / 2;
            rot = side === 0 ? 180 : 0;
          } else {
            lx = side === 2 ? -hw + d / 2 : hw - d / 2;
            ly = (rand() * 2 - 1) * (hd - w / 2);
            rot = side === 2 ? 90 : 270;
          }
        } else if (place === 'corner') {
          lx = (rand() < 0.5 ? -1 : 1) * (hw - w / 2);
          ly = (rand() < 0.5 ? -1 : 1) * (hd - d / 2);
        } else if (place === 'centre') {
          lx = (rand() * 2 - 1) * Math.min(0.6, hw - w / 2);
          ly = (rand() * 2 - 1) * Math.min(0.6, hd - d / 2);
        } else {
          lx = (rand() * 2 - 1) * (hw - w / 2);
          ly = (rand() * 2 - 1) * (hd - d / 2);
        }
        const at = toPlan(f, lx, ly);
        const r = Math.max(w, d) / 2;
        if (keepOut.some((k) => Math.hypot(k.x - at.x, k.y - at.y) < k.r + r)) continue;
        if (f.outline && !contains(f, at)) continue;
        keepOut.push({ x: at.x, y: at.y, r: r + 0.15 });
        return { at, rotation: (f.rotation + rot) % 360, w, d };
      }
      return null;
    };
    const assetSize = (assetId: string) => {
      const a = findAsset(assetId, levelsOf(p).assets, opts.global);
      return a ? { w: a.size.w, d: a.size.d } : { w: 0.6, d: 0.6 };
    };
    const kind = def.role === 'corridor' ? 'corridor' : def.role === 'stairwell' ? 'stairwell' : def.role === 'zone' ? 'zone' : 'room';
    /** A spot, or failing that a smaller one anywhere: ruin and traps matter more than where exactly they go. */
    const fit = (w: number, d: number, place: DressRule['place']) => spot(w, d, place) ?? spot(w * 0.7, d * 0.7, 'anywhere') ?? spot(w * 0.5, d * 0.5, 'anywhere');
    // Ruin and traps first (they are gameplay; the furniture isn't): rubble in a room, a barricade across a passage.
    if (decay > 0 && rand() < decay) {
      const piece = kind === 'corridor' ? 'arch.barricade' : 'arch.rubble';
      const size = assetSize(piece);
      const at = fit(Math.min(size.w, f.w * 0.5), Math.min(size.d, f.d * 0.5), kind === 'corridor' ? 'centre' : 'anywhere');
      if (at && put(piece, at.at, piece === 'arch.barricade' ? 'Barricade' : 'Rubble', at.rotation, 0, undefined, { w: at.w, d: at.d })) counts.ruin++;
    }
    // Traps: in passages and chambers.
    if (traps > 0 && (kind === 'corridor' || kind === 'room') && rand() < traps) {
      const at = fit(Math.min(2, f.w - 1), Math.min(2, f.d - 1), 'centre');
      if (at && put('play.trap', at.at, kind === 'corridor' ? 'Dart trap' : 'Spike trap', at.rotation, 0, { cycle: 2 + Math.floor(rand() * 3), activeFor: 1 }, { w: at.w, d: at.d })) counts.traps++;
    }
    // Furniture by what the room is for.
    const words = room.name.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    const named = theme.byName.find((b) => b.words.some((w) => words.includes(w) || room.name.toLowerCase().includes(w)));
    const rules = named?.dress ?? theme.byKind[kind] ?? [];
    // A big room takes more: up to its area's worth.
    const scale = Math.max(1, Math.min(3, (f.w * f.d) / 30));
    for (const rule of rules) {
      const n = Math.round(between(rule.min, rule.max) * (rule.place === 'anywhere' ? scale : 1));
      for (let k = 0; k < n; k++) {
        const size = assetSize(rule.asset);
        const at = spot(size.w, size.d, rule.place);
        if (!at) break;
        const id = put(rule.asset, at.at, rule.name ?? '', at.rotation, 0);
        if (id) counts.props++;
      }
    }
    // Lights: torches on the walls, or lamps overhead, one for every 40 m² or so.
    if (theme.light && kind !== 'zone') {
      const n = Math.max(1, Math.min(4, Math.round((f.w * f.d) / 40)));
      for (let k = 0; k < n; k++) {
        const h = f.h;
        const at = theme.light.place === 'wall' ? spot(0.3, 0.3, 'wall') : { at: toPlan(f, ((k + 0.5) / n - 0.5) * f.w * (f.w >= f.d ? 1 : 0), ((k + 0.5) / n - 0.5) * f.d * (f.w >= f.d ? 0 : 1)), rotation: f.rotation };
        if (!at) break;
        const id = put(theme.light.asset, at.at, theme.light.place === 'wall' ? 'Torch' : 'Lamp', at.rotation, theme.light.place === 'wall' ? Math.min(2, h - 0.5) : Math.max(0.5, h - 0.4), { color: theme.light.color, intensity: theme.light.intensity, flicker: theme.light.flicker });
        if (id) counts.lights++;
      }
    }
  }
  return { project: p, made, counts };
};

/** Take out what an earlier dressing made in these rooms and has not been changed since. */
export const undress = (project: Project, roomIds: readonly string[], unchanged: (item: LevelItem) => boolean, global?: readonly AssetDefinition[]): { project: Project; removed: string[] } => {
  const set = levelsOf(project);
  const rooms = set.items.filter((i) => roomIds.includes(i.id));
  const removed = set.items
    .filter((i) => i.tags?.includes(DRESSING) && !i.locked && unchanged(i) && rooms.some((r) => r.levelId === i.levelId && r.floorId === i.floorId && contains(frameOf(set, r, global), { x: i.x, y: i.y })))
    .map((i) => i.id);
  return { project: removed.length ? removeItems(project, removed) : project, removed };
};

