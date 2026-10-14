import { createProject, makeObject } from '../project';
import type { Project, StoryObject } from '../types';
import { assetOf, boundsOf, contains, corners, frameOf, type Point } from './geometry';
import { findAsset, STARTER } from './library';
import { addLevel, insertItems, levelsOf, placeAsset, setParam, updateItem, withSet } from './level';
import { floorCodes } from './structure';
import type { AssetDefinition, LevelItem, LevelSet, ParamValue } from './types';

/**
 * Prefabs (structure spec V2): a piece of a level kept to place again, in
 * this project or another. A guard post, a lever and the gate it works, a
 * locked vault with its key. A prefab carries:
 * - its items, relative to its centre;
 * - the project assets they are made from;
 * - the story objects they point at (the key, the scene), so it works where it lands.
 * Placed, every item gets a new GUID and what one part works is still the copy of it.
 * A structure prefab carries every floor, matched by floor code (B1, G, 1…) where it is placed.
 *
 * Marketplace hooks: a catalog is an index file at an address the designer
 * adds, listing prefabs to download (each checked against its SHA-256) or a
 * page to get one from. Nothing is fetched until the designer opens a
 * catalog; nothing in a package runs, it is only data, checked before use.
 */

export const PREFAB_FORMAT = 'vcgs-prefab';
export const CATALOG_FORMAT = 'vcgs-prefab-catalog';
export const PREFAB_VERSION = 1;
/** The most a package may be: bigger is refused, not read. */
export const PREFAB_MAX_BYTES = 4_000_000;
const MAX_ITEMS = 5000;

export type PrefabItem = Omit<LevelItem, 'levelId' | 'floorId' | 'serial' | 'generated' | 'invalid' | 'exportName'> & {
  /** For a structure prefab: the floor's code (G, 1, B1…). */
  floor?: string;
};

