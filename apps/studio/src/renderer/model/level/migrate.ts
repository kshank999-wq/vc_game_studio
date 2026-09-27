import type { Project } from '../types';
import { assetOf, outlineOf, sizeOf } from './geometry';
import { levelsOf, updateAsset, withSet } from './level';
import type { AssetDefinition, LevelItem, OutlinePoint, ParamDef, ParamValue, Size } from './types';

/**
 * Library updates applied safely (spec §4.3, §4.4). A definition's defaults
 * change for everything placed from it, but an item placed from an earlier
 * version is flagged until someone looks: it shows what it inherited that
 * changed (and can keep the old value), and which of its own changes the
 * new version makes pointless or no longer valid. Nothing is overwritten
 * without being shown.
 */

export type ChangeKind =
  /** It followed the library, and the library's value changed: keep the old one or take the new. */
  | 'inherited'
  /** Its own value is now the library's: it goes back to inheriting. */
  | 'redundant'
  /** Its own value no longer fits the setting (an option gone, out of range): back to the library's. */
  | 'invalid'
  /** The setting is gone from the library: its value is dropped. */
  | 'dropped';

export interface Change {
  kind: ChangeKind;
  /** A parameter key, `size.w`, `size.d`, `size.h`, or `outline`. */
  key: string;
  label: string;
  from?: ParamValue;
  to?: ParamValue;
}

export interface Migration {
  itemId: string;
  assetId: string;
  from: number;
  to: number;
  /** False when the version it came from wasn't recorded: its inherited changes can't be shown. */
  known: boolean;
  changes: Change[];
}

const SIZE_LABEL: Record<keyof Size, string> = { w: 'Width', d: 'Depth', h: 'Height' };

const fits = (p: ParamDef, v: ParamValue): boolean => {
  if (p.type === 'select') return typeof v === 'string' && (p.options ?? []).includes(v);
  if (p.type === 'number') return typeof v === 'number' && (p.min === undefined || v >= p.min) && (p.max === undefined || v <= p.max);
  if (p.type === 'boolean') return typeof v === 'boolean';
  return typeof v === 'string';
};

const sameOutline = (a?: OutlinePoint[], b?: OutlinePoint[]) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What updating this item to its library's current version would change, or null when it is up to date. */
export const migrationFor = (project: Project, item: LevelItem, global?: readonly AssetDefinition[]): Migration | null => {
  const set = levelsOf(project);
  const def = assetOf(set, item, global);
  if (def.id === 'missing' || item.assetVersion >= def.version) return null;
  const old = def.history?.find((h) => h.version === item.assetVersion);
  const changes: Change[] = [];
  const own = item.params ?? {};
  for (const p of def.params) {
    if (p.key in own) {
      const v = own[p.key]!;
      if (v === p.default) changes.push({ kind: 'redundant', key: p.key, label: p.label, from: v });
      else if (!fits(p, v)) changes.push({ kind: 'invalid', key: p.key, label: p.label, from: v, to: p.default });
    } else if (old && p.key in old.defaults && old.defaults[p.key] !== p.default) {
      changes.push({ kind: 'inherited', key: p.key, label: p.label, from: old.defaults[p.key], to: p.default });
    }
  }
  for (const key of Object.keys(own)) {
    if (!def.params.some((p) => p.key === key)) changes.push({ kind: 'dropped', key, label: key, from: own[key] });
  }
  for (const axis of ['w', 'd', 'h'] as const) {
    const mine = item.size?.[axis];
    if (mine !== undefined && mine === def.size[axis]) changes.push({ kind: 'redundant', key: `size.${axis}`, label: SIZE_LABEL[axis], from: mine });
    else if (mine === undefined && old && old.size[axis] !== def.size[axis]) changes.push({ kind: 'inherited', key: `size.${axis}`, label: SIZE_LABEL[axis], from: old.size[axis], to: def.size[axis] });
  }
  if (!item.outline && old && !sameOutline(old.outline, def.outline)) changes.push({ kind: 'inherited', key: 'outline', label: 'Outline' });
  return { itemId: item.id, assetId: def.id, from: item.assetVersion, to: def.version, known: !!old, changes };
};

/** Every item placed from an earlier version of its library asset. */
export const outdatedItems = (project: Project, global?: readonly AssetDefinition[]): Migration[] =>
  levelsOf(project).items.map((i) => migrationFor(project, i, global)).filter((m): m is Migration => !!m);

/**
 * Bring an item up to its library's version. `keep` names inherited changes
 * whose old value it keeps, as its own; everything else takes the library's
 * current value, and pointless or invalid values of its own go.
 */
export const migrateItem = (project: Project, itemId: string, keep: readonly string[] = [], global?: readonly AssetDefinition[]): Project => {
  const set = levelsOf(project);
  const item = set.items.find((i) => i.id === itemId);
  const m = item && migrationFor(project, item, global);
  if (!item || !m) return project;
  const def = assetOf(set, item, global);
  const old = def.history?.find((h) => h.version === item.assetVersion);
  const params: Record<string, ParamValue> = { ...item.params };
  const size: Partial<Size> = { ...item.size };
  let outline = item.outline;
  for (const c of m.changes) {
    const axis = c.key.startsWith('size.') ? (c.key.slice(5) as keyof Size) : null;
    if (c.kind === 'inherited' && keep.includes(c.key)) {
      if (c.key === 'outline') outline = old?.outline ?? [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }];
      else if (axis) size[axis] = c.from as number;
      else params[c.key] = c.from!;
    } else if (c.kind !== 'inherited') {
      if (axis) delete size[axis];
      else delete params[c.key];
    }
  }
  const next: LevelItem = { ...item, assetVersion: def.version };
  if (Object.keys(params).length) next.params = params;
  else delete next.params;
  if (Object.keys(size).length) next.size = size;
  else delete next.size;
  if (outline) next.outline = outline;
  else delete next.outline;
  return withSet(project, { ...set, items: set.items.map((i) => (i.id === itemId ? next : i)) });
};

/** Every item from an older version of this asset takes its current values. */
export const migrateAll = (project: Project, assetId: string, global?: readonly AssetDefinition[]): Project =>
  outdatedItems(project, global)
    .filter((m) => m.assetId === assetId)
    .reduce((p, m) => migrateItem(p, m.itemId, [], global), project);

/**
 * Make what this item has the new defaults of its project asset (the other
 * way from Reset): the asset's version goes up, this item inherits it all
 * again, and every other item placed from it is flagged for review.
 */
export const saveToAsset = (project: Project, itemId: string, global?: readonly AssetDefinition[]): Project => {
  const set = levelsOf(project);
  const item = set.items.find((i) => i.id === itemId);
  if (!item) return project;
  const def = assetOf(set, item, global);
  if (def.source !== 'project' || def.kind === 'assembly' || !set.assets.some((a) => a.id === def.id)) return project;
  if (!item.params && !item.size && !item.outline) return project;
  const outline = outlineOf(set, item, global);
  let p = updateAsset(project, def.id, {
    size: sizeOf(set, item, global),
    params: def.params.map((d) => (item.params && d.key in item.params ? { ...d, default: item.params[d.key]! } : d)),
    ...(def.kind === 'space' || def.kind === 'volume' ? { outline } : {}),
  });
  const after = levelsOf(p);
  const version = after.assets.find((a) => a.id === def.id)!.version;
  p = withSet(p, {
    ...after,
    items: after.items.map((i) => {
      if (i.id !== itemId) return i;
      const n: LevelItem = { ...i, assetVersion: version };
      delete n.params;
      delete n.size;
      delete n.outline;
      return n;
    }),
  });
  return p;
};

/** Can this item's changes be saved to its library asset? */
export const canSaveToAsset = (project: Project, item: LevelItem, global?: readonly AssetDefinition[]): boolean => {
  const set = levelsOf(project);
  const def = assetOf(set, item, global);
  return def.source === 'project' && def.kind !== 'assembly' && set.assets.some((a) => a.id === def.id) && !!(item.params || item.size || item.outline) && item.assetVersion === def.version;
};