export interface Prefab {
  format: typeof PREFAB_FORMAT;
  version: number;
  id: string;
  name: string;
  description: string;
  author?: string;
  license?: string;
  tags: string[];
  kind: 'items' | 'structure';
  /** Its extent on the plan, in metres. */
  size: { w: number; d: number };
  items: PrefabItem[];
  assets: AssetDefinition[];
  objects: StoryObject[];
  createdAt: string;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const pid = () => `prefab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Story objects an item points at, anywhere in it: its links, rules, puzzle bindings, parameters. */
const referenced = (project: Project, items: readonly unknown[]): StoryObject[] => {
  const found = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      if (project.objects[v]) found.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(items);
  return [...found].map((id) => project.objects[id]!);
};

/** The project and personal assets these items are made of (assemblies' parts too); the starter library needs none. */
const assetsFor = (set: LevelSet, items: readonly { assetId: string }[], global?: readonly AssetDefinition[]): AssetDefinition[] => {
  const out = new Map<string, AssetDefinition>();
  const add = (id: string) => {
    if (out.has(id) || STARTER.some((a) => a.id === id)) return;
    const a = findAsset(id, set.assets, global);
    if (!a) return;
    out.set(id, a);
    for (const p of a.parts ?? []) add(p.assetId);
  };
  for (const i of items) add(i.assetId);
  return [...out.values()];
};

const strip = (i: LevelItem, cx: number, cy: number, floor?: string): PrefabItem => {
  const { levelId: _l, floorId: _f, serial: _s, generated: _g, invalid: _i, exportName: _e, ...rest } = i;
  return { ...rest, x: round(i.x - cx), y: round(i.y - cy), ...(floor ? { floor } : {}) };
};

export interface PrefabMeta {
  name: string;
  description?: string;
  author?: string;
  tags?: string[];
}

/**
 * Make a prefab of these items (structure spec V2): what is in a chosen room
 * comes with it, and so do the doors in its walls and whatever a part works.
 */
export const makePrefab = (project: Project, ids: readonly string[], meta: PrefabMeta, global?: readonly AssetDefinition[], now = new Date().toISOString()): Prefab | null => {
  const set = levelsOf(project);
  const chosen = new Set(ids);
  const first = set.items.find((i) => chosen.has(i.id));
  if (!first) return null;
  for (let pass = 0; pass < 3; pass++)
    for (const i of set.items) {
      if (i.levelId !== first.levelId || i.floorId !== first.floorId || chosen.has(i.id)) continue;
      if (i.host && chosen.has(i.host.id)) chosen.add(i.id);
      else if (typeof i.params?.works === 'string' && chosen.has(i.params.works) && assetOf(set, i, global).kind !== 'space') chosen.add(i.id);
      else if (assetOf(set, i, global).kind !== 'space' && !i.host && [...chosen].some((c) => { const r = set.items.find((x) => x.id === c)!; return assetOf(set, r, global).kind === 'space' && assetOf(set, r, global).role !== 'footprint' && contained(set, r, i, global); })) chosen.add(i.id);
    }
  // Something the chosen parts work, outside the selection, comes too.
  for (const i of set.items.filter((x) => chosen.has(x.id))) if (typeof i.params?.works === 'string' && set.items.some((x) => x.id === i.params!.works)) chosen.add(i.params.works as string);
  const items = set.items.filter((i) => chosen.has(i.id) && assetOf(set, i, global).role !== 'footprint');
  if (!items.length) return null;
  const b = boundsOf(items.filter((i) => !i.host).flatMap((i) => corners(frameOf(set, i, global))));
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return {
    format: PREFAB_FORMAT,
    version: PREFAB_VERSION,
    id: pid(),
    name: meta.name.trim() || 'Prefab',
    description: meta.description?.trim() || `${items.length} pieces: ${[...new Set(items.map((i) => assetOf(set, i, global).name))].slice(0, 6).join(', ')}.`,
    ...(meta.author ? { author: meta.author } : {}),
    tags: meta.tags ?? [],
    kind: 'items',
    size: { w: round(b.maxX - b.minX), d: round(b.maxY - b.minY) },
    items: items.map((i) => strip(i, cx, cy)),
    assets: assetsFor(set, items, global),
    objects: referenced(project, items),
    createdAt: now,
  };
};

const contained = (set: LevelSet, room: LevelItem, i: LevelItem, global?: readonly AssetDefinition[]) => room.floorId === i.floorId && room.levelId === i.levelId && contains(frameOf(set, room, global), { x: i.x, y: i.y });

/** A whole structure as a prefab: every floor's rooms, doors, stairs and what is in them, by floor code. */
export const makeStructurePrefab = (project: Project, levelId: string, meta: PrefabMeta, global?: readonly AssetDefinition[], now = new Date().toISOString()): Prefab | null => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId);
  if (!level?.structure) return null;
  const codes = floorCodes(level);
  const items = set.items.filter((i) => i.levelId === levelId && assetOf(set, i, global).role !== 'footprint');
  if (!items.length) return null;
  return {
    format: PREFAB_FORMAT,
    version: PREFAB_VERSION,
    id: pid(),
    name: meta.name.trim() || level.name,
    description: meta.description?.trim() || `${level.name}: ${items.length} pieces on ${new Set(items.map((i) => i.floorId)).size} floors.`,
    ...(meta.author ? { author: meta.author } : {}),
    tags: [...(meta.tags ?? []), level.structure.type],
    kind: 'structure',
    size: { w: 0, d: 0 },
    items: items.map((i) => strip(i, 0, 0, codes.get(i.floorId) ?? '')),
    assets: assetsFor(set, items, global),
    objects: referenced(project, items),
    createdAt: now,
  };
};

export interface Placed {
  project: Project;
  ids: string[];
  added: { objects: number; assets: number };
  problems: string[];
}

/**
 * Place a prefab (structure spec V2), as one change: its assets and story
 * objects join the project if it hasn't them yet (the same ones are shared,
 * not doubled), then its items go down at `at` with new GUIDs, or for a
 * structure prefab onto the floors with the same codes.
 */
export const placePrefab = (project: Project, levelId: string, floorId: string, prefab: Prefab, at: Point, global?: readonly AssetDefinition[]): Placed => {
  let p = project;
  const problems: string[] = [];
  const added = { objects: 0, assets: 0 };
  const set0 = levelsOf(p);
  const level = set0.levels.find((l) => l.id === levelId);
  if (!level) return { project, ids: [], added, problems: ['No such map.'] };
  // Story objects: those it points at and the project hasn't.
  const objects = { ...p.objects };
  for (const o of prefab.objects) {
    if (objects[o.id]) continue;
    objects[o.id] = o;
    added.objects++;
  }
  if (added.objects) p = { ...p, objects };
  // Assets: those it is made of and nothing here has.
  const set1 = levelsOf(p);
  const newAssets = prefab.assets.filter((a) => !findAsset(a.id, set1.assets, global));
  if (newAssets.length) {
    p = withSet(p, { ...set1, assets: [...set1.assets, ...newAssets.map((a) => ({ ...a, source: 'project' as const }))] });
    added.assets = newAssets.length;
  }
  const set2 = levelsOf(p);
  const missing = [...new Set(prefab.items.map((i) => i.assetId).filter((id) => !findAsset(id, set2.assets, global)))];
  if (missing.length) problems.push(`Left out ${missing.length === 1 ? 'a piece' : `${missing.length} kinds of piece`} it is made of and doesn’t carry: ${missing.join(', ')}.`);
  const templates = prefab.items.filter((i) => !missing.includes(i.assetId)).map((i) => ({ ...i, levelId, floorId, serial: 0 }) as LevelItem & { floor?: string });
  let floorOf: (i: LevelItem & { floor?: string }) => string | null = () => floorId;
  if (prefab.kind === 'structure') {
    const byCode = new Map([...floorCodes(level)].map(([fid, code]) => [code, fid]));
    const lost = [...new Set(templates.map((t) => t.floor ?? '').filter((code) => !byCode.has(code)))];
    floorOf = (i) => byCode.get(i.floor ?? '') ?? null;
    if (lost.length) problems.push(`This structure has no floor ${lost.join(', ')}: what was on ${lost.length === 1 ? 'it' : 'them'} was left out.`);
  }
  const out = insertItems(p, levelId, templates, floorOf, prefab.kind === 'structure' ? { x: 0, y: 0 } : at);
  const s3 = levelsOf(out.project);
  const made = new Set(out.ids);
  const clean = withSet(out.project, { ...s3, items: s3.items.map((i) => (made.has(i.id) && 'floor' in i ? (({ floor: _x, ...rest }) => rest)(i as LevelItem & { floor?: string }) : i)) });
  const ids = out.ids;
  return { project: clean, ids, added, problems };
};

// ---------------------------------------------------------------- packages: checks and checksums

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/**
 * Read a prefab package, checking it is one: its format and version, and
 * that every item, asset and story object has what it must. Nothing in it is
 * trusted further than that: it is data, never run.
 */
export const readPrefab = (text: string): { prefab?: Prefab; problems: string[] } => {
  if (text.length > PREFAB_MAX_BYTES) return { problems: [`Too big to be a prefab (over ${Math.round(PREFAB_MAX_BYTES / 1e6)} MB).`] };
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return { problems: ['Not a prefab: it isn’t JSON.'] };
  }
  if (!isObj(j) || j.format !== PREFAB_FORMAT) return { problems: ['Not a prefab: its format isn’t vcgs-prefab.'] };
  if (!isNum(j.version) || j.version > PREFAB_VERSION) return { problems: [`Made by a newer studio (prefab version ${String(j.version)}). Update to place it.`] };
  const problems: string[] = [];
  const items = Array.isArray(j.items) ? j.items : [];
  if (!items.length) problems.push('It has nothing in it.');
  if (items.length > MAX_ITEMS) problems.push(`It has more than ${MAX_ITEMS} pieces.`);
  const okItem = (i: unknown): i is PrefabItem => isObj(i) && isStr(i.id) && isStr(i.assetId) && isStr(i.name) && isNum(i.x) && isNum(i.y) && isNum(i.z) && isNum(i.rotation) && (i.floor === undefined || isStr(i.floor));
  const badItems = items.filter((i) => !okItem(i)).length;
  if (badItems) problems.push(`${badItems} of its pieces are missing what a piece must have.`);
  const assets = (Array.isArray(j.assets) ? j.assets : []).filter((a): a is AssetDefinition => isObj(a) && isStr(a.id) && isStr(a.name) && isStr(a.kind) && isObj(a.size) && Array.isArray(a.params));
  const objects = (Array.isArray(j.objects) ? j.objects : []).filter((o): o is StoryObject => isObj(o) && isStr(o.id) && isStr(o.type) && isStr(o.name) && isObj(o.data));
  if (problems.length) return { problems };
  return {
    prefab: {
      format: PREFAB_FORMAT,
      version: j.version,
      id: isStr(j.id) ? j.id : pid(),
      name: isStr(j.name) ? j.name.slice(0, 120) : 'Prefab',
      description: isStr(j.description) ? j.description.slice(0, 2000) : '',
      ...(isStr(j.author) ? { author: j.author.slice(0, 120) } : {}),
      ...(isStr(j.license) ? { license: j.license.slice(0, 200) } : {}),
      tags: Array.isArray(j.tags) ? j.tags.filter(isStr).slice(0, 20) : [],
      kind: j.kind === 'structure' ? 'structure' : 'items',
      size: isObj(j.size) && isNum(j.size.w) && isNum(j.size.d) ? { w: j.size.w, d: j.size.d } : { w: 0, d: 0 },
      items: items as PrefabItem[],
      assets,
      objects,
      createdAt: isStr(j.createdAt) ? j.createdAt : '',
    },
    problems: [],
  };
};

/** The package as a file: the same prefab always gives the same text. */
export const prefabText = (prefab: Prefab): string => `${JSON.stringify(prefab, null, 2)}\n`;

/** SHA-256 of a text, in hex: what a catalog lists for each package, checked before it is used. */
export const sha256 = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

// ---------------------------------------------------------------- the project's prefabs

export const prefabsOf = (project: Project): Prefab[] => levelsOf(project).prefabs ?? [];

export const savePrefab = (project: Project, prefab: Prefab): Project => {
  const set = levelsOf(project);
  return withSet(project, { ...set, prefabs: [...(set.prefabs ?? []).filter((x) => x.id !== prefab.id), prefab] });
};

export const removePrefab = (project: Project, id: string): Project => {
  const set = levelsOf(project);
  return withSet(project, { ...set, prefabs: (set.prefabs ?? []).filter((x) => x.id !== id) });
};

// ---------------------------------------------------------------- marketplace hooks: catalogs

/** One prefab a catalog lists: to download (its package's address and SHA-256), or to get from a page. */
export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  author?: string;
  tags: string[];
  license?: string;
  /** Where the package is, relative to the catalog or absolute. */
  url?: string;
  sha256?: string;
  /** For one that is sold: what it costs, as the catalog says it, and the page to get it from. */
  price?: string;
  page?: string;
}

export interface Catalog {
  url: string;
  name: string;
  entries: CatalogEntry[];
}

/** Only https (or a server on this computer) for catalogs and the packages they list. */
export const safeUrl = (raw: string, base?: string): string | null => {
  try {
    const u = new URL(raw, base);
    if (u.protocol === 'https:') return u.href;
    if (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return u.href;
    return null;
  } catch {
    return null;
  }
};

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** Read a catalog's index (vcgs-prefab-catalog, version 1). */
export const readCatalog = (url: string, text: string): { catalog?: Catalog; problems: string[] } => {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return { problems: ['That address doesn’t give a catalog: it isn’t JSON.'] };
  }
  if (!isObj(j) || j.format !== CATALOG_FORMAT) return { problems: ['Not a prefab catalog: its format isn’t vcgs-prefab-catalog.'] };
  if (!isNum(j.version) || j.version > PREFAB_VERSION) return { problems: [`A newer catalog (version ${String(j.version)}). Update the studio to read it.`] };
  const list = Array.isArray(j.prefabs) ? j.prefabs : [];
  const entries: CatalogEntry[] = [];
  let bad = 0;
  for (const e of list.slice(0, 1000)) {
    if (!isObj(e) || !isStr(e.id) || !isStr(e.name) || (!isStr(e.url) && !isStr(e.page))) {
      bad++;
      continue;
    }
    const pkg = isStr(e.url) ? safeUrl(e.url, url) : null;
    const page = isStr(e.page) ? safeUrl(e.page, url) : null;
    if (isStr(e.url) && (!pkg || !isStr(e.sha256) || !/^[0-9a-f]{64}$/i.test(e.sha256))) {
      bad++;
      continue;
    }
    entries.push({
      id: e.id,
      name: e.name.slice(0, 120),
      description: isStr(e.description) ? e.description.slice(0, 1000) : '',
      ...(isStr(e.author) ? { author: e.author.slice(0, 120) } : {}),
      tags: Array.isArray(e.tags) ? e.tags.filter(isStr).slice(0, 20) : [],
      ...(isStr(e.license) ? { license: e.license.slice(0, 200) } : {}),
      ...(pkg ? { url: pkg, sha256: (e.sha256 as string).toLowerCase() } : {}),
      ...(isStr(e.price) ? { price: e.price.slice(0, 40) } : {}),
      ...(page ? { page } : {}),
    });
  }
  return { catalog: { url, name: isStr(j.name) ? j.name.slice(0, 120) : new URL(url).hostname, entries }, problems: bad ? [`${bad} of its entries were left out: no safe address, or no SHA-256 to check the package by.`] : [] };
};

export const fetchCatalog = async (url: string, fetcher: Fetcher): Promise<{ catalog?: Catalog; problems: string[] }> => {
  const safe = safeUrl(url);
  if (!safe) return { problems: ['A catalog address must start with https://.'] };
  try {
    const r = await fetcher(safe);
    if (!r.ok) return { problems: [`The catalog couldn’t be read (${r.status}).`] };
    return readCatalog(safe, await r.text());
  } catch {
    return { problems: ['The catalog couldn’t be reached.'] };
  }
};

/** Download a listed prefab and check it: its SHA-256 must be the one the catalog lists, and it must be a prefab. */
export const fetchListed = async (entry: CatalogEntry, fetcher: Fetcher): Promise<{ prefab?: Prefab; problems: string[] }> => {
  if (!entry.url || !entry.sha256) return { problems: [entry.page ? 'This one is got from its page.' : 'This one has nothing to download.'] };
  try {
    const r = await fetcher(entry.url);
    if (!r.ok) return { problems: [`It couldn’t be downloaded (${r.status}).`] };
    const text = await r.text();
    if (text.length > PREFAB_MAX_BYTES) return { problems: ['Too big to be a prefab.'] };
    if ((await sha256(text)) !== entry.sha256) return { problems: ['What was downloaded isn’t what the catalog lists (its SHA-256 differs), so it wasn’t used.'] };
    return readPrefab(text);
  } catch {
    return { problems: ['It couldn’t be downloaded.'] };
  }
};

// ---------------------------------------------------------------- starter prefabs

let starters: Prefab[] | null = null;

/** Prefabs that come with the studio: made here from the starter library, so they are always current. */
export const starterPrefabs = (): Prefab[] => {
  if (starters) return starters;
  const at = '2026-10-14T00:00:00.000Z';
  const build = (name: string, description: string, tags: string[], make: (put: (asset: string, x: number, y: number, label: string, params?: Record<string, ParamValue>, size?: { w: number; d: number }) => string, p: () => Project, setP: (next: Project) => void) => void): Prefab => {
    const base = addLevel(createProject('Starter'), 'Starter');
    let p = base.project;
    const lv = levelsOf(p).levels[0]!;
    const fid = lv.floors[0]!.id;
    const ids: string[] = [];
    const put = (asset: string, x: number, y: number, label: string, params?: Record<string, ParamValue>, size?: { w: number; d: number }) => {
      const made = placeAsset(p, lv.id, fid, asset, { x, y }, { name: label });
      const id = made.ids[0]!;
      p = made.project;
      if (size) p = updateItem(p, id, { size: { ...levelsOf(p).items.find((i) => i.id === id)!.size, ...size } });
      for (const [k, v] of Object.entries(params ?? {})) p = setParam(p, id, k, v);
      ids.push(id);
      return id;
    };
    make(put, () => p, (next) => (p = next));
    const pre = makePrefab(p, levelsOf(p).items.filter((i) => i.levelId === lv.id).map((i) => i.id), { name, description, tags, author: 'VC Game Studio' }, undefined, at)!;
    return { ...pre, id: `starter.${name.toLowerCase().replace(/[^a-z]+/g, '-')}` };
  };
  starters = [
    build('Guard post', 'A small room with a door, a table, two chairs and a torch.', ['room', 'fortress'], (put) => {
      put('space.room', 0, 0, 'Guard Post', undefined, { w: 6, d: 5 });
      put('arch.door', 0, 2.5, 'Door');
      put('prop.table', 0, 0, 'Table');
      put('prop.chair', -1.1, 0, 'Chair');
      put('prop.chair', 1.1, 0, 'Chair');
      put('light.emissive', -2.7, -2, 'Torch', { color: '#ffa84a', flicker: true });
    }),
    build('Lever and gate', 'A passage closed by a portcullis, and the lever beside it that lifts it.', ['puzzle', 'gate'], (put) => {
      put('space.corridor', 0, 0, 'Gate passage', undefined, { w: 3, d: 8 });
      const gate = put('arch.gate', 0, -4, 'Portcullis');
      put('logic.lever', 1, -2.5, 'Lever', { works: gate });
    }),
    build('Locked vault', 'A vault behind a locked door, a chest inside, and the key that opens both, to put somewhere else.', ['room', 'treasure', 'key'], (put, p, setP) => {
      const key = makeObject('inventory', 'Vault Key', at);
      setP({ ...p(), objects: { ...p().objects, [key.id]: key } });
      put('space.room', 0, 0, 'Vault', undefined, { w: 5, d: 5 });
      put('arch.door', 0, 2.5, 'Vault door', { locked: true, keyItem: key.id, autoOpen: false });
      put('play.chest', 0, -1.6, 'Chest', { locked: true, keyItem: key.id });
      put('play.pickup', 0, 4.5, 'Vault Key', { item: key.id });
    }),
    build('Trapped passage', 'A passage with a dart trap that fires in a cycle, and a plate that switches it off while held.', ['corridor', 'trap'], (put) => {
      put('space.corridor', 0, 0, 'Passage', undefined, { w: 10, d: 2 });
      const trap = put('play.trap', 1, 0, 'Dart trap', { cycle: 3, activeFor: 1, damage: 15 });
      put('logic.plate', -3.5, 0, 'Pressure plate', { works: trap, action: 'switch off' });
    }),
  ];
  return starters;
};
